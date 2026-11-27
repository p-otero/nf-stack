import { USAGE_BUCKET } from "@nf/contracts";
import type { UsageBucket } from "@nf/contracts";

export interface AttemptWindow {
  id: string;
  thread_id: string;
  start: number;
  end: number | null;
}

export interface AttributionIndex {
  coordinators: Set<string>;
  /** Attempt windows per T3 thread, ordered by start. */
  attempts: Map<string, AttemptWindow[]>;
}

export interface Attribution {
  attempt_id: string | null;
  bucket: UsageBucket;
}

/**
 * Coordinator threads are coordination. Otherwise the latest attempt on the same thread whose
 * window contains the timestamp owns the event (a reused thread hosts several attempts).
 */
export function attribute(
  index: AttributionIndex,
  thread: string | null,
  tsText: string,
): Attribution {
  if (!thread) return { attempt_id: null, bucket: USAGE_BUCKET.UNATTRIBUTED };
  if (index.coordinators.has(thread))
    return { attempt_id: null, bucket: USAGE_BUCKET.COORDINATION };
  const ts = Date.parse(tsText);
  if (Number.isNaN(ts)) return { attempt_id: null, bucket: USAGE_BUCKET.UNATTRIBUTED };
  let found: AttemptWindow | null = null;
  for (const window of index.attempts.get(thread) ?? []) {
    if (window.start > ts) break;
    if (window.end !== null && ts > window.end) continue;
    found = window;
  }
  return found
    ? { attempt_id: found.id, bucket: USAGE_BUCKET.ATTEMPT }
    : { attempt_id: null, bucket: USAGE_BUCKET.UNATTRIBUTED };
}

/**
 * The attempt that spawned an app-owned child thread, for usage that has no attempt of its own.
 * A child thread that hosts an NF attempt (a delegated worker) keeps its events on that attempt,
 * and coordination or attributed usage never moves to a parent, so nothing is counted twice.
 */
export function attributeParent(
  index: AttributionIndex,
  childAttempts: ReadonlyMap<string, string>,
  own: Attribution,
  thread: string | null,
): string | null {
  if (own.bucket !== USAGE_BUCKET.UNATTRIBUTED || thread === null) return null;
  if (index.attempts.has(thread)) return null;
  return childAttempts.get(thread) ?? null;
}
