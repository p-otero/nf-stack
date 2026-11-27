import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ACTOR_ROLE,
  ATTEMPT_FAILURE,
  ATTEMPT_LIVENESS,
  ATTEMPT_STATUS,
  AttemptLivenessReport,
  DEFAULT_STALL_MINUTES,
  MECHANISM,
} from "@nf/contracts";
import type {
  Attempt,
  AttemptLiveness,
  AttemptLivenessChange,
  AttemptLivenessReport as AttemptLivenessReportType,
  AttemptLivenessView,
} from "@nf/contracts";
import { classifyThread, pendingThreadVerdict } from "../domain/liveness.ts";
import type { ThreadActivity } from "../domain/liveness.ts";
import { errorText } from "../domain/errors.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import { readDelegations, readSentRuns, readThreadActivity } from "../sources/t3-liveness.ts";
import type { DelegatedThread } from "../sources/t3-liveness.ts";

const decodeReport = Schema.decodeEffect(AttemptLivenessReport);

export interface AttemptLivenessOptions {
  /** T3 Code's `statev2.sqlite`; read-only, never written or copied. */
  t3State: string;
  /** Minutes of silence that make a running run stalled. */
  stallMinutes?: number | undefined;
  now?: Date | undefined;
  /** Record `missing` as `unknown` and `finished_failed` as `failed`. Never touches tasks. */
  apply?: boolean | undefined;
  /** A missing or unreadable source yields null liveness instead of an error. */
  bestEffort?: boolean | undefined;
}

/** What `--apply` would do for this view, or does when applied. */
function changeOf(view: AttemptLivenessView): AttemptLivenessChange | null {
  if (view.status === ATTEMPT_STATUS.UNKNOWN && view.liveness === ATTEMPT_LIVENESS.MISSING) {
    return null;
  }
  if (view.liveness === ATTEMPT_LIVENESS.MISSING) {
    return {
      attempt: view.attempt,
      from: view.status,
      to: ATTEMPT_STATUS.UNKNOWN,
      liveness: view.liveness,
    };
  }
  if (view.liveness === ATTEMPT_LIVENESS.FINISHED_FAILED) {
    return {
      attempt: view.attempt,
      from: view.status,
      to: ATTEMPT_STATUS.FAILED,
      liveness: view.liveness,
    };
  }
  return null;
}

interface Dispatch {
  attempt: string;
  client_request_id: string;
  coordinator_thread_id: string | null;
}

/** A `delegate_task` attempt without a thread whose dispatch T3 may have projected. */
function dispatchOf(attempt: Attempt): Dispatch | null {
  return attempt.thread_id === null &&
    attempt.mechanism === MECHANISM.DELEGATE_TASK &&
    attempt.client_request_id !== null
    ? {
        attempt: attempt.key,
        client_request_id: attempt.client_request_id,
        coordinator_thread_id: attempt.coordinator_thread_id,
      }
    : null;
}

/** The attempt key a brief names as a whole token, e.g. `NF-056-A1` but not `NF-056-A10`. */
function namesAttempt(prompt: string, attemptKey: string): boolean {
  const boundary = /[A-Za-z0-9]/;
  for (let at = prompt.indexOf(attemptKey); at >= 0; at = prompt.indexOf(attemptKey, at + 1)) {
    const before = prompt[at - 1] ?? "";
    const after = prompt[at + attemptKey.length] ?? "";
    if (!boundary.test(before) && !boundary.test(after)) return true;
  }
  return false;
}

/**
 * The thread T3 created for each dispatch: an exact client request id wins, else the one
 * conversation under the attempt's own coordinator whose brief names the attempt key. Anything
 * else stays unbound rather than binding the wrong thread; the caller reports it in flight.
 */
function delegatedBindings(
  dispatches: readonly Dispatch[],
  exact: ReadonlyMap<string, string>,
  delegations: readonly DelegatedThread[],
  claimed: ReadonlySet<string>,
): Map<string, string> {
  const bindings = new Map<string, string>();
  const taken = new Set(claimed);
  const unresolved: Dispatch[] = [];
  for (const dispatch of dispatches) {
    const threadId = exact.get(dispatch.client_request_id);
    if (threadId !== undefined && !taken.has(threadId)) {
      bindings.set(dispatch.attempt, threadId);
      taken.add(threadId);
    } else {
      unresolved.push(dispatch);
    }
  }
  if (unresolved.length === 0) return bindings;
  const namedByConversation = new Map<string, Set<string>>();
  for (const delegation of delegations) {
    const keys = unresolved.flatMap((dispatch) =>
      dispatch.coordinator_thread_id !== null &&
      delegation.parent_thread_id === dispatch.coordinator_thread_id &&
      namesAttempt(delegation.prompt, dispatch.attempt)
        ? [dispatch.attempt]
        : [],
    );
    if (keys.length === 0) continue;
    const named = namedByConversation.get(delegation.thread_id) ?? new Set<string>();
    for (const key of keys) named.add(key);
    namedByConversation.set(delegation.thread_id, named);
  }
  for (const dispatch of unresolved) {
    const candidates = [...namedByConversation]
      .filter(
        ([threadId, keys]) => keys.size === 1 && keys.has(dispatch.attempt) && !taken.has(threadId),
      )
      .map(([threadId]) => threadId);
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      bindings.set(dispatch.attempt, only);
      taken.add(only);
    }
  }
  return bindings;
}

