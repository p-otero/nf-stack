#!/usr/bin/env node
// Proves what npm publishes: packs the tarball, installs it into a temporary prefix and runs the
// CLI from there with a temporary NF_HOME and home directory, so the real ~/.nf, ~/.agents and
// ~/.claude stay untouched. Bun is not used after the pack, which is what an npm user has.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const PACKAGE = resolve(import.meta.dirname, "..");
const WORK = mkdtempSync(join(tmpdir(), "nf-clean-install-"));
const PREFIX = join(WORK, "prefix");
const HOME = join(WORK, "home");
const NF_HOME = join(WORK, "nf-home");
const REPO = join(WORK, "repo");
const BIN = process.platform === "win32" ? PREFIX : join(PREFIX, "bin");
const NF = join(BIN, process.platform === "win32" ? "nf.cmd" : "nf");
/** npm and the nf launcher are shell scripts on some platforms and `.cmd` files on Windows. */
const SHELL = process.platform === "win32";

const env = {
  ...process.env,
  HOME,
  USERPROFILE: HOME,
  NF_HOME,
  NF_T3_STATE: join(WORK, "absent.sqlite"),
  NF_PRICES: join(WORK, "absent-rates.json"),
  NF_OFFLINE: "1",
  PATH: `${BIN}${delimiter}${process.env.PATH ?? ""}`,
};

const out = (text = "") => process.stdout.write(`${text}\n`);

function fail(message) {
  process.stderr.write(`nf clean install: ${message}\n`);
  process.stderr.write(`nf clean install: the temporary tree is at ${WORK}\n`);
  process.exit(1);
}

function check(condition, message) {
  if (!condition) fail(message);
}

