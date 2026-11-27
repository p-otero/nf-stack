import { useQuery } from "@tanstack/react-query";

import type { GitBranchCommit, TaskBranch } from "@nf/contracts";
import type { TaskView } from "@/lib/agent-task-types";
import {
  projectOfTask,
  readTaskBranch,
  readTaskCompare,
  readTaskWorktree,
  toPatchSet,
  toWorktreeChanges,
  type PatchSet,
  type WorktreeChanges,
} from "@/components/nf/task-git-data";

const GIT_POLL_MS = 15_000;

const NO_BRANCH_TEXT = "No branch: this task's attempts haven't created one";
const SNAPSHOT_TEXT = "No branch data: this board is a snapshot";

type Failure = { message: string; retry: () => void };

type BranchState =
  | { kind: "unavailable" }
  | { kind: "loading" }
  | ({ kind: "error" } & Failure)
  | { kind: "none" }
  | { kind: "branch"; branch: TaskBranch };

type WorktreeState =
  | { kind: "none" }
  | { kind: "loading" }
  | ({ kind: "error" } & Failure)
  | { kind: "ready"; changes: WorktreeChanges };

interface ChangesData {
  commits: readonly GitBranchCommit[];
  unpushed: number;
  all: PatchSet | undefined;
  allLoading: boolean;
  allError: Failure | undefined;
  worktree: WorktreeState;
}

const stateText = (state: Exclude<BranchState, { kind: "branch" }>): string =>
  state.kind === "unavailable"
    ? SNAPSHOT_TEXT
    : state.kind === "loading"
      ? "Reading this task's branch…"
      : state.kind === "none"
        ? NO_BRANCH_TEXT
        : `Couldn't read git: ${state.message}`;

interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data: T | undefined;
  refetch: () => Promise<unknown>;
}

const worktreeState = (
  hasWorktree: boolean,
  query: QueryLike<Parameters<typeof toWorktreeChanges>[0]>,
): WorktreeState => {
  if (!hasWorktree) return { kind: "none" };
  if (query.data !== undefined) return { kind: "ready", changes: toWorktreeChanges(query.data) };
  if (query.isError)
    return {
      kind: "error",
      message: query.error?.message ?? "the git API failed",
      retry: () => void query.refetch(),
    };
  return { kind: "loading" };
};

function useBranchState(task: TaskView | undefined, live: boolean): BranchState {
  const query = useQuery({
    queryKey: ["task-branch", task?.id ?? null],
    queryFn: () => readTaskBranch(task?.id ?? ""),
    enabled: live && task !== undefined,
    refetchInterval: GIT_POLL_MS,
  });
  if (!live || task === undefined) return { kind: "unavailable" };
  if (query.isPending) return { kind: "loading" };
  if (query.isError)
    return { kind: "error", message: query.error.message, retry: () => void query.refetch() };
  return query.data === null || query.data === undefined
    ? { kind: "none" }
    : { kind: "branch", branch: query.data };
}

function useChanges(task: TaskView | undefined, state: BranchState): ChangesData | undefined {
  const branch = state.kind === "branch" ? state.branch : undefined;
  const project = task === undefined ? "" : projectOfTask(task.id);
  const comparable = branch !== undefined && branch.base !== null && branch.head !== null;
  const compare = useQuery({
    queryKey: [
      "task-compare",
      project,
      branch?.repo ?? null,
      branch?.base ?? null,
      branch?.head ?? null,
    ],
    queryFn: () => {
      if (branch === undefined || branch.base === null || branch.head === null)
        throw new Error("this branch has no base to diff against");
      return readTaskCompare(project, branch.repo, branch.base, branch.head);
    },
    enabled: comparable,
    refetchInterval: GIT_POLL_MS,
  });
  const hasWorktree = branch?.worktree != null;
  const worktree = useQuery({
    queryKey: ["task-worktree", task?.id ?? null],
    queryFn: () => readTaskWorktree(task?.id ?? ""),
    enabled: hasWorktree,
    refetchInterval: GIT_POLL_MS,
  });
  if (branch === undefined) return undefined;
  return {
    commits: branch.commits,
    unpushed: branch.unpushed ?? branch.commits.filter((commit) => !commit.pushed).length,
    all: compare.data === undefined ? undefined : toPatchSet(compare.data),
    allLoading: comparable && compare.isPending,
    allError:
      compare.isError && comparable
        ? { message: compare.error.message, retry: () => void compare.refetch() }
        : undefined,
    worktree: worktreeState(hasWorktree, worktree),
  };
}

export { stateText, useBranchState, useChanges, worktreeState };
export type { BranchState, ChangesData, Failure, WorktreeState };
