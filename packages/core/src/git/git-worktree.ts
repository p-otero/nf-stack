import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  GIT_FILE_STATUS,
  GIT_PATCH_LIMITS,
  GitWorktree,
  GitWorktreeList,
  NfError,
} from "@nf/contracts";
import type { GitChangeSet, GitFileChange, GitWorktreeEntry } from "@nf/contracts";
import { pathKey } from "../system/git.ts";
import { capPatch, changeSet, DIFF_FLAGS } from "./git-diff.ts";
import { gitText, readGit } from "./git-read.ts";
import { readStatus } from "./git-status.ts";

const UNTRACKED_LIMIT = 2_000;
const UNTRACKED_BATCH = 8;

const decodeWorktree = Schema.decodeEffect(GitWorktree);
const decodeWorktrees = Schema.decodeEffect(GitWorktreeList);

const branchOf = (ref: string): string =>
  ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;

interface ParsedWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  locked: boolean;
  prunable: boolean;
}

/** `git worktree list --porcelain`: one block per checkout, the repository's own first. */
export function parseWorktreeList(text: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let entry: ParsedWorktree | null = null;
  const close = () => {
    if (entry !== null) entries.push({ ...entry, main: entries.length === 0 });
    entry = null;
  };
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      close();
      continue;
    }
    if (line.startsWith("worktree ")) {
      close();
      entry = {
        path: line.slice("worktree ".length),
        branch: null,
        head: null,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (entry === null) continue;
    if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) entry.branch = branchOf(line.slice("branch ".length));
    else if (line === "locked" || line.startsWith("locked ")) entry.locked = true;
    else if (line === "prunable" || line.startsWith("prunable ")) entry.prunable = true;
  }
  close();
  return entries;
}

/** Every checkout of the repository: its own, and the worktrees linked to it. */
export const listWorktrees = Effect.fn("GitWorktree.list")(function* (repo: string) {
  const text = yield* gitText(repo, ["worktree", "list", "--porcelain"]);
  return yield* decodeWorktrees(parseWorktreeList(text));
});

/**
 * The checkout a `worktree` parameter names: the repository itself when none is asked for, else one
 * of its worktrees; a path that is not one of them is refused rather than read.
 */
export const worktreeAt = Effect.fn("GitWorktree.at")(function* (
  repo: string,
  requested: string | null,
) {
  if (requested === null) return repo;
  const worktrees = yield* listWorktrees(repo);
  const key = pathKey(requested);
  const entry = worktrees.find((candidate) => pathKey(candidate.path) === key);
  if (entry === undefined) {
    return yield* new NfError({
      code: "invalid_value",
      message: `'${requested}' is not a worktree of this repository`,
    });
  }
  return entry.path;
});

const countsOf = (patch: string): Pick<GitFileChange, "additions" | "deletions"> => {
  if (patch.includes("\nBinary files ")) return { additions: null, deletions: null };
  const hunks = patch.indexOf("\n@@ ");
  const additions =
    hunks === -1
      ? 0
      : patch
          .slice(hunks + 1)
          .split("\n")
          .filter((line) => line.startsWith("+")).length;
  return { additions, deletions: 0 };
};

/**
 * `git diff --no-index` of an untracked file against nothing: an added file, its contents and
 * git's own binary and no-newline markers. An empty file still gets its `new file mode` header.
 */
const untrackedPatch = Effect.fnUntraced(function* (cwd: string, path: string) {
  return yield* readGit(cwd, ["diff", ...DIFF_FLAGS, "--no-index", "--", "/dev/null", path], {
    maxBytes: GIT_PATCH_LIMITS.bytes + 1,
    okCodes: [0, 1],
  });
});

/** Untracked files as one change set of added files, bounded like every other patch. */
const untrackedChanges = Effect.fnUntraced(function* (cwd: string, paths: readonly string[]) {
  const files: GitFileChange[] = [];
  const patches: string[] = [];
  let bytes = 0;
  let capped = false;
  const uncounted = (path: string) =>
    files.push({
      path,
      status: GIT_FILE_STATUS.ADDED,
      from: null,
      additions: null,
      deletions: null,
    });
  const room = () =>
    !capped && patches.length < GIT_PATCH_LIMITS.files && bytes < GIT_PATCH_LIMITS.bytes;
  for (let at = 0; at < paths.length; at += UNTRACKED_BATCH) {
    const batch = paths.slice(at, at + UNTRACKED_BATCH);
    if (!room()) {
      capped = true;
      batch.forEach(uncounted);
      continue;
    }
    const read = yield* Effect.forEach(
      batch,
      (path) =>
        untrackedPatch(cwd, path).pipe(
          Effect.map((output) => ({ path, output })),
          // A file that vanished between git's listing and this read is left uncounted, not fatal.
          Effect.catchTags({ NfError: () => Effect.succeed({ path, output: null }) }),
        ),
      { concurrency: UNTRACKED_BATCH },
    );
    for (const { path, output } of read) {
      if (output === null) {
        uncounted(path);
        continue;
      }
      if (output.cut) {
        capped = true;
        uncounted(path);
        continue;
      }
      if (!room()) {
        capped = true;
        uncounted(path);
        continue;
      }
      const text = output.stdout;
      patches.push(text);
      bytes += Buffer.byteLength(text);
      files.push({ path, status: GIT_FILE_STATUS.ADDED, from: null, ...countsOf(text) });
    }
  }
  const cut = capPatch(patches.join(""), capped);
  const set: GitChangeSet = { files, patch: cut.patch, truncated: cut.truncated };
  return set;
});

/** The checkout's staged, unstaged and untracked changes; nothing is staged or written. */
export const worktreeChanges = Effect.fn("GitWorktree.changes")(function* (
  repo: string,
  path: string,
) {
  const [status, staged, unstaged] = yield* Effect.all(
    [readStatus(path), changeSet(path, ["diff", "--cached"]), changeSet(path, ["diff"])],
    { concurrency: "unbounded" },
  );
  const untracked = status.untracked.slice(0, UNTRACKED_LIMIT);
  return yield* decodeWorktree({
    repo,
    path: path.split("\\").join("/"),
    branch: status.branch,
    head: status.head,
    staged,
    unstaged,
    untracked: yield* untrackedChanges(path, untracked),
    untrackedTruncated: status.untracked.length > UNTRACKED_LIMIT,
  });
});
