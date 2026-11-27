import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  CostQuality,
  SourceSyncResult,
  UsageBucket,
  UsageEventInput,
  UsageStatus,
} from "@nf/contracts";
import { attribute, attributeParent } from "../domain/attribution.ts";
import type { AttemptWindow, Attribution, AttributionIndex } from "../domain/attribution.ts";
import { ulid } from "../domain/ids.ts";
import { textId } from "../domain/usage.ts";

export interface ExistingEvent {
  id: string;
  source_key: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  usage_status: UsageStatus;
  is_subagent: number;
  cost_usd: number | null;
  cost_quality: CostQuality;
  price_source: string | null;
  price_date: string | null;
  t3_thread_id: string | null;
  native_session_id: string | null;
  run_id: string | null;
  turn_id: string | null;
  provider: string | null;
  model: string | null;
  ts: string;
  attempt_id: string | null;
  /** Attempt that spawned this event's app-owned child thread, when the child is not an attempt. */
  parent_attempt_id: string | null;
  bucket: UsageBucket;
}

type ComparedKey = Exclude<
  keyof ExistingEvent,
  "id" | "source_key" | "attempt_id" | "parent_attempt_id" | "bucket"
>;

const COMPARED: readonly ComparedKey[] = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "usage_status",
  "is_subagent",
  "cost_usd",
  "cost_quality",
  "price_source",
  "price_date",
  "t3_thread_id",
  "native_session_id",
  "run_id",
  "turn_id",
  "provider",
  "model",
  "ts",
];

function unchanged(row: ExistingEvent, event: UsageEventInput): boolean {
  for (const key of COMPARED) {
    const next = key === "is_subagent" ? (event.is_subagent ? 1 : 0) : event[key];
    if (row[key] !== next) return false;
  }
  return true;
}

function measuredFields(event: UsageEventInput) {
  return {
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cache_read_tokens: event.cache_read_tokens,
    cache_write_tokens: event.cache_write_tokens,
    reasoning_tokens: event.reasoning_tokens,
    usage_status: event.usage_status,
    is_subagent: event.is_subagent ? 1 : 0,
    cost_usd: event.cost_usd,
    cost_quality: event.cost_quality,
    price_source: event.price_source,
    price_date: event.price_date,
    t3_thread_id: event.t3_thread_id,
    native_session_id: event.native_session_id,
    run_id: event.run_id,
    turn_id: event.turn_id,
    provider: event.provider,
    model: event.model,
    ts: event.ts,
  };
}

/** Coordinator threads (legacy project columns and the registry) and attempt windows by thread. */
export const loadAttributionIndex = Effect.fn("UsageStore.loadAttributionIndex")(function* (
  extraCoordinators: readonly string[],
) {
  const sql = yield* SqlClient.SqlClient;
  const coordinators = new Set<string>();
  for (const row of yield* sql`SELECT coordinator_thread_id FROM projects WHERE coordinator_thread_id IS NOT NULL`) {
    const id = textId(row["coordinator_thread_id"]);
    if (id) coordinators.add(id);
  }
  for (const row of yield* sql`SELECT thread_id FROM coordinator_threads`) {
    const id = textId(row["thread_id"]);
    if (id) coordinators.add(id);
  }
  for (const id of extraCoordinators) if (id.length > 0) coordinators.add(id);
  const attempts = new Map<string, AttemptWindow[]>();
  const rows = yield* sql<{
    id: string;
    thread_id: string;
    started_at: string;
    ended_at: string | null;
  }>`
    SELECT id, thread_id, started_at, ended_at FROM attempts WHERE thread_id IS NOT NULL AND thread_id <> ''`;
  for (const row of rows) {
    const start = Date.parse(row.started_at);
    const end = row.ended_at ? Date.parse(row.ended_at) : null;
    if (Number.isNaN(start) || (end !== null && Number.isNaN(end))) continue;
    const list = attempts.get(row.thread_id) ?? [];
    list.push({ id: row.id, thread_id: row.thread_id, start, end });
    attempts.set(row.thread_id, list);
  }
  for (const list of attempts.values()) {
    list.sort((a, b) => (a.start === b.start ? a.id.localeCompare(b.id) : a.start - b.start));
  }
  const index: AttributionIndex = { coordinators, attempts };
  return index;
});

