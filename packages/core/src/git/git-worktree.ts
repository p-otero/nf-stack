import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { GitWorktree } from "@nf/contracts";
import { changeSet } from "./git-diff.ts";
import { readStatus } from "./git-status.ts";

const UNTRACKED_LIMIT = 2_000;

const decodeWorktree = Schema.decodeEffect(GitWorktree);

/** The checkout's staged and unstaged changes and its untracked files; nothing is staged or written. */
export const worktreeChanges = Effect.fn("GitWorktree.changes")(function* (
  repo: string,
  path: string,
) {
  const [status, staged, unstaged] = yield* Effect.all(
    [readStatus(path), changeSet(path, ["diff", "--cached"]), changeSet(path, ["diff"])],
    { concurrency: "unbounded" },
  );
  return yield* decodeWorktree({
    repo,
    path: path.split("\\").join("/"),
    branch: status.branch,
    head: status.head,
    staged,
    unstaged,
    untracked: status.untracked.slice(0, UNTRACKED_LIMIT),
    untrackedTruncated: status.untracked.length > UNTRACKED_LIMIT,
  });
});
