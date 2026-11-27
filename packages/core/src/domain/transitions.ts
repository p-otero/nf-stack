import { TASK_STATUS } from "@nf/contracts";
import type { AttemptStatus, TaskStatus } from "@nf/contracts";

const S = TASK_STATUS;

/** Legal task transitions, exactly as in skills/nf-meta/references/task-contract.md. */
const NEXT: Record<TaskStatus, readonly TaskStatus[]> = {
  proposed: [S.TODO, S.CANCELLED],
  todo: [S.WORKING, S.CANCELLED],
  working: [S.REVIEW, S.BLOCKED, S.CANCELLED],
  review: [S.DONE, S.WORKING, S.CANCELLED],
  blocked: [S.TODO, S.CANCELLED],
  done: [],
  cancelled: [],
};

/** `done` and `cancelled` reopen to `todo` only on explicit request. */
const REOPEN_TARGET: TaskStatus = S.TODO;

export function isClosedStatus(s: TaskStatus): boolean {
  return s === S.DONE || s === S.CANCELLED;
}

export function isLegalTransition(from: TaskStatus, to: TaskStatus, reopen = false): boolean {
  if (reopen) return isClosedStatus(from) && to === REOPEN_TARGET;
  return NEXT[from].includes(to);
}

export function legalTargets(from: TaskStatus): readonly TaskStatus[] {
  return NEXT[from];
}

/** Attempt status moves: live states may move among themselves; final states are terminal. */
export function isLiveAttemptStatus(s: AttemptStatus): boolean {
  return s === "dispatching" || s === "active" || s === "unknown";
}