export const loadExistingEvents = Effect.fn("UsageStore.loadExistingEvents")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing = new Map<string, ExistingEvent>();
  for (const row of yield* sql<ExistingEvent>`SELECT id, source_key, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent, cost_usd,
      cost_quality, price_source, price_date, t3_thread_id, native_session_id, run_id,
      turn_id, provider, model, ts, attempt_id, parent_attempt_id, bucket
    FROM usage_events`) {
    existing.set(row.source_key, row);
  }
  return existing;
});

/**
 * Insert new events and update changed ones in place (same id), skipping identical ones.
 * `existing` is updated with inserted rows so a key seen twice is written once.
 */
export const persistEvents = Effect.fn("UsageStore.persistEvents")(function* (options: {
  readonly machine: string;
  readonly events: readonly UsageEventInput[];
  readonly existing: Map<string, ExistingEvent>;
  readonly index: AttributionIndex;
  readonly childAttempts: ReadonlyMap<string, string>;
  readonly createdAt: string;
  readonly dryRun: boolean;
}) {
  const sql = yield* SqlClient.SqlClient;
  const { machine, events, existing, index, childAttempts, createdAt, dryRun } = options;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const results: Attribution[] = [];
  for (const event of events) {
    const attribution = attribute(index, event.t3_thread_id, event.ts);
    const parentAttempt = attributeParent(index, childAttempts, attribution, event.t3_thread_id);
    results.push(attribution);
    const row = existing.get(event.source_key);
    if (row) {
      if (unchanged(row, event)) {
        skipped++;
        continue;
      }
      updated++;
      if (!dryRun)
        yield* sql`UPDATE usage_events SET ${sql.update(measuredFields(event))} WHERE id = ${row.id}`;
      continue;
    }
    inserted++;
    if (!dryRun) {
      const id = ulid();
      yield* sql`INSERT INTO usage_events ${sql.insert({
        id,
        source: event.source,
        source_key: event.source_key,
        machine_id: machine,
        ...measuredFields(event),
        attempt_id: attribution.attempt_id,
        parent_attempt_id: parentAttempt,
        bucket: attribution.bucket,
        created_at: createdAt,
      })}`;
      existing.set(event.source_key, {
        ...event,
        id,
        is_subagent: event.is_subagent ? 1 : 0,
        attempt_id: attribution.attempt_id,
        parent_attempt_id: parentAttempt,
        bucket: attribution.bucket,
      });
    }
  }
  return { inserted, updated, skipped, results };
});

/** Re-apply attribution to every stored event (attempt windows, coordinators and spawns may have changed). */
export const reattributeEvents = Effect.fn("UsageStore.reattributeEvents")(function* (
  index: AttributionIndex,
  childAttempts: ReadonlyMap<string, string>,
  dryRun: boolean,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    id: string;
    t3_thread_id: string | null;
    ts: string;
    attempt_id: string | null;
    parent_attempt_id: string | null;
    bucket: UsageBucket;
  }>`SELECT id, t3_thread_id, ts, attempt_id, parent_attempt_id, bucket FROM usage_events`;
  for (const row of rows) {
    const want = attribute(index, row.t3_thread_id, row.ts);
    const parent = attributeParent(index, childAttempts, want, row.t3_thread_id);
    if (
      want.attempt_id === row.attempt_id &&
      parent === row.parent_attempt_id &&
      want.bucket === row.bucket
    )
      continue;
    if (!dryRun) {
      yield* sql`UPDATE usage_events SET attempt_id = ${want.attempt_id},
          parent_attempt_id = ${parent}, bucket = ${want.bucket} WHERE id = ${row.id}`;
    }
  }
});

export const writeSyncState = Effect.fn("UsageStore.writeSyncState")(function* (
  result: SourceSyncResult,
  at: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO sync_state ${sql.insert({
    source: result.source,
    cursor: result.cursor,
    last_run_at: at,
    last_status: result.status,
    last_error: result.error,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
  })}
    ON CONFLICT (source) DO UPDATE SET
      cursor = excluded.cursor,
      last_run_at = excluded.last_run_at,
      last_status = excluded.last_status,
      last_error = excluded.last_error,
      inserted = excluded.inserted,
      updated = excluded.updated,
      skipped = excluded.skipped`;
});
