import { ATTEMPT_FAILURE, ATTEMPT_LIVENESS } from "@nf/contracts";
import type { AttemptFailure, AttemptLiveness } from "@nf/contracts";

/** One T3 run of a thread, as its `statev2` projection reports it. */
export interface RunActivity {
  run_id: string;
  ordinal: number | null;
  status: string;
  requested_at: string;
  completed_at: string | null;
  /** Newest turn item, provider turn or message of this run. */
  last_activity_at: string | null;
  last_activity_source: string | null;
  /** `payload.failure` of the run's newest error turn item. */
  failure: { class: string | null; message: string | null } | null;
}

/** The T3 thread behind an attempt, with the activity its projections recorded. */
export interface ThreadActivity {
  thread_id: string;
  deleted_at: string | null;
  archived_at: string | null;
  /** All runs, oldest first. */
  runs: readonly RunActivity[];
  /** The oldest unresolved runtime request of the thread, if any. */
  waiting_input: {
    runtime_request_id: string;
    kind: string;
    created_at: string;
    run_id: string | null;
  } | null;
}

/** What the attempt itself tells the judgement. */
export interface AttemptActivity {
  started_at: string;
  /** `thread_send_reuse` shares a thread with earlier runs; only later ones belong to it. */
  reuse: boolean;
  /** The run T3 created for the attempt's own command, when T3 recorded it. */
  run_id?: string | null;
}

export interface LivenessVerdict {
  liveness: AttemptLiveness;
  run_id: string | null;
  run_status: string | null;
  run_requested_at: string | null;
  last_activity_at: string | null;
  waiting_input: { kind: string; created_at: string } | null;
  failure: { class: string; message: string | null } | null;
  evidence: string;
  /** The same verdict in a person's terms, for the board. */
  reason: string;
}

/** Run statuses that already decided the attempt, with the class to report for each. */
const FAILED_RUN_CLASS: Record<string, AttemptFailure> = {
  cancelled: ATTEMPT_FAILURE.CANCELLED,
  interrupted: ATTEMPT_FAILURE.INTERRUPTED,
  rolled_back: ATTEMPT_FAILURE.ROLLED_BACK,
};

/**
 * Host errors reported through the run's error turn item. Order matters: a usage limit is
 * usually wrapped in a 429, so quota wins over throttling.
 */
const FAILURE_PATTERNS: readonly (readonly [RegExp, AttemptFailure])[] = [
  [/usage limit|quota|limit will reset|insufficient_quota|subscription/i, ATTEMPT_FAILURE.QUOTA],
  [/rate.?limit|throttl|too many requests|\b429\b/i, ATTEMPT_FAILURE.THROTTLED],
  [/\b401\b|\b403\b|unauthor|forbidden|permission|authenticat|api key/i, ATTEMPT_FAILURE.AUTH],
  [
    /context (length|window|limit)|too many tokens|maximum context/i,
    ATTEMPT_FAILURE.CONTEXT_EXHAUSTED,
  ],
  [
    /timed? ?out|aborted|overload|unavailable|\b50[0234]\b|econn|socket|network/i,
    ATTEMPT_FAILURE.AVAILABILITY,
  ],
];

/** The failure class NF records for a run T3 finished with a non-success status. */
export function runFailureClass(status: string, message: string | null): AttemptFailure {
  const known = FAILED_RUN_CLASS[status];
  if (known !== undefined) return known;
  if (message !== null) {
    for (const [pattern, failure] of FAILURE_PATTERNS) {
      if (pattern.test(message)) return failure;
    }
  }
  return ATTEMPT_FAILURE.FAILED;
}

/**
 * The run that speaks for the attempt: the one T3 created for its command when known, else the
 * newest one, except for a reuse attempt, whose thread already ran earlier work — there only a run
 * requested after it started can be its own. No such run means T3 has not started it yet, not that
 * it failed.
 */
export function attemptRun(
  runs: readonly RunActivity[],
  attempt: AttemptActivity,
): RunActivity | null {
  const wanted = attempt.run_id ?? null;
  if (wanted !== null) return runs.find((run) => run.run_id === wanted) ?? null;
  if (!attempt.reuse) return runs.at(-1) ?? null;
  const startMs = Date.parse(attempt.started_at);
  if (Number.isNaN(startMs)) return runs.at(-1) ?? null;
  let newest: RunActivity | null = null;
  for (const run of runs) {
    const ms = Date.parse(run.requested_at);
    if (!Number.isNaN(ms) && ms >= startMs) newest = run;
  }
  return newest;
}

