import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { gitTextOrNull } from "../git/git-read.ts";

export interface GitInfo {
  /** Durable primary checkout (never a linked worktree). */
  root: string;
  remoteUrl: string | null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Locate the Git project for `cwd`. From a linked worktree this still returns the primary
 * checkout (the parent of the shared git dir), so worktrees map to the registered project.
 */
export function gitInfo(cwd: string): GitInfo | null {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common) {
    const bare = git(cwd, ["rev-parse", "--is-bare-repository"]) === "true";
    const root = bare ? common : resolve(common, "..");
    const remote = git(cwd, ["config", "--get", "remote.origin.url"]);
    return { root: normalizePath(root), remoteUrl: remote && remote.length > 0 ? remote : null };
  }
  return null;
}

/** Forward-slash, no trailing slash, absolute. */
export function normalizePath(p: string): string {
  const abs = resolve(p).replace(/\\/g, "/");
  return abs.length > 1 ? abs.replace(/\/+$/, "") : abs;
}

/** Comparison key: case-insensitive on Windows. */
export function pathKey(p: string): string {
  const n = normalizePath(p);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** One path `base..ref` changed, with its added and deleted lines and whether the ref created it. */
export interface GitChangedFile {
  readonly path: string;
  readonly lines: number;
  readonly added: boolean;
}

const lineCount = (field: string | undefined): number => {
  const count = Number.parseInt(field ?? "", 10);
  return Number.isNaN(count) ? 0 : count;
};

/** The same settings for both halves of the diff, so `numstat` and `name-status` agree on paths. */
const DIFF_OPTIONS = ["-c", "core.quotepath=false", "diff", "--no-renames"] as const;

/** `git diff --numstat base..ref`, with the created paths marked; null when git cannot answer. */
export const changedFiles = Effect.fn("Git.changedFiles")(function* (
  root: string,
  base: string,
  ref: string,
) {
  const range = `${base}..${ref}`;
  const [numstat, created] = yield* Effect.all(
    [
      gitTextOrNull(root, [...DIFF_OPTIONS, "--numstat", range]),
      gitTextOrNull(root, [...DIFF_OPTIONS, "--name-status", "--diff-filter=A", range]),
    ],
    { concurrency: 2 },
  );
  if (numstat === null || created === null) return null;
  const added = new Set(
    created
      .split("\n")
      .map((line) => line.split("\t")[1] ?? "")
      .filter((path) => path.length > 0),
  );
  const files: GitChangedFile[] = [];
  for (const line of numstat.split("\n")) {
    if (line.length === 0) continue;
    const [addedLines, deletedLines, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (path.length === 0) continue;
    files.push({
      path,
      lines: lineCount(addedLines) + lineCount(deletedLines),
      added: added.has(path),
    });
  }
  return files;
});
