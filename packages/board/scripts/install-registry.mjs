// Reinstalls the Eskais UI Agent Task Board from the registry pinned in components.json.
// This is the only step that needs the network; `nf board` only injects data into the bundle.
// After shadcn writes the UI SDK betas as ranges, they are pinned again to the checked version.
// shadcn itself runs from the exact version in devDependencies so the output stays reproducible.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const board = resolve(import.meta.dirname, "..");
const manifestPath = join(board, "package.json");
const ITEMS = [
  "@eskais/theme",
  "@eskais/theme-glass",
  "@eskais/font-geist",
  "@eskais/floating",
  "@eskais/card",
  "@eskais/liveness-indicator",
  "@eskais/appearance",
  "@eskais/agent-task-board",
  "@eskais/badge",
  "@eskais/chart",
  "@eskais/data-table",
  "@eskais/meter",
  "@eskais/stat",
  "@eskais/tabs",
  "@eskais/attachments",
  "@eskais/lightbox",
  "@eskais/stage-track",
  "@eskais/list-item",
  "@eskais/textarea",
  "@eskais/repository-select",
  "@eskais/commit-history",
  "@eskais/git-diff",
  "@eskais/git-tree",
];
const PINNED = { "@ui-sdk/core": "0.1.0-beta.12", "@ui-sdk/react": "0.1.0-beta.12" };

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: board,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const shadcnVersion = readManifest().devDependencies.shadcn;
if (!/^\d+\.\d+\.\d+$/.test(shadcnVersion)) {
  throw new Error(
    `shadcn must be pinned to an exact version in ${manifestPath}, found ${shadcnVersion}`,
  );
}

/**
 * shadcn 4.23.0 tests `"use client"` with one global regex shared by every file, so a match leaves
 * `lastIndex` behind and the next file keeps a directive it meant to remove. With `rsc` false it
 * then drops it from every other file, in file order, and any change to the installed items flips
 * which ones. Kept true, shadcn writes the registry files verbatim and a reinstall changes nothing.
 */
const configPath = join(board, "components.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.rsc !== true) {
  throw new Error(
    `components.json must keep "rsc": true so a reinstall leaves the files alone: ${configPath}`,
  );
}

/**
 * The registry URL is the pin: shadcn resolves every `@eskais/*` item, and each dependency those
 * pull in, through it. A branch or a local server would install code no tag names, so only a
 * release tag is accepted here.
 */
const releaseTag =
  /^https:\/\/raw\.githubusercontent\.com\/p-otero\/eskais-ui\/refs\/tags\/v\d+\.\d+\.\d+\/public\/r\/\{name\}\.json$/;
if (!releaseTag.test(config.registries?.["@eskais"] ?? "")) {
  throw new Error(
    `components.json must pin the @eskais registry to a release tag, found ${String(
      config.registries?.["@eskais"],
    )}: ${configPath}`,
  );
}

run("bun", ["x", `shadcn@${shadcnVersion}`, "add", ...ITEMS, "--yes", "--overwrite"]);

/**
 * A flush dialog drops its body's horizontal inset, and the task dialog's header and body share
 * that inset, so its body has to pad its own sides. v0.2.5 ships that; a later pin that loses it
 * would render the dialog's sections against its edges.
 */
const bodyInset = "in-data-dialog-flush:px-inset-surface";
const taskDialogPath = join(board, "src/components/ui/task-detail-dialog.tsx");
if (!readFileSync(taskDialogPath, "utf8").includes(bodyInset)) {
  throw new Error(`the task dialog body no longer reads ${bodyInset}: ${taskDialogPath}`);
}

const manifest = readManifest();
manifest.dependencies = { ...manifest.dependencies, ...PINNED };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
run("bun", ["install"]);
