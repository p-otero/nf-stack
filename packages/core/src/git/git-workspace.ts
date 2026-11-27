import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import * as Effect from "effect/Effect";
import { NfError } from "@nf/contracts";
import { pathKey } from "../system/git.ts";
import { gitTextOrNull } from "./git-read.ts";

const SCAN_DEPTH = 4;
const SCAN_DIRECTORY_LIMIT = 5_000;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  "venv",
  "__pycache__",
]);

const isWithin = (root: string, path: string): boolean => {
  const rootKey = pathKey(root);
  const key = pathKey(path);
  return key === rootKey || key.startsWith(`${rootKey}/`);
};

/**
 * The T3 workspace an NF project lives in: the T3 project rooted at its checkout, else the closest
 * one that contains it, else the checkout itself.
 */
export function workspaceRootOf(checkout: string, t3Roots: readonly string[]): string {
  const containing = t3Roots
    .filter((root) => root.length > 0 && isWithin(root, checkout))
    .toSorted((left, right) => pathKey(right).length - pathKey(left).length);
  return resolve(containing[0] ?? checkout);
}

/** Git repositories at and under `root`, nested ones included, to `SCAN_DEPTH` levels down. */
export async function scanRepositories(root: string): Promise<string[]> {
  const found: string[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (visited >= SCAN_DIRECTORY_LIMIT) return;
    visited += 1;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    if (entries.some((entry) => entry.name === ".git")) found.push(dir);
    if (depth >= SCAN_DEPTH) return;
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !SKIPPED_DIRECTORIES.has(entry.name.toLowerCase()),
        )
        .map((entry) => walk(join(dir, entry.name), depth + 1)),
    );
  };
  await walk(resolve(root), 0);
  return found.toSorted();
}

/** A repository's id in its workspace: its relative path with `/`, `.` for the root. */
export function repoId(workspaceRoot: string, path: string): string {
  const rel = relative(workspaceRoot, path).split(sep).join("/");
  return rel.length === 0 ? "." : rel;
}

const realPath = (path: string): string => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

const outside = (repo: string) =>
  new NfError({
    code: "repo_outside_workspace",
    message: `repository '${repo}' is outside the project's workspace`,
  });

const commonDir = (path: string) =>
  gitTextOrNull(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

/**
 * Whether the repository's object store is inside the workspace: a `.git` file can point a folder
 * inside it at a repository anywhere.
 */
export const repoGitDirInside = Effect.fn("GitWorkspace.repoGitDirInside")(function* (
  workspaceRoot: string,
  path: string,
) {
  const common = yield* commonDir(path);
  return common !== null && isWithin(realPath(workspaceRoot), realPath(common));
});

/**
 * The repository folder a `repo` parameter names: inside the workspace (after resolving links),
 * the top level of a git checkout, and with its git dir inside the workspace too.
 */
export const resolveRepo = Effect.fn("GitWorkspace.resolveRepo")(function* (
  workspaceRoot: string,
  repo: string,
) {
  const path = resolve(workspaceRoot, repo);
  if (!isWithin(workspaceRoot, path)) return yield* outside(repo);
  if (!existsSync(path)) {
    return yield* new NfError({
      code: "not_found",
      message: `repository '${repo}' does not exist`,
    });
  }
  if (!isWithin(realPath(workspaceRoot), realPath(path))) return yield* outside(repo);
  const top = yield* gitTextOrNull(path, ["rev-parse", "--show-toplevel"]);
  if (top === null || pathKey(realPath(top)) !== pathKey(realPath(path))) {
    return yield* new NfError({
      code: "not_found",
      message: `'${repo}' is not the top level of a git repository`,
    });
  }
  if (!(yield* repoGitDirInside(workspaceRoot, path))) return yield* outside(repo);
  return path;
});

/**
 * The checkout a worktree belongs to (the parent of its shared git dir), so an attempt's worktree
 * outside the workspace is accepted only when its repository is inside it.
 */
export const worktreeRepository = Effect.fn("GitWorkspace.worktreeRepository")(function* (
  workspaceRoot: string,
  worktree: string,
) {
  const common = yield* commonDir(worktree);
  if (common === null) {
    return yield* new NfError({
      code: "not_found",
      message: `'${worktree}' is not a git worktree`,
    });
  }
  const repo = resolve(common, "..");
  if (!isWithin(realPath(workspaceRoot), realPath(repo))) return yield* outside(repo);
  return repo;
});
