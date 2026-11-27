#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CLI_DIR = join(ROOT, "packages", "cli");
const NF_BIN = join(CLI_DIR, "bin", "nf.js");

const out = (text = "") => process.stdout.write(`${text}\n`);

const fail = (message) => {
  process.stderr.write(`nf setup: ${message}\n`);
  process.exit(1);
};

const report = (label, text) => out(`  ${label.padEnd(12)}${text}`);

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const REQUIRED_NODE = parseVersion(manifest.engines?.node ?? ">=24");

const bunBin = join(
  process.env.BUN_INSTALL && process.env.BUN_INSTALL.length > 0
    ? process.env.BUN_INSTALL
    : join(homedir(), ".bun"),
  "bin",
);

function parseVersion(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(found, required) {
  for (let index = 0; index < required.length; index += 1) {
    if (found[index] > required[index]) return true;
    if (found[index] < required[index]) return false;
  }
  return true;
}

function capture(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
}

const PATH_EXTENSIONS = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

function findOnPath(name) {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const dir = entry.replace(/^"|"$/g, "");
    if (dir === "") continue;
    for (const extension of PATH_EXTENSIONS) {
      const candidate = join(dir, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function runStep(title, command, args, cwd = ROOT) {
  out("");
  out(title);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error !== undefined) fail(`${title} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${title} failed with exit code ${String(result.status)}`);
}

/** The tools only a checkout needs: Bun builds the board and links `nf`, and there is a git repo. */
function checkBuildTools() {
  out("prerequisites");
  const node = parseVersion(process.versions.node);
  if (!atLeast(node, REQUIRED_NODE))
    fail(
      `Node ${REQUIRED_NODE.join(".")} or newer is required (found ${process.versions.node}); install it from https://nodejs.org and open a new terminal`,
    );

  const bun = capture("bun", ["--version"]);
  if (bun.error !== undefined || bun.status !== 0)
    fail(
      "Bun is required to build and link a checkout; install it from https://bun.sh and open a new terminal",
    );
  report("bun", `${bun.stdout.trim()}  (required to build and link this checkout)`);

  const git = capture("git", ["--version"]);
  if (git.error !== undefined || git.status !== 0)
    fail("git is required; install it from https://git-scm.com and open a new terminal");
  if (capture("git", ["rev-parse", "--show-toplevel"]).status !== 0)
    fail("this directory is not a Git checkout; clone nf-stack with git and rerun setup");
  report(
    "checkout",
    `${ROOT}  (a Git checkout, ${git.stdout.trim().replace(/^git version /, "")})`,
  );
}

async function main() {
  out(`bun run setup  ${ROOT}`);
  out("");
  checkBuildTools();

  runStep("bun install", "bun", ["install"]);
  runStep("board bundle", "bun", ["run", "board:build"]);
  runStep("link nf (bun link in packages/cli)", "bun", ["link"], CLI_DIR);

  const linked = findOnPath("nf");
  out("");
  report(
    "nf",
    linked === null
      ? `not on PATH: add ${bunBin} to PATH and open a new terminal`
      : `on PATH: ${linked}`,
  );

  const nf =
    linked === null ? { command: process.execPath, args: [NF_BIN] } : { command: linked, args: [] };

  // Everything a checkout and an npm install must both pass lives in `nf setup`.
  runStep("nf setup (skills, store, live board)", nf.command, [...nf.args, "setup"]);

  out("");
  out("bun run setup: done");
}

await main();