interface JudgedAttempt {
  attempt: Attempt;
  view: AttemptLivenessView;
  /** The thread T3 created for the dispatch, when the attempt has no thread id of its own. */
  boundThread: string | null;
}

/** Liveness classes that mean the attempt still runs on its thread. */
function isLiveLiveness(liveness: AttemptLiveness | null): liveness is AttemptLiveness {
  return (
    liveness === ATTEMPT_LIVENESS.RUNNING ||
    liveness === ATTEMPT_LIVENESS.STALLED ||
    liveness === ATTEMPT_LIVENESS.WAITING_INPUT
  );
}

/** `--apply` binds the attempt, and activates a dispatch whose thread is still running. */
function bindChange(judged: JudgedAttempt): AttemptLivenessChange | null {
  const { attempt, view, boundThread } = judged;
  if (boundThread === null || !isLiveLiveness(view.liveness)) return null;
  if (attempt.status !== ATTEMPT_STATUS.DISPATCHING) return null;
  return {
    attempt: view.attempt,
    from: attempt.status,
    to: ATTEMPT_STATUS.ACTIVE,
    liveness: view.liveness,
  };
}

/**
 * Judge every live attempt from T3's own projections: read-only unless `apply` records a gone
 * thread as `unknown` or a finished failure as `failed`; an attempt with no thread id binds to the
 * thread T3 created for it. Never a success and never the task's status.
 */
