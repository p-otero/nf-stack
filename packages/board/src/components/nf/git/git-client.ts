import type {
  GitBranch,
  GitCommitDetail,
  GitLogPage,
  GitRepo,
  GitWorktree,
  GitWorktreeEntry,
} from "@nf/contracts";
import type { Writable } from "@/contract";

export const gitApiBase = (api: string): string =>
  api.endsWith("/api/board") ? `${api.slice(0, -"/api/board".length)}/api/git` : "/api/git";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRepo = (value: unknown): boolean =>
  isRecord(value) && typeof value["id"] === "string" && typeof value["path"] === "string";

const isBranch = (value: unknown): boolean =>
  isRecord(value) && typeof value["name"] === "string" && typeof value["head"] === "string";

const isCommit = (value: unknown): boolean =>
  isRecord(value) && typeof value["sha"] === "string" && Array.isArray(value["parents"]);

const isChangeSet = (value: unknown): boolean =>
  isRecord(value) && Array.isArray(value["files"]) && typeof value["patch"] === "string";

const isWorktreeEntry = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value["path"] === "string" &&
  (value["branch"] === null || typeof value["branch"] === "string") &&
  typeof value["main"] === "boolean" &&
  typeof value["locked"] === "boolean" &&
  typeof value["prunable"] === "boolean";

const errorMessage = (body: unknown): string | null =>
  isRecord(body) && typeof body["error"] === "string" ? body["error"] : null;

const href = (
  base: string,
  route: "repos" | "worktrees" | "branches" | "log" | "commit" | "worktree",
  project: string,
  params: Record<string, string | null | undefined>,
): string => {
  const search = new URLSearchParams({ project });
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value.length > 0) search.set(name, value);
  }
  return `${base}/${route}?${search.toString()}`;
};

const readGit = async <T>(
  url: string,
  isPayload: (value: unknown) => value is T,
  what: string,
): Promise<T> => {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(body) ?? `the git API answered ${response.status}`);
  }
  if (!isPayload(body)) throw new Error(`the git API answered ${what} with an unexpected shape`);
  return body;
};

const isRepoList = (value: unknown): value is Writable<GitRepo>[] =>
  Array.isArray(value) && value.every(isRepo);

const isBranchList = (value: unknown): value is Writable<GitBranch>[] =>
  Array.isArray(value) && value.every(isBranch);

const isLogPage = (value: unknown): value is Writable<GitLogPage> =>
  isRecord(value) &&
  Array.isArray(value["commits"]) &&
  value["commits"].every(isCommit) &&
  (value["total"] === null || typeof value["total"] === "number") &&
  (value["next"] === null || typeof value["next"] === "string");

const isCommitDetail = (value: unknown): value is Writable<GitCommitDetail> =>
  isRecord(value) && isCommit(value["commit"]) && typeof value["patch"] === "string";

const isWorktree = (value: unknown): value is Writable<GitWorktree> =>
  isRecord(value) &&
  isChangeSet(value["staged"]) &&
  isChangeSet(value["unstaged"]) &&
  isChangeSet(value["untracked"]);

const isWorktreeList = (value: unknown): value is Writable<GitWorktreeEntry>[] =>
  Array.isArray(value) && value.every(isWorktreeEntry);

export const readGitRepos = (base: string, project: string): Promise<Writable<GitRepo>[]> =>
  readGit(href(base, "repos", project, {}), isRepoList, "the repositories");

export const readGitWorktrees = (
  base: string,
  project: string,
  repo: string,
): Promise<Writable<GitWorktreeEntry>[]> =>
  readGit(href(base, "worktrees", project, { repo }), isWorktreeList, "the worktrees");

export const readGitBranches = (
  base: string,
  project: string,
  repo: string,
  worktree: string | null,
): Promise<Writable<GitBranch>[]> =>
  readGit(href(base, "branches", project, { repo, worktree }), isBranchList, "the branches");

export const readGitLog = (
  base: string,
  project: string,
  repo: string,
  worktree: string | null,
  branch: string | null,
  cursor: string | null,
): Promise<Writable<GitLogPage>> =>
  readGit(href(base, "log", project, { repo, worktree, branch, cursor }), isLogPage, "the history");

export const readGitCommit = (
  base: string,
  project: string,
  repo: string,
  sha: string,
): Promise<Writable<GitCommitDetail>> =>
  readGit(href(base, "commit", project, { repo, sha }), isCommitDetail, "the commit");

export const readGitWorktree = (
  base: string,
  project: string,
  repo: string,
  worktree: string | null,
): Promise<Writable<GitWorktree>> =>
  readGit(href(base, "worktree", project, { repo, worktree }), isWorktree, "the working tree");
