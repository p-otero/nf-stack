import * as Effect from "effect/Effect";
import { WRITING_KINDS } from "@nf/contracts";
import type { Attempt, TaskEvent } from "@nf/contracts";
import { classifyUiChange, UI_CHANGE_EVENT } from "../domain/ui-change.ts";
import type { UiReviewPolicy } from "../domain/ui-change.ts";
import { changedFiles } from "../system/git.ts";

/** The attempt whose result is accepted: the newest one that wrote code. */
export const acceptedAttempt = (attempts: readonly Attempt[]): Attempt | undefined =>
  attempts.findLast((attempt) => WRITING_KINDS.includes(attempt.kind)) ?? attempts.at(-1);

/**
 * The accepted attempt's change over `ui.review.paths`: `base_commit` to its last recorded commit,
 * or to its branch. Null without a review policy, an attempt or a ref git can diff.
 */
export const uiChangeOf = Effect.fn("UiChange.of")(function* (input: {
  readonly root: string;
  readonly attempts: readonly Attempt[];
  readonly review: UiReviewPolicy | null;
}) {
  if (input.review === null) return null;
  const attempt = acceptedAttempt(input.attempts);
  const base = attempt?.base_commit ?? null;
  const ref = attempt?.commits.at(-1) ?? attempt?.branch ?? null;
  if (base === null || ref === null) return null;
  const files = yield* changedFiles(input.root, base, ref);
  return files === null ? null : classifyUiChange(files, input.review);
});

/** The recorded verdict of an acceptance, which outranks a fresh diff. */
export const recordedUiChange = (events: readonly TaskEvent[]): string | null =>
  events.findLast((event) => event.kind === UI_CHANGE_EVENT)?.note ?? null;

/** What `nf task show` and the board say about a `ui` task: its accept decision, else its size. */
export const taskUiChange = Effect.fn("UiChange.task")(function* (input: {
  readonly root: string;
  readonly attempts: readonly Attempt[];
  readonly review: UiReviewPolicy | null;
  readonly events: readonly TaskEvent[];
}) {
  const recorded = recordedUiChange(input.events);
  if (recorded !== null) return recorded;
  const change = yield* uiChangeOf(input);
  return change?.text ?? null;
});
