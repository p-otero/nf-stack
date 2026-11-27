import type { GitBranch, GitCommit, GitFileChange, GitRepo, GitWorktree } from "@nf/contracts";
import type { Writable } from "@/contract";
import type { Commit } from "@/lib/commit-graph";
import type { GitTreeFile } from "@/lib/git-status";
import { toViewFiles } from "@/components/ui/diff-view-model";
import type { Repository } from "@/components/ui/repository-select";
import { parsePatch } from "@/lib/diff-patch";

export type GitTabLocation = {
  repo: string | null;
  branch: string | null;
  commit: string | null;
};

export type BoardViewId = "tasks" | "telemetry" | "git";

const param = (params: URLSearchParams, name: string): string | null => {
  const value = params.get(name);
  return value === null || value.length === 0 ? null : value;
};

export const parseGitTabLocation = (search: string): GitTabLocation => {
  const params = new URLSearchParams(search);
  return {
    repo: param(params, "repo"),
    branch: param(params, "branch"),
    commit: param(params, "commit"),
  };
};

export const parseBoardView = (search: string): BoardViewId => {
  const view = new URLSearchParams(search).get("view");
  return view === "git" || view === "telemetry" ? view : "tasks";
};

const setParam = (url: URL, name: string, value: string | null): void => {
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
};

export const NO_GIT_LOCATION: GitTabLocation = { repo: null, branch: null, commit: null };

const setGitParams = (url: URL, git: GitTabLocation): void => {
  setParam(url, "repo", git.repo);
  setParam(url, "branch", git.branch);
  setParam(url, "commit", git.commit);
};

export const boardViewHref = (href: string, view: BoardViewId, git: GitTabLocation): string => {
  const url = new URL(href);
  if (view === "tasks") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  setGitParams(url, view === "git" ? git : NO_GIT_LOCATION);
  return `${url.pathname}${url.search}`;
};

export const withoutGitLocation = (href: string): string => {
  const url = new URL(href);
  setGitParams(url, NO_GIT_LOCATION);
  return `${url.pathname}${url.search}`;
};

export const repoName = (repo: Pick<Writable<GitRepo>, "id" | "path">): string =>
  repo.id === "."
    ? (repo.path.split(/[\\/]/).findLast((part) => part.length > 0) ?? repo.path)
    : repo.id;

export const toRepository = (repo: Writable<GitRepo>): Repository => ({
  value: repo.id,
  name: repoName(repo),
  path: repo.path,
  branch: repo.branch ?? undefined,
  uncommitted: repo.uncommitted,
  ahead: repo.ahead,
  behind: repo.behind,
  remote: repo.remote === null ? false : repo.upstream === null ? undefined : true,
});

const tagOf = (ref: string): string | null =>
  ref.startsWith("tag: ") && ref.length > 5 ? ref.slice(5) : null;

const toHistoryCommit = (commit: Writable<GitCommit>): Commit => ({
  id: commit.sha,
  parents: commit.parents,
  message: commit.subject,
  date: commit.date,
  author: commit.author,
  hash: commit.sha.slice(0, 7),
  body: commit.body.trim().length > 0 ? commit.body : undefined,
  tags: commit.refs.flatMap((ref) => {
    const tag = tagOf(ref);
    return tag === null ? [] : [{ label: tag }];
  }),
  stats:
    commit.filesChanged === null || commit.insertions === null || commit.deletions === null
      ? undefined
      : {
          files: commit.filesChanged,
          additions: commit.insertions,
          deletions: commit.deletions,
        },
});

export const toHistoryCommits = (commits: readonly Writable<GitCommit>[]): Commit[] =>
  commits.map(toHistoryCommit);

export const branchNamesOf = (branches: readonly Writable<GitBranch>[]): string[] =>
  branches.map((branch) => branch.name);

// git decorates the upstream's commit with the upstream's name; it is unknown until its page is read.
export const upstreamHeadOf = (
  commits: readonly Writable<GitCommit>[],
  upstream: string | null,
): string | undefined =>
  upstream === null
    ? undefined
    : (commits.find((commit) => commit.refs.includes(upstream))?.sha ?? undefined);

export type WorktreeCounts = {
  staged: number;
  unstaged: number;
  untracked: number;
  files: number;
};

const pathsOf = (files: readonly Writable<GitFileChange>[]): string[] =>
  files.map((file) => file.path);

export const worktreeCounts = (worktree: Writable<GitWorktree>): WorktreeCounts => {
  const staged = new Set(pathsOf(worktree.staged.files));
  const unstaged = new Set([...pathsOf(worktree.unstaged.files), ...worktree.untracked]);
  return {
    staged: staged.size,
    unstaged: unstaged.size,
    untracked: new Set(worktree.untracked).size,
    files: new Set([...staged, ...unstaged]).size,
  };
};

const TREE_STATUS: Partial<Record<Writable<GitFileChange>["status"], GitTreeFile["status"]>> = {
  added: "added",
  copied: "renamed",
  deleted: "deleted",
  modified: "modified",
  renamed: "renamed",
  type_changed: "modified",
  unmerged: "modified",
};

export const toTreeFiles = (
  tree: readonly string[],
  files: readonly Writable<GitFileChange>[],
): (string | GitTreeFile)[] => {
  const changed = new Map<string, GitTreeFile>();
  for (const file of files) {
    const status = TREE_STATUS[file.status];
    if (status !== undefined)
      changed.set(file.path, { path: file.path, status, from: file.from ?? undefined });
  }
  return tree.map((path) => changed.get(path) ?? path);
};

/** The first file a commit's patch carries, which is what the diff can open; `undefined` when it carries none. */
export const firstDiffPath = (patch: string): string | undefined => {
  if (patch === "") return undefined;
  const path = toViewFiles(parsePatch(patch))[0]?.path;
  return path === "" ? undefined : path;
};