const iso = (ts: string | null): string => (ts === null ? "an unknown time" : ts);

function minutes(ms: number): string {
  const count = Math.max(0, Math.floor(ms / 60_000));
  return `${count} minute${count === 1 ? "" : "s"}`;
}

function age(ms: number): string {
  const count = Math.max(0, Math.floor(ms / 60_000));
  if (count < 60) return minutes(ms);
  const hours = Math.floor(count / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function runningVerdict(
  run: RunActivity,
  nowMs: number,
  stallMs: number,
  base: Omit<LivenessVerdict, "liveness" | "last_activity_at" | "evidence" | "reason">,
): LivenessVerdict {
  const activity = run.last_activity_at;
  const since = activity ?? run.requested_at;
  const idleMs = nowMs - Date.parse(since);
  const quietMs = Number.isFinite(idleMs) ? idleMs : null;
  const quiet = quietMs === null ? null : minutes(quietMs);
  const quietFor = quietMs === null ? null : age(quietMs);
  const stalled = quietMs !== null && quietMs > stallMs;
  const source = run.last_activity_source ?? "activity";
  const what =
    activity === null
      ? quiet === null
        ? `no turn item, provider turn or message since it was requested at ${run.requested_at}`
        : `no turn item, provider turn or message for ${quiet} since it was requested`
      : quiet === null
        ? `last ${source} at ${activity}`
        : `last ${source} ${quiet} ago`;
  const reason = stalled
    ? quietFor === null
      ? `Run ${run.ordinal ?? "?"} is ${run.status}`
      : `No activity for ${quietFor}; run ${run.ordinal ?? "?"} still open`
    : quietFor === null
      ? `Run ${run.ordinal ?? "?"} is ${run.status}`
      : activity === null
        ? `Run ${run.ordinal ?? "?"} is ${run.status}; no activity for ${quietFor}`
        : `Run ${run.ordinal ?? "?"} is ${run.status}; last ${source} ${quietFor} ago`;
  return {
    ...base,
    liveness: stalled ? ATTEMPT_LIVENESS.STALLED : ATTEMPT_LIVENESS.RUNNING,
    last_activity_at: activity,
    evidence: `run ${run.ordinal ?? "?"} ${run.status}; ${what}`,
    reason,
  };
}

/**
 * A delegated attempt T3 has not created a thread for. T3 makes the thread when it commands the
 * dispatch, so right after `attempt start` its absence is not evidence that the worker is gone; past
 * `stallMinutes` from that start it is: the thread never existed.
 */
export function pendingThreadVerdict(
  clientRequestId: string,
  startedAt: string,
  nowMs: number,
  stallMinutes: number,
): LivenessVerdict {
  const waitingMs = nowMs - Date.parse(startedAt);
  const stalled = Number.isFinite(waitingMs) && waitingMs > stallMinutes * 60_000;
  const sentAgo = Number.isFinite(waitingMs)
    ? waitingMs < 60_000
      ? "just now"
      : `${age(waitingMs)} ago`
    : null;
  return {
    run_id: null,
    run_status: null,
    run_requested_at: null,
    last_activity_at: null,
    waiting_input: null,
    failure: null,
    liveness: stalled ? ATTEMPT_LIVENESS.MISSING : ATTEMPT_LIVENESS.RUNNING,
    evidence: stalled
      ? `no T3 thread for client request ${clientRequestId} ${Math.floor(waitingMs / 60_000)}m after dispatch`
      : `T3 has not created the delegated thread for client request ${clientRequestId} yet`,
    reason: stalled
      ? sentAgo === null
        ? "Sent, but T3 never started it"
        : `Sent ${sentAgo}, but T3 never started it`
      : sentAgo === null
        ? "Sent; T3 has not started it yet"
        : `Sent ${sentAgo}; T3 has not started it yet`,
  };
}

/**
 * Classify one live attempt from its T3 thread. A thread is finished when its judged run ended,
 * waiting when that run has an unresolved runtime request, stalled when it is still running but
 * silent for `stallMinutes`, and missing when T3 has no (undeleted) thread for it.
 */
export function classifyThread(
  thread: ThreadActivity | null,
  attempt: AttemptActivity & { thread_id: string | null },
  nowMs: number,
  stallMinutes: number,
): LivenessVerdict {
  const empty = {
    run_id: null,
    run_status: null,
    run_requested_at: null,
    waiting_input: null,
    failure: null,
  };
  if (thread === null) {
    return {
      ...empty,
      liveness: ATTEMPT_LIVENESS.MISSING,
      last_activity_at: null,
      evidence:
        attempt.thread_id === null
          ? "the attempt has no T3 thread id"
          : `thread ${attempt.thread_id} is not in T3`,
      reason:
        attempt.thread_id === null
          ? "No conversation is recorded for this attempt"
          : "Its conversation is no longer in T3",
    };
  }
  if (thread.deleted_at !== null) {
    const deletedMs = nowMs - Date.parse(thread.deleted_at);
    return {
      ...empty,
      liveness: ATTEMPT_LIVENESS.MISSING,
      last_activity_at: null,
      evidence: Number.isFinite(deletedMs)
        ? `thread ${thread.thread_id} was deleted ${minutes(deletedMs)} ago`
        : `thread ${thread.thread_id} was deleted`,
      reason: Number.isFinite(deletedMs)
        ? `Its conversation was deleted ${age(deletedMs)} ago`
        : "Its conversation was deleted",
    };
  }
  const run = attemptRun(thread.runs, attempt);
  if (run === null) {
    return {
      ...empty,
      liveness: ATTEMPT_LIVENESS.RUNNING,
      last_activity_at: null,
      evidence:
        (attempt.run_id ?? null) !== null
          ? "T3 has not recorded the run for this attempt yet"
          : attempt.reuse
            ? `no run requested since the attempt started at ${attempt.started_at}`
            : `thread ${thread.thread_id} has no runs yet`,
      reason:
        (attempt.run_id ?? null) !== null
          ? "T3 has not recorded this attempt's run yet"
          : attempt.reuse
            ? "T3 has not started this send yet"
            : "Its conversation has no runs yet",
    };
  }
  const base = {
    ...empty,
    run_id: run.run_id,
    run_status: run.status,
    run_requested_at: run.requested_at,
    failure:
      FAILED_RUN_CLASS[run.status] === undefined && run.status !== "failed"
        ? null
        : {
            class: runFailureClass(run.status, run.failure?.message ?? null),
            message: run.failure?.message ?? null,
          },
  };
  const request = thread.waiting_input;
  if (request !== null && (request.run_id === null || request.run_id === run.run_id)) {
    const waitedMs = nowMs - Date.parse(request.created_at);
    return {
      ...base,
      liveness: ATTEMPT_LIVENESS.WAITING_INPUT,
      last_activity_at: request.created_at,
      waiting_input: { kind: request.kind, created_at: request.created_at },
      evidence: `${request.kind} request ${request.runtime_request_id} has been unresolved since ${request.created_at}`,
      reason: Number.isFinite(waitedMs)
        ? `Waiting for ${request.kind.replaceAll("_", " ")} for ${age(waitedMs)}`
        : `Waiting for ${request.kind.replaceAll("_", " ")}`,
    };
  }
  if (run.status === "completed") {
    const doneMs = run.completed_at === null ? Number.NaN : nowMs - Date.parse(run.completed_at);
    return {
      ...base,
      liveness: ATTEMPT_LIVENESS.FINISHED_OK,
      last_activity_at: run.completed_at ?? run.last_activity_at,
      evidence: `run ${run.ordinal ?? "?"} completed at ${iso(run.completed_at)}`,
      reason: Number.isFinite(doneMs)
        ? `Run ${run.ordinal ?? "?"} completed ${age(doneMs)} ago`
        : `Run ${run.ordinal ?? "?"} completed`,
    };
  }
  if (run.status === "failed" || FAILED_RUN_CLASS[run.status] !== undefined) {
    const message = run.failure?.message ?? null;
    const failedMs = run.completed_at === null ? Number.NaN : nowMs - Date.parse(run.completed_at);
    return {
      ...base,
      liveness: ATTEMPT_LIVENESS.FINISHED_FAILED,
      last_activity_at: run.completed_at ?? run.last_activity_at,
      evidence: `run ${run.ordinal ?? "?"} ${run.status} at ${iso(run.completed_at)}: ${message ?? "no error message"}`,
      reason: Number.isFinite(failedMs)
        ? `Run ${run.ordinal ?? "?"} ${run.status} ${age(failedMs)} ago`
        : `Run ${run.ordinal ?? "?"} ${run.status}`,
    };
  }
  return runningVerdict(run, nowMs, stallMinutes * 60_000, base);
}
