#!/usr/bin/env node
// Builds the published package: one JavaScript bundle for the CLI and its @nf/* code, the prebuilt
// board page and model traits it reads at runtime, the nf-* skills, the licence and the third-party
// notices. Node refuses to strip types under node_modules, so no TypeScript may reach the tarball.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PACKAGE = resolve(import.meta.dirname, "..");
const ROOT = resolve(PACKAGE, "..", "..");
const DIST = join(PACKAGE, "dist");
const BOARD = join(ROOT, "packages", "board", "dist", "index.html");
const SKILLS = join(ROOT, "skills");

const fail = (message) => {
  process.stderr.write(`nf package: ${message}\n`);
  process.exit(1);
};

const describe = (path) => `${(statSync(path).size / 1024).toFixed(0)} KiB`;

function run(title, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", env: process.env });
  if (result.error !== undefined) fail(`${title} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${title} failed:\n${result.stdout}${result.stderr}`);
  return result;
}

const ENTRY = join(ROOT, "packages", "cli", "src", "main.ts");
const BUNDLE = join(DIST, "main.js");

/** Everything except `sharp`: its native binary cannot be bundled, so the manifest depends on it. */
function bundle() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  run("bun build", "bun", [
    "build",
    ENTRY,
    "--target=node",
    "--format=esm",
    `--outfile=${BUNDLE}`,
    "--external",
    "sharp",
  ]);
  console.log(`${BUNDLE}: ${describe(BUNDLE)}`);
}

/** Runtime data files the bundle resolves with `new URL("../..", import.meta.url)`. */
function bundleData() {
  cpSync(
    join(ROOT, "packages", "core", "src", "policy", "model-traits.yaml"),
    join(DIST, "model-traits.yaml"),
  );
  if (!existsSync(BOARD)) run("board bundle", "bun", ["run", "board:build"]);
  mkdirSync(join(DIST, "board"), { recursive: true });
  cpSync(BOARD, join(DIST, "board", "index.html"));
  console.log(
    `${join(DIST, "board", "index.html")}: ${describe(join(DIST, "board", "index.html"))}`,
  );
}

/** The skills the CLI links into `~/.agents/skills` and `~/.claude/skills`, and reads templates from. */
function skills() {
  const target = join(PACKAGE, "skills");
  rmSync(target, { recursive: true, force: true });
  for (const name of readdirSync(SKILLS).filter((entry) => entry.startsWith("nf-"))) {
    cpSync(join(SKILLS, name), join(target, name), { recursive: true });
  }
  console.log(`${target}: ${readdirSync(target).join(", ")}`);
}

function documents() {
  for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md", "README.md"]) {
    cpSync(join(ROOT, name), join(PACKAGE, name));
  }
}

bundle();
bundleData();
skills();
documents();
