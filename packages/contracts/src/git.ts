/** Read-only git views `nf serve` answers for the board's Git tab and task dialog. */
import * as Schema from "effect/Schema";

export const GIT_FILE_STATUS = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
  COPIED: "copied",
  TYPE_CHANGED: "type_changed",
  UNMERGED: "unmerged",
  UNKNOWN: "unknown",
} as const;
export type GitFileStatus = (typeof GIT_FILE_STATUS)[keyof typeof GIT_FILE_STATUS];
export const GitFileStatus = Schema.Literals(Object.values(GIT_FILE_STATUS));

/** Most patch bytes and files one response carries before it is cut with `truncated: true`. */
export const GIT_PATCH_LIMITS = { bytes: 2 * 1024 * 1024, files: 300 } as const;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NullableCount = Schema.NullOr(Count);
const NullableString = Schema.NullOr(Schema.String);

export const GitRepo = Schema.Struct({
  /** The path relative to the workspace root, `/`-separated; `.` is the root itself. */
  id: Schema.String,
  path: Schema.String,
  /** Null on a detached HEAD. */
  branch: NullableString,
  /** Null before the first commit. */
  head: NullableString,
  dirty: Schema.Boolean,
  uncommitted: Count,
  ahead: NullableCount,
  behind: NullableCount,
  upstream: NullableString,
  /** The URL of the upstream's remote, else of `origin`. */
  remote: NullableString,
  commits: NullableCount,
});
export type GitRepo = typeof GitRepo.Type;
export const GitRepoList = Schema.Array(GitRepo);

export const GitBranch = Schema.Struct({
  name: Schema.String,
  head: Schema.String,
  current: Schema.Boolean,
  upstream: NullableString,
  /** Commits the branch has that `base` lacks, and the reverse; null when there is no base. */
  ahead: NullableCount,
  behind: NullableCount,
  /** Commits not on the upstream; null without one. */
  unpushed: NullableCount,
  base: NullableString,
  updatedAt: NullableString,
  author: NullableString,
});
export type GitBranch = typeof GitBranch.Type;
export const GitBranchList = Schema.Array(GitBranch);

export const GitCommit = Schema.Struct({
  sha: Schema.String,
  parents: Schema.Array(Schema.String),
  author: Schema.String,
  email: Schema.String,
  date: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  refs: Schema.Array(Schema.String),
  /** From `--shortstat`; null where git prints none (merges, empty commits). */
  filesChanged: NullableCount,
  insertions: NullableCount,
  deletions: NullableCount,
});
export type GitCommit = typeof GitCommit.Type;

export const GitLogPage = Schema.Struct({
  commits: Schema.Array(GitCommit),
  total: NullableCount,
  /** The cursor of the next page, null on the last one. */
  next: NullableString,
});
export type GitLogPage = typeof GitLogPage.Type;

export const GitFileChange = Schema.Struct({
  path: Schema.String,
  status: GitFileStatus,
  /** The old path of a rename or copy. */
  from: NullableString,
  /** Null for binary files. */
  additions: NullableCount,
  deletions: NullableCount,
});
export type GitFileChange = typeof GitFileChange.Type;

export const GitChangeSet = Schema.Struct({
  files: Schema.Array(GitFileChange),
  patch: Schema.String,
  /** The patch stops at a file boundary before `GIT_PATCH_LIMITS`. */
  truncated: Schema.Boolean,
});
export type GitChangeSet = typeof GitChangeSet.Type;

export const GitCommitDetail = Schema.Struct({
  commit: GitCommit,
  /** The parent the change is against: the first one for a merge, null for a root commit. */
  parent: NullableString,
  files: Schema.Array(GitFileChange),
  patch: Schema.String,
  truncated: Schema.Boolean,
  tree: Schema.Array(Schema.String),
  treeTruncated: Schema.Boolean,
});
export type GitCommitDetail = typeof GitCommitDetail.Type;

export const GitCompare = Schema.Struct({
  base: Schema.String,
  head: Schema.String,
  mergeBase: NullableString,
  ahead: NullableCount,
  behind: NullableCount,
  commits: Schema.Array(GitCommit),
  commitsTruncated: Schema.Boolean,
  files: Schema.Array(GitFileChange),
  patch: Schema.String,
  truncated: Schema.Boolean,
});
export type GitCompare = typeof GitCompare.Type;

export const GitWorktree = Schema.Struct({
  /** The repository's id in the workspace. */
  repo: Schema.String,
  path: Schema.String,
  branch: NullableString,
  head: NullableString,
  staged: GitChangeSet,
  unstaged: GitChangeSet,
  untracked: Schema.Array(Schema.String),
  untrackedTruncated: Schema.Boolean,
});
export type GitWorktree = typeof GitWorktree.Type;

export const GitBranchCommit = Schema.Struct({
  ...GitCommit.fields,
  pushed: Schema.Boolean,
});
export type GitBranchCommit = typeof GitBranchCommit.Type;

export const TaskPullRequest = Schema.Struct({
  url: Schema.String,
  number: NullableCount,
  /** `gh`'s state, null when it could not be asked. */
  state: NullableString,
});
export type TaskPullRequest = typeof TaskPullRequest.Type;

export const TaskBranch = Schema.Struct({
  task: Schema.String,
  attempt: Schema.String,
  repo: Schema.String,
  repoPath: Schema.String,
  name: Schema.String,
  head: NullableString,
  base: NullableString,
  upstream: NullableString,
  ahead: NullableCount,
  behind: NullableCount,
  unpushed: NullableCount,
  /** The attempt's worktree when it still exists. */
  worktree: NullableString,
  uncommitted: NullableCount,
  commits: Schema.Array(GitBranchCommit),
  commitsTruncated: Schema.Boolean,
  pullRequest: Schema.NullOr(TaskPullRequest),
});
export type TaskBranch = typeof TaskBranch.Type;
export const TaskBranchResponse = Schema.NullOr(TaskBranch);
