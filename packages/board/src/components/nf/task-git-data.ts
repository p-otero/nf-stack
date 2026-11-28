import type {
  GitChangeSet,
  GitCompare,
  GitCommitDetail,
  GitWorktree,
  TaskBranch,
} from "@nf/contracts";

import type { PatchSet } from "@/components/nf/git/patch-set";
import { toPatchSet } from "@/components/nf/git/patch-set";
import { boardViewHref } from "@/components/nf/git/git-model";

export const projectOfTask = (key: string): string => {
  const project = /^([A-Za-z0-9]+)-\d+$/.exec(key)?.[1];
  if (project === undefined) throw new Error(`'${key}' is not a task key`);
  return project;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorMessage = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : null;
  return message ?? `the git API answered ${response.status}`;
};

const getJson = async (href: string): Promise<unknown> => {
  const response = await fetch(href, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json().catch(() => null);
};

const isNullableCount = (value: unknown): boolean => value === null || typeof value === "number";

const isCommitRow = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value["sha"] === "string" &&
  Array.isArray(value["parents"]) &&
  typeof value["subject"] === "string" &&
  typeof value["pushed"] === "boolean";

const isBranch = (value: unknown): value is TaskBranch =>
  isRecord(value) &&
  typeof value["task"] === "string" &&
  typeof value["name"] === "string" &&
  isNullableCount(value["ahead"]) &&
  Array.isArray(value["commits"]) &&
  value["commits"].every(isCommitRow);

const isChangeSet = (value: unknown): value is GitChangeSet =>
  isRecord(value) &&
  Array.isArray(value["files"]) &&
  typeof value["patch"] === "string" &&
  typeof value["truncated"] === "boolean";

const isCompare = (value: unknown): value is GitCompare =>
  isRecord(value) &&
  typeof value["base"] === "string" &&
  typeof value["head"] === "string" &&
  isNullableCount(value["ahead"]) &&
  Array.isArray(value["files"]) &&
  typeof value["patch"] === "string";

const isCommitDetail = (value: unknown): value is GitCommitDetail =>
  isRecord(value) && isRecord(value["commit"]) && typeof value["patch"] === "string";

const isWorktree = (value: unknown): value is GitWorktree =>
  isRecord(value) &&
  typeof value["repo"] === "string" &&
  isChangeSet(value["staged"]) &&
  isChangeSet(value["unstaged"]) &&
  isChangeSet(value["untracked"]) &&
  typeof value["untrackedTruncated"] === "boolean";

export const branchHistoryHref = (
  current: string,
  branch: Pick<TaskBranch, "task" | "repo" | "name">,
): string => {
  const url = new URL(current);
  url.searchParams.set("project", projectOfTask(branch.task));
  return boardViewHref(url.href, "git", {
    repo: branch.repo,
    branch: branch.name,
    commit: null,
    worktree: null,
  });
};

/** The Git tab's full view of one commit of the task's branch. */
export const commitViewHref = (
  current: string,
  branch: Pick<TaskBranch, "task" | "repo" | "name" | "worktree">,
  commit: string,
): string => {
  const url = new URL(current);
  url.searchParams.set("project", projectOfTask(branch.task));
  return boardViewHref(url.href, "git", {
    repo: branch.repo,
    branch: branch.name,
    commit,
    worktree: branch.worktree,
  });
};

export const readTaskBranch = async (task: string): Promise<TaskBranch | null> => {
  const body = await getJson(`/api/tasks/${encodeURIComponent(task)}/branch`);
  return body === null ? null : isBranch(body) ? body : throwShape("task branch");
};

export const readTaskCompare = async (
  project: string,
  repo: string,
  base: string,
  head: string,
): Promise<GitCompare> => {
  const body = await getJson(
    `/api/git/compare?project=${encodeURIComponent(project)}&repo=${encodeURIComponent(repo)}` +
      `&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
  );
  return isCompare(body) ? body : throwShape("compare");
};

export const readTaskWorktree = async (task: string): Promise<GitWorktree> => {
  const body = await getJson(`/api/git/worktree?task=${encodeURIComponent(task)}`);
  return isWorktree(body) ? body : throwShape("worktree");
};

export const readCommitDetail = async (
  project: string,
  repo: string,
  sha: string,
): Promise<GitCommitDetail> => {
  const body = await getJson(
    `/api/git/commit?project=${encodeURIComponent(project)}&repo=${encodeURIComponent(repo)}` +
      `&sha=${encodeURIComponent(sha)}`,
  );
  return isCommitDetail(body) ? body : throwShape("commit");
};

const throwShape = (what: string): never => {
  throw new Error(`the git API answered with an unexpected ${what}`);
};

export type WorktreeChanges = {
  staged: PatchSet;
  unstaged: PatchSet;
  untracked: readonly string[];
  uncommitted: number;
  moreUntracked: boolean;
};

export const toWorktreeChanges = (worktree: GitWorktree): WorktreeChanges => {
  const untracked = worktree.untracked.files.map((file) => file.path);
  const paths = new Set([
    ...worktree.staged.files.map((file) => file.path),
    ...worktree.unstaged.files.map((file) => file.path),
    ...untracked,
  ]);
  return {
    staged: toPatchSet(worktree.staged),
    unstaged: toPatchSet(worktree.unstaged),
    untracked,
    uncommitted: paths.size,
    moreUntracked: worktree.untrackedTruncated,
  };
};