/** Windows runs npm and the nf launcher through `.cmd`, so those go as one shell line. */
const quote = (text) => `"${text}"`;
const quoteIfNeeded = (text) => (/[\s"]/.test(text) ? quote(text) : text);

function capture(command, args, options = {}) {
  const settings = { cwd: options.cwd ?? WORK, encoding: "utf8", env };
  if (options.shell === true) {
    // The command name stays bare: `cmd` resolves a quoted one to a file without its extension.
    return spawnSync([quoteIfNeeded(command), ...args.map(quote)].join(" "), {
      ...settings,
      shell: true,
    });
  }
  return spawnSync(command, args, settings);
}

/** Run one step, echo it and its output, and fail with that output when it does not succeed. */
function run(title, command, args, options = {}) {
  out(`$ ${[command, ...args].join(" ")}`);
  const result = capture(command, args, options);
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (text !== "") out(text.replace(/^/gm, "  "));
  if (result.error !== undefined) fail(`${title}: ${result.error.message}`);
  if (result.status !== 0) fail(`${title}: exit code ${String(result.status)}`);
  return result.stdout ?? "";
}

function assertAbsent(entries, pattern, what) {
  const found = entries.filter((entry) => pattern.test(entry));
  check(found.length === 0, `the tarball carries ${what}: ${found.slice(0, 5).join(", ")}`);
}

function assertPresent(entries, path) {
  check(entries.includes(path), `the tarball is missing ${path}`);
}

function listTarball(name) {
  // The name is relative to WORK: GNU tar in Git Bash reads a `C:` prefix as a remote host.
  const result = capture("tar", ["-tzf", name]);
  check(result.status === 0, `tar cannot read ${name}: ${result.stderr.trim()}`);
  const entries = result.stdout.split("\n").filter((entry) => entry.length > 0);
  out("");
  out(
    `tarball ${name} (${(statSync(join(WORK, name)).size / 1024).toFixed(0)} KiB, ${String(entries.length)} entries)`,
  );
  for (const entry of entries) out(`  ${entry}`);
  return entries;
}

function checkTarball(name) {
  const entries = listTarball(name);
  for (const path of [
    "package/package.json",
    "package/bin/nf.js",
    "package/dist/main.js",
    "package/dist/model-traits.yaml",
    "package/dist/board/index.html",
    "package/skills/nf-meta/SKILL.md",
    "package/LICENSE",
    "package/THIRD-PARTY-NOTICES.md",
    "package/README.md",
  ]) {
    assertPresent(entries, path);
  }
  assertAbsent(entries, /\.map$/, "source maps");
  assertAbsent(entries, /\.ts$/, "TypeScript sources");
  assertAbsent(entries, /(^|\/)test\//, "tests");
  assertAbsent(entries, /(^|\/)fixtures\//, "fixtures");
  assertAbsent(entries, /(^|\/)\.nf\//, "store data");
  assertAbsent(entries, /(^|\/)\.agents\//, "linked skills");
  assertAbsent(entries, /(^|\/)\.claude\//, "linked skills");
  assertAbsent(entries, /(^|\/)node_modules\//, "dependencies");
  assertAbsent(entries, /(^|\/)scripts\//, "build scripts");
  return entries;
}

function readHealth(origin) {
  return fetch(new URL("/api/health", origin), { signal: AbortSignal.timeout(5_000) }).then(
    async (response) => {
      check(response.ok, `/api/health answered ${String(response.status)}`);
      return response.json();
    },
  );
}

function checkServe(installedBin) {
  return new Promise((resume, reject) => {
    // Node, not the launcher: killing a `cmd.exe` wrapper would leave the server behind on Windows.
    const child = spawn(process.execPath, [installedBin, "serve", "--port", "0"], {
      cwd: REPO,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      child.kill();
      if (error === null) resume();
      else reject(error);
    };
    const deadline = setTimeout(
      () => finish(new Error("nf serve did not start within 30s")),
      30_000,
    );
    const ready = /^nf serve: (http:\/\/localhost:\d+\/)/m;
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = ready.exec(output);
      if (match === null) return;
      const origin = match[1];
      Promise.all([
        readHealth(origin),
        fetch(new URL("/", origin), { signal: AbortSignal.timeout(5_000) }).then(
          async (response) => ({
            status: response.status,
            type: response.headers.get("content-type") ?? "",
            html: await response.text(),
          }),
        ),
      ]).then(([health, page]) => {
        const html = page.html;
        child.kill();
        try {
          check(health.app === "nf", `/api/health answered for '${String(health.app)}'`);
          check(
            resolve(String(health.nfHome)) === resolve(NF_HOME),
            `/api/health serves NF_HOME ${String(health.nfHome)}, expected ${NF_HOME}`,
          );
          check(page.status === 200, `/ answered ${String(page.status)}`);
          check(page.type.includes("text/html"), `/ is ${page.type}, not HTML`);
          check(html.includes('id="board-source"'), "/ is not the live nf board");
          out(`  /api/health  app=nf nfHome=${String(health.nfHome)}`);
          out(`  /            ${String(html.length)} bytes, ${page.type}`);
        } catch (error) {
          return finish(error);
        }
        finish(null);
      }, finish);
    });
    child.on("error", finish);
    child.on("exit", (code) =>
      finish(new Error(`nf serve exited with ${String(code)}\n${output}`)),
    );
  });
}

async function main() {
  out(`nf clean install  ${WORK}`);
  mkdirSync(HOME, { recursive: true });
  mkdirSync(NF_HOME, { recursive: true });
  mkdirSync(REPO, { recursive: true });

  out("");
  out("pack");
  run("npm pack", "npm", ["pack", "--pack-destination", WORK], { cwd: PACKAGE, shell: SHELL });
  const tarballs = readdirSync(WORK).filter((name) => name.endsWith(".tgz"));
  check(tarballs.length === 1, `npm pack left ${String(tarballs.length)} tarballs`);
  const tarball = join(WORK, tarballs[0]);
  checkTarball(tarballs[0]);

  out("");
  out("install");
  run("npm i -g", "npm", ["i", "-g", tarball, "--prefix", PREFIX, "--no-audit", "--no-fund"], {
    shell: SHELL,
  });
  check(existsSync(NF), `npm did not install the nf launcher at ${NF}`);
  const installed = [
    join(PREFIX, "lib", "node_modules", "@p-otero", "nf-stack"),
    join(PREFIX, "node_modules", "@p-otero", "nf-stack"),
  ].find((dir) => existsSync(dir));
  check(installed !== undefined, `npm installed no @p-otero/nf-stack under ${PREFIX}`);
  const installedBin = join(installed, "bin", "nf.js");

  out("");
  out("run");
  const version = run("nf --version", NF, ["--version"], { cwd: REPO, shell: SHELL }).trim();
  check(/^nf \d+\.\d+\.\d+$/.test(version), `nf --version printed '${version}'`);

  run("git init", "git", ["init", "-q"], { cwd: REPO });
  run("nf init", NF, ["init"], { cwd: REPO, shell: SHELL });
  run("nf status", NF, ["status"], { cwd: REPO, shell: SHELL });

  out("");
  out("setup, twice");
  const first = run("nf setup", NF, ["setup"], { cwd: REPO, shell: SHELL });
  check(first.includes("created"), "the first nf setup linked no skill");
  const second = run("nf setup", NF, ["setup"], { cwd: REPO, shell: SHELL });
  check(second.includes("already linked"), "the second nf setup linked the skills again");
  for (const name of ["nf-meta", "nf-worker"]) {
    check(
      existsSync(join(HOME, ".agents", "skills", name)),
      `nf setup linked no ~/.agents/skills/${name}`,
    );
    check(
      existsSync(join(HOME, ".claude", "skills", name)),
      `nf setup linked no ~/.claude/skills/${name}`,
    );
  }

  out("");
  out("serve");
  await checkServe(installedBin);
  check(existsSync(join(NF_HOME, "nf.db")), `nf used no store in ${NF_HOME}`);

  rmSync(WORK, { recursive: true, force: true, maxRetries: 5 });
  out("");
  out("nf clean install: ok");
}

await main();