export const attemptLiveness = Effect.fn("AttemptLiveness.attemptLiveness")(function* (
  projectId: string,
  options: AttemptLivenessOptions,
) {
  const store = yield* TaskStore;
  const project = yield* store.getProject(projectId);
  const live = yield* store.liveAttempts(projectId);
  const stallMinutes = options.stallMinutes ?? DEFAULT_STALL_MINUTES;
  const nowMs = (options.now ?? new Date()).getTime();
  const threadIds = new Set(live.flatMap((a) => (a.thread_id === null ? [] : [a.thread_id])));
  const dispatches = live.flatMap((attempt) => {
    const dispatch = dispatchOf(attempt);
    return dispatch === null ? [] : [dispatch];
  });
  const parents = [
    ...new Set(
      dispatches.flatMap((dispatch) =>
        dispatch.coordinator_thread_id === null ? [] : [dispatch.coordinator_thread_id],
      ),
    ),
  ];
  const sends = [
    ...new Set(
      live.flatMap((attempt) =>
        attempt.client_request_id === null ? [] : [attempt.client_request_id],
      ),
    ),
  ];

  let read = {
    threads: new Map<string, ThreadActivity>(),
    warnings: [] as string[],
    available: true,
  };
  const bindings = new Map<string, string>();
  const runIds = new Map<string, string>();
  if (threadIds.size > 0 || dispatches.length > 0 || sends.length > 0) {
    const source = Effect.gen(function* () {
      const delegations =
        dispatches.length === 0
          ? { threads: new Map<string, string>(), delegated: [], subagent_projection: true }
          : yield* readDelegations(options.t3State, {
              clientRequestIds: dispatches.map((dispatch) => dispatch.client_request_id),
              parentThreadIds: parents,
            });
      const bound = delegatedBindings(
        dispatches,
        delegations.threads,
        delegations.delegated,
        threadIds,
      );
      const sent =
        sends.length === 0
          ? { runs: new Map<string, { thread_id: string; run_id: string }>() }
          : yield* readSentRuns(options.t3State, sends);
      for (const attempt of live) {
        const send =
          attempt.client_request_id === null ? undefined : sent.runs.get(attempt.client_request_id);
        if (send === undefined) continue;
        const threadId = attempt.thread_id ?? bound.get(attempt.key) ?? send.thread_id;
        if (attempt.thread_id === null && !bound.has(attempt.key)) {
          bound.set(attempt.key, send.thread_id);
        }
        if (threadId === send.thread_id) runIds.set(attempt.key, send.run_id);
      }
      const ids = [...new Set([...threadIds, ...bound.values()])];
      const activity =
        ids.length === 0
          ? {
              threads: new Map<string, ThreadActivity>(),
              warnings: [] as string[],
              available: true,
            }
          : yield* readThreadActivity(options.t3State, ids);
      const fallbackLost =
        !delegations.subagent_projection &&
        dispatches.some(
          (dispatch) => dispatch.coordinator_thread_id !== null && !bound.has(dispatch.attempt),
        );
      const warnings = fallbackLost
        ? [
            "T3 subagent projection is missing; a dispatched attempt cannot bind to its delegated thread",
          ]
        : [];
      return { activity, bound, runIds, warnings };
    });
    const result = yield* options.bestEffort === true
      ? Effect.orElseSucceed(source, (error) => ({
          activity: {
            threads: new Map<string, ThreadActivity>(),
            warnings: [`T3 state unavailable: ${errorText(error)}`],
            available: false,
          },
          bound: new Map<string, string>(),
          runIds: new Map<string, string>(),
          warnings: [] as string[],
        }))
      : source;
    read = {
      ...result.activity,
      warnings: [...result.activity.warnings, ...result.warnings],
    };
    for (const [attempt, threadId] of result.bound) bindings.set(attempt, threadId);
    for (const [attempt, runId] of result.runIds) runIds.set(attempt, runId);
  }

  const judged: JudgedAttempt[] = live.map((attempt) => {
    const dispatch = dispatchOf(attempt);
    const threadId = attempt.thread_id ?? bindings.get(attempt.key) ?? null;
    const reuse = attempt.mechanism === MECHANISM.THREAD_SEND_REUSE;
    const runId = runIds.get(attempt.key) ?? null;
    const verdict = !read.available
      ? null
      : threadId !== null
        ? classifyThread(
            read.threads.get(threadId) ?? null,
            { thread_id: threadId, started_at: attempt.started_at, reuse, run_id: runId },
            nowMs,
            stallMinutes,
          )
        : dispatch === null
          ? classifyThread(
              null,
              { thread_id: null, started_at: attempt.started_at, reuse, run_id: runId },
              nowMs,
              stallMinutes,
            )
          : pendingThreadVerdict(
              dispatch.client_request_id,
              attempt.started_at,
              nowMs,
              stallMinutes,
            );
    const view: AttemptLivenessView = {
      attempt: attempt.key,
      task: attempt.task_key,
      status: attempt.status,
      liveness: verdict?.liveness ?? null,
      thread_id: threadId,
      run_id: verdict?.run_id ?? null,
      run_status: verdict?.run_status ?? null,
      run_requested_at: verdict?.run_requested_at ?? null,
      last_activity_at: verdict?.last_activity_at ?? null,
      waiting_input: verdict?.waiting_input ?? null,
      failure: verdict?.failure ?? null,
      evidence: verdict?.evidence ?? "the T3 state database could not be read",
      reason: verdict?.reason ?? "T3's state database could not be read",
      applied_status: null,
    };
    return {
      attempt,
      view,
      boundThread: attempt.thread_id === null ? threadId : null,
    };
  });

  const changes: AttemptLivenessChange[] = [];
  const applied = new Map<string, string>();
  if (options.apply === true) {
    for (const entry of judged) {
      const change = changeOf(entry.view) ?? bindChange(entry);
      if (entry.boundThread !== null) {
        yield* store.updateAttempt(projectId, entry.view.attempt, {
          thread_id: entry.boundThread,
          ...(change !== null && change.to === ATTEMPT_STATUS.ACTIVE ? { status: change.to } : {}),
          actor: ACTOR_ROLE.COORDINATOR,
        });
      }
      if (change === null) continue;
      if (change.to === ATTEMPT_STATUS.UNKNOWN) {
        const updated = yield* store.updateAttempt(projectId, entry.view.attempt, {
          status: ATTEMPT_STATUS.UNKNOWN,
          actor: ACTOR_ROLE.COORDINATOR,
        });
        if (updated.status === entry.view.status) continue;
      } else if (change.to === ATTEMPT_STATUS.FAILED) {
        yield* store.finishAttempt(projectId, entry.view.attempt, {
          status: ATTEMPT_STATUS.FAILED,
          failure_class: entry.view.failure?.class ?? ATTEMPT_FAILURE.FAILED,
          failure_detail: entry.view.failure?.message ?? entry.view.evidence,
          actor: ACTOR_ROLE.COORDINATOR,
        });
      }
      applied.set(entry.view.attempt, change.to);
      changes.push(change);
    }
  } else {
    for (const entry of judged) {
      const change = changeOf(entry.view) ?? bindChange(entry);
      if (change !== null) changes.push(change);
    }
  }

  const views = judged.map((entry) => entry.view);

  const withApplied = (view: AttemptLivenessView): AttemptLivenessView => ({
    ...view,
    applied_status: applied.get(view.attempt) ?? null,
  });
  const report: AttemptLivenessReportType = {
    project: { id: project.id, name: project.name },
    applied: options.apply === true,
    stall_minutes: stallMinutes,
    attempts: views.map(withApplied),
    changes,
    warnings: read.warnings,
  };
  return yield* decodeReport(report);
});
