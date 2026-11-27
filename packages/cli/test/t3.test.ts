import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `nf t3 init` runs the real nf under *node*, like the rest of the CLI tests.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const SCHEMA_URL = "https://t3.codes/schema/t3.json";

setDefaultTimeout(60_000);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0)
    rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5 });
});

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function repo(name: string): string {
  const dir = tmp(`nf-t3-${name}-`);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", `https://example.test/${name}.git`], {
    cwd: dir,
  });
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
  /** Parsed stdout; each test narrows it to the shape its command writes. */
  json: () => any;
}

function nf(home: string, cwd: string, args: string[]): Run {
  const r = spawnSync(NODE, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home },
  });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

const BOARD = {
  name: "Board",
  command: "nf serve",
  icon: "play",
  previewUrl: "http://localhost:4646/?project=NF",
  autoOpenPreview: true,
  runOnWorktreeCreate: false,
};

interface Project {
  readonly file: string;
  readonly call: (args: string[]) => Run;
  readonly text: () => string;
  readonly document: () => any;
}

/** A Git repo registered with `nf init --prefix NF`, and its `t3.json` path. */
function project(name: string): Project {
  const home = tmp(`nf-t3-home-${name}-`);
  const cwd = repo(name);
  const call = (args: string[]) => nf(home, cwd, args);
  const init = call(["init", "--json", "--prefix", "NF"]);
  if (init.code !== 0) throw new Error(`nf init failed: ${init.err}`);
  const root: string = init.json().project.root_path;
  const file = join(root, "t3.json");
  return {
    file,
    call,
    text: () => readFileSync(file, "utf8"),
    document: () => JSON.parse(readFileSync(file, "utf8")),
  };
}

describe("nf t3 init", () => {
  test("creates t3.json with the Board script", () => {
    const p = project("create");
    const run = p.call(["t3", "init"]);
    expect(run.err).toBe("");
    expect(run.code).toBe(0);
    expect(run.out).toContain(`nf t3 init: created ${p.file}`);
    expect(run.out).toContain("Board: nf serve (preview http://localhost:4646/?project=NF)");
    expect(run.out).toContain("Import it in T3 Code");
    const text = p.text();
    expect(text).toBe(`${JSON.stringify({ $schema: SCHEMA_URL, scripts: [BOARD] }, null, 2)}\n`);
    expect(p.document()).toEqual({ $schema: SCHEMA_URL, scripts: [BOARD] });
  });

  test("merges into an existing file, keeps its scripts and keys, updates Board in place", () => {
    const p = project("merge");
    const lint = { name: "Lint", command: "bun run lint", icon: "lint" };
    const suite = { name: "Test", command: "bun test" };
    const stale = { name: "Board", command: "nf serve", previewUrl: "http://localhost:3000/" };
    writeFileSync(
      p.file,
      `${JSON.stringify(
        { scripts: [lint, stale, suite], defaultThreadEnvMode: "worktree", iconPath: "logo.svg" },
        null,
        2,
      )}\n`,
    );
    const run = p.call(["t3", "init"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain(`nf t3 init: updated ${p.file}`);
    expect(p.document()).toEqual({
      $schema: SCHEMA_URL,
      scripts: [lint, BOARD, suite],
      defaultThreadEnvMode: "worktree",
      iconPath: "logo.svg",
    });
  });

  test("a rerun changes nothing", () => {
    const p = project("rerun");
    expect(p.call(["t3", "init"]).code).toBe(0);
    const before = p.text();
    const again = p.call(["t3", "init", "--json"]);
    expect(again.code).toBe(0);
    expect(again.json()).toEqual({ file: p.file, created: false, changed: false, script: BOARD });
    expect(p.text()).toBe(before);
    const plain = p.call(["t3", "init"]);
    expect(plain.out).toContain(`nf t3 init: unchanged ${p.file}`);
    expect(p.document().scripts).toHaveLength(1);
  });

  test("--port moves the preview URL and the command to that port", () => {
    const p = project("port");
    const run = p.call(["t3", "init", "--port", "5000"]);
    expect(run.code).toBe(0);
    expect(p.document().scripts[0]).toEqual({
      ...BOARD,
      command: "nf serve --port 5000",
      previewUrl: "http://localhost:5000/?project=NF",
    });
    const rerun = p.call(["t3", "init", "--port", "5000"]);
    expect(rerun.out).toContain("unchanged");
    const bad = p.call(["t3", "init", "--port", "0"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--port needs a number from 1 to 65535");
  });

  test("fails clearly outside a registered project", () => {
    const unregistered = repo("unregistered");
    const outside = nf(tmp("nf-t3-home-outside-"), unregistered, ["t3", "init"]);
    expect(outside.code).toBe(1);
    expect(outside.err).toContain(`${unregistered.replaceAll("\\", "/")} is not registered`);
    expect(outside.err).toContain("nf init");
    expect(existsSync(join(unregistered, "t3.json"))).toBe(false);

    const plain = tmp("nf-t3-plain-");
    const notGit = nf(tmp("nf-t3-home-plain-"), plain, ["t3", "init"]);
    expect(notGit.code).toBe(1);
    expect(notGit.err).toContain("not inside a registered Git project");
    expect(existsSync(join(plain, "t3.json"))).toBe(false);
  });

  test("refuses a t3.json T3 Code would reject instead of overwriting it", () => {
    const p = project("invalid");
    writeFileSync(p.file, "{ not json }");
    const brokenJson = p.call(["t3", "init"]);
    expect(brokenJson.code).toBe(1);
    expect(brokenJson.err).toContain(`invalid ${p.file}`);
    expect(brokenJson.err).toContain("json:");
    expect(p.text()).toBe("{ not json }");

    writeFileSync(p.file, `${JSON.stringify({ scripts: [{ name: "Board" }] }, null, 2)}\n`);
    const brokenScript = p.call(["t3", "init"]);
    expect(brokenScript.code).toBe(1);
    expect(brokenScript.err).toContain("scripts[0].command");
  });
});
