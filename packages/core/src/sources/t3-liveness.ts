import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { NfError } from "@nf/contracts";
import { obj, parseJsonObject, textId, utcTimestamp } from "../domain/usage.ts";
import type { RunActivity, ThreadActivity } from "../domain/liveness.ts";
import { readSource } from "./read-source.ts";

export interface T3ActivityRead {
  /** Threads T3 knows, by thread id; a requested id that is absent was never projected. */
  threads: Map<string, ThreadActivity>;
  warnings: string[];
  /** False when the caller chose to continue without the source: nothing can be judged. */
  available: boolean;
}

/** One `delegate_task` dispatch as T3 recorded it in the thread that commanded it. */
export interface DelegatedThread {
  thread_id: string;
  parent_thread_id: string;
  /** The client request id T3 derived the thread id from, `null` when the id does not decode. */
  client_request_id: string | null;
  /** The brief T3 delivered to the child thread. */
  prompt: string;
}

export interface DelegationQuery {
  /** Client request ids a dispatch may carry; T3 embeds them in the thread id it derives. */
  clientRequestIds: readonly string[];
  /** Threads that command dispatches; T3 projects each child and its brief under them. */
  parentThreadIds: readonly string[];
}

export interface DelegationRead {
  /** Exact client request id → the thread T3 derived from it. */
  threads: Map<string, string>;
  /** The dispatches T3 projected for the queried threads. */
  delegated: DelegatedThread[];
  /** False when T3 has no subagent projection, so only an exact client request id can bind. */
  subagent_projection: boolean;
}

/** The conversation and run T3 created for one `t3_thread_send`. */
export interface SentRun {
  thread_id: string;
  run_id: string;
}

// Rows of T3's orchestration_v2 projections. Only the keys must be text; every other column is
// decoded field by field so an unexpected value becomes unknown instead of failing the read.
const ThreadRow = Schema.Struct({
  thread_id: Schema.String,
  deleted_at: Schema.Unknown,
  archived_at: Schema.Unknown,
});
const RunRow = Schema.Struct({
  run_id: Schema.String,
  thread_id: Schema.String,
  ordinal: Schema.Unknown,
  status: Schema.Unknown,
  requested_at: Schema.Unknown,
  completed_at: Schema.Unknown,
});
const ActivityRow = Schema.Struct({
  thread_id: Schema.String,
  run_id: Schema.Unknown,
  ts: Schema.Unknown,
});
const RequestRow = Schema.Struct({
  runtime_request_id: Schema.String,
  thread_id: Schema.String,
  run_id: Schema.Unknown,
  kind: Schema.Unknown,
  status: Schema.Unknown,
  created_at: Schema.Unknown,
});
const FailureRow = Schema.Struct({
  thread_id: Schema.String,
  run_id: Schema.Unknown,
  payload_json: Schema.Unknown,
});
const DelegationRow = Schema.Struct({
  thread_id: Schema.String,
  child_thread_id: Schema.Unknown,
  payload_json: Schema.Unknown,
});
const SentRow = Schema.Struct({
  message_id: Schema.String,
  thread_id: Schema.String,
  run_id: Schema.Unknown,
});
const ThreadIdRow = Schema.Struct({ thread_id: Schema.String, deleted_at: Schema.Unknown });
const decodeThreadRow = Schema.decodeUnknownOption(ThreadRow);
const decodeRunRow = Schema.decodeUnknownOption(RunRow);
const decodeActivityRow = Schema.decodeUnknownOption(ActivityRow);
const decodeRequestRow = Schema.decodeUnknownOption(RequestRow);
const decodeFailureRow = Schema.decodeUnknownOption(FailureRow);
const decodeDelegationRow = Schema.decodeUnknownOption(DelegationRow);
const decodeSentRow = Schema.decodeUnknownOption(SentRow);
const decodeThreadIdRow = Schema.decodeUnknownOption(ThreadIdRow);

const DELEGATED_THREAD_PREFIX = "thread:delegated-task:";
const DELEGATED_TASK_MARKER = ":delegate-task:";
const SENT_MESSAGE_MARKER = ":thread-send:";

const tableExists = (sql: SqlClient.SqlClient, name: string) =>
  Effect.map(
    sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
    (rows) => rows.length > 0,
  );

/**
 * The client request id T3 embedded in a delegated thread id. T3 keeps that id only in the id's
 * encoded `delegate-task:<client request id>` suffix, never in a column or `payload_json`.
 */
function clientRequestIdOf(threadId: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(threadId);
  } catch {
    return null;
  }
  const at = decoded.indexOf(DELEGATED_TASK_MARKER);
  return at < 0 ? null : decoded.slice(at + DELEGATED_TASK_MARKER.length);
}

/**
 * Read what T3 projected for `delegate_task`, read-only: the thread each client request id
 * derived, and for the queried threads, each dispatch's child thread and brief. The subagent
 * projection is optional: without it only the exact client request id can bind, so the caller is
 * told whether it was there.
 */
export const readDelegations = (file: string, query: DelegationQuery) =>
  readSource(
    file,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const clientRequestIds = new Set(query.clientRequestIds);
      const parents = [...new Set(query.parentThreadIds)];
      const exact = new Map<string, { thread_id: string; deleted: boolean }>();
      const delegated: DelegatedThread[] = [];
      let subagentProjection = false;
      if (clientRequestIds.size === 0 && parents.length === 0) {
        return {
          threads: new Map<string, string>(),
          delegated,
          subagent_projection: subagentProjection,
        };
      }
      if (yield* tableExists(sql, "orchestration_v2_projection_threads")) {
        for (const raw of yield* sql`SELECT thread_id, deleted_at
            FROM orchestration_v2_projection_threads
            WHERE thread_id LIKE '%delegate-task%'`) {
          const row = decodeThreadIdRow(raw);
          if (Option.isNone(row)) continue;
          const clientRequestId = clientRequestIdOf(row.value.thread_id);
          if (clientRequestId === null || !clientRequestIds.has(clientRequestId)) continue;
          const chosen = exact.get(clientRequestId);
          const deleted = utcTimestamp(row.value.deleted_at) !== null;
          if (chosen === undefined || (chosen.deleted && !deleted)) {
            exact.set(clientRequestId, { thread_id: row.value.thread_id, deleted });
          }
        }
      }
      if (parents.length > 0) {
        subagentProjection = yield* tableExists(sql, "orchestration_v2_projection_subagents");
        if (subagentProjection) {
          for (const raw of yield* sql`SELECT thread_id, child_thread_id, payload_json
              FROM orchestration_v2_projection_subagents WHERE thread_id IN ${sql.in(parents)}`) {
            const row = decodeDelegationRow(raw);
            if (Option.isNone(row)) continue;
            const child = textId(row.value.child_thread_id);
            if (child === null || !child.startsWith(DELEGATED_THREAD_PREFIX)) continue;
            delegated.push({
              thread_id: child,
              parent_thread_id: row.value.thread_id,
              client_request_id: clientRequestIdOf(child),
              prompt: textId(parseJsonObject(row.value.payload_json)?.["prompt"]) ?? "",
            });
          }
        }
      }
      const threads = new Map(
        [...exact].map(([clientRequestId, chosen]) => [clientRequestId, chosen.thread_id]),
      );
      return { threads, delegated, subagent_projection: subagentProjection };
    }),
  );

/**
 * The decoded client request id in a `t3_thread_send` message id's suffix; T3 records it nowhere
 * else, and an undecodable one names no send.
 */
function sentClientRequestId(messageId: string): string | null {
  const at = messageId.lastIndexOf(SENT_MESSAGE_MARKER);
  try {
    return at < 0 ? null : decodeURIComponent(messageId.slice(at + SENT_MESSAGE_MARKER.length));
  } catch {
    return null;
  }
}

/**
 * The conversation and run T3 created for each `t3_thread_send`, keyed by its client request id;
 * the oldest send wins, and a T3 without the message projection binds nothing.
 */
export const readSentRuns = (file: string, clientRequestIds: readonly string[]) =>
  readSource(
    file,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const wanted = new Set(clientRequestIds);
      const runs = new Map<string, SentRun>();
      if (wanted.size === 0) return { runs };
      if (!(yield* tableExists(sql, "orchestration_v2_projection_messages"))) return { runs };
      for (const raw of yield* sql`SELECT message_id, thread_id, run_id
          FROM orchestration_v2_projection_messages
          WHERE message_id LIKE ${`%${SENT_MESSAGE_MARKER}%`} ORDER BY created_at`) {
        const row = decodeSentRow(raw);
        if (Option.isNone(row)) continue;
        const clientRequestId = sentClientRequestId(row.value.message_id);
        const run = textId(row.value.run_id);
        if (clientRequestId === null || run === null || !wanted.has(clientRequestId)) continue;
        if (runs.has(clientRequestId)) continue;
        runs.set(clientRequestId, { thread_id: row.value.thread_id, run_id: run });
      }
      return { runs };
    }),
  );

const schemaError = (file: string, table: string) =>
  new NfError({ code: "source_schema", message: `${file} has no ${table} table` });

interface Activity {
  thread_id: string;
  run_id: string;
  ts: string;
  source: string;
}

/** Newest known activity per run; a run without any keeps `null` and falls back to its request. */
function mergeActivity(into: Map<string, Activity>, row: Activity): void {
  const key = `${row.thread_id}\u0000${row.run_id}`;
  const current = into.get(key);
  if (current === undefined || row.ts > current.ts) into.set(key, row);
}

/**
 * Read the liveness projections of T3 Code's `statev2.sqlite` for a set of threads, read-only.
 * Threads and runs are required (without them no attempt can be judged); the activity, request
 * and error projections are optional and only narrow the evidence, as T3 may roll them out later.
 */
export const readThreadActivity = (file: string, threadIds: readonly string[]) =>
  readSource(
    file,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ids = [...new Set(threadIds)];
      const hasTable = (name: string) => tableExists(sql, name);
      const warnings: string[] = [];
      const threads = new Map<string, ThreadActivity>();
      if (!(yield* hasTable("orchestration_v2_projection_threads"))) {
        return yield* schemaError(file, "orchestration_v2_projection_threads");
      }
      if (!(yield* hasTable("orchestration_v2_projection_runs"))) {
        return yield* schemaError(file, "orchestration_v2_projection_runs");
      }
      if (ids.length === 0) return { threads, warnings, available: true };

      let malformed = 0;
      const runsByThread = new Map<string, RunActivity[]>();
      for (const raw of yield* sql`SELECT thread_id, deleted_at, archived_at
          FROM orchestration_v2_projection_threads WHERE thread_id IN ${sql.in(ids)}`) {
        const row = decodeThreadRow(raw);
        if (Option.isNone(row)) {
          malformed++;
          continue;
        }
        threads.set(row.value.thread_id, {
          thread_id: row.value.thread_id,
          deleted_at: utcTimestamp(row.value.deleted_at),
          archived_at: utcTimestamp(row.value.archived_at),
          runs: [],
          waiting_input: null,
        });
      }
      for (const raw of yield* sql`SELECT run_id, thread_id, ordinal, status, requested_at, completed_at
          FROM orchestration_v2_projection_runs
          WHERE thread_id IN ${sql.in(ids)} ORDER BY requested_at, ordinal`) {
        const row = decodeRunRow(raw);
        if (Option.isNone(row)) {
          malformed++;
          continue;
        }
        const requested = utcTimestamp(row.value.requested_at);
        if (requested === null) {
          malformed++;
          continue;
        }
        const run: RunActivity = {
          run_id: row.value.run_id,
          ordinal: typeof row.value.ordinal === "number" ? row.value.ordinal : null,
          status: textId(row.value.status) ?? "unknown",
          requested_at: requested,
          completed_at: utcTimestamp(row.value.completed_at),
          last_activity_at: null,
          last_activity_source: null,
          failure: null,
        };
        const list = runsByThread.get(row.value.thread_id) ?? [];
        list.push(run);
        runsByThread.set(row.value.thread_id, list);
      }

      const activity = new Map<string, Activity>();
      const collect = (
        source: string,
        rows: ReadonlyArray<{
          thread_id: string;
          run_id: string;
          ts: string;
        }>,
      ) => {
        for (const row of rows) mergeActivity(activity, { ...row, source });
      };

      if (yield* hasTable("orchestration_v2_projection_turn_items")) {
        const rows: { thread_id: string; run_id: string; ts: string }[] = [];
        for (const raw of yield* sql`SELECT thread_id, run_id, MAX(updated_at) AS ts
            FROM orchestration_v2_projection_turn_items
            WHERE thread_id IN ${sql.in(ids)} AND run_id IS NOT NULL GROUP BY thread_id, run_id`) {
          const row = decodeActivityRow(raw);
          if (Option.isNone(row)) {
            malformed++;
            continue;
          }
          const run = textId(row.value.run_id);
          const ts = utcTimestamp(row.value.ts);
          if (run !== null && ts !== null)
            rows.push({ thread_id: row.value.thread_id, run_id: run, ts });
        }
        collect("turn item", rows);
      } else {
        warnings.push("T3 turn item projection is missing; stall detection is coarser");
      }

      if (
        (yield* hasTable("orchestration_v2_projection_provider_turns")) &&
        (yield* hasTable("orchestration_v2_projection_nodes"))
      ) {
        const rows: { thread_id: string; run_id: string; ts: string }[] = [];
        // Filtering the provider turns by thread too keeps the join on the node key instead of a
        // scan of every turn: a turn and its node are projected for the same thread.
        for (const raw of yield* sql`SELECT n.thread_id AS thread_id, n.run_id AS run_id,
              MAX(COALESCE(pt.completed_at, pt.started_at)) AS ts
            FROM orchestration_v2_projection_provider_turns pt
            JOIN orchestration_v2_projection_nodes n ON n.node_id = pt.node_id
            WHERE n.thread_id IN ${sql.in(ids)} AND n.run_id IS NOT NULL
              AND pt.thread_id IN ${sql.in(ids)}
            GROUP BY n.thread_id, n.run_id`) {
          const row = decodeActivityRow(raw);
          if (Option.isNone(row)) {
            malformed++;
            continue;
          }
          const run = textId(row.value.run_id);
          const ts = utcTimestamp(row.value.ts);
          if (run !== null && ts !== null)
            rows.push({ thread_id: row.value.thread_id, run_id: run, ts });
        }
        collect("provider turn", rows);
      } else {
        warnings.push("T3 provider turn or node projection is missing; stall detection is coarser");
      }

      if (yield* hasTable("orchestration_v2_projection_messages")) {
        const rows: { thread_id: string; run_id: string; ts: string }[] = [];
        for (const raw of yield* sql`SELECT thread_id, run_id, MAX(updated_at) AS ts
            FROM orchestration_v2_projection_messages
            WHERE thread_id IN ${sql.in(ids)} AND run_id IS NOT NULL GROUP BY thread_id, run_id`) {
          const row = decodeActivityRow(raw);
          if (Option.isNone(row)) {
            malformed++;
            continue;
          }
          const run = textId(row.value.run_id);
          const ts = utcTimestamp(row.value.ts);
          if (run !== null && ts !== null)
            rows.push({ thread_id: row.value.thread_id, run_id: run, ts });
        }
        collect("message", rows);
      }

      const requestByThread = new Map<string, ThreadActivity["waiting_input"]>();
      if (yield* hasTable("orchestration_v2_projection_runtime_requests")) {
        const joinsNodes = yield* hasTable("orchestration_v2_projection_nodes");
        const select = joinsNodes
          ? sql`SELECT rr.runtime_request_id, rr.thread_id, n.run_id AS run_id, rr.kind, rr.status,
                rr.created_at
              FROM orchestration_v2_projection_runtime_requests rr
              LEFT JOIN orchestration_v2_projection_nodes n ON n.node_id = rr.node_id`
          : sql`SELECT rr.runtime_request_id, rr.thread_id, NULL AS run_id, rr.kind, rr.status,
                rr.created_at
              FROM orchestration_v2_projection_runtime_requests rr`;
        for (const raw of yield* sql`${select} WHERE rr.thread_id IN ${sql.in(ids)}
            AND rr.resolved_at IS NULL ORDER BY rr.created_at`) {
          const row = decodeRequestRow(raw);
          if (Option.isNone(row)) {
            malformed++;
            continue;
          }
          const created = utcTimestamp(row.value.created_at);
          if (created === null || requestByThread.has(row.value.thread_id)) continue;
          requestByThread.set(row.value.thread_id, {
            runtime_request_id: row.value.runtime_request_id,
            kind: textId(row.value.kind) ?? "request",
            created_at: created,
            run_id: textId(row.value.run_id),
          });
        }
      } else {
        warnings.push("T3 runtime request projection is missing; waiting attempts cannot be told");
      }

      const failures = new Map<string, { class: string | null; message: string | null }>();
      if (yield* hasTable("orchestration_v2_projection_turn_items")) {
        for (const raw of yield* sql`SELECT thread_id, run_id, payload_json
            FROM orchestration_v2_projection_turn_items
            WHERE type = 'error' AND thread_id IN ${sql.in(ids)}
            ORDER BY updated_at DESC`) {
          const row = decodeFailureRow(raw);
          if (Option.isNone(row)) {
            malformed++;
            continue;
          }
          const run = textId(row.value.run_id);
          if (run === null || failures.has(`${row.value.thread_id}\u0000${run}`)) continue;
          const failure = obj(parseJsonObject(row.value.payload_json)?.["failure"]);
          failures.set(`${row.value.thread_id}\u0000${run}`, {
            class: textId(failure?.["class"]),
            message: textId(failure?.["message"]),
          });
        }
      }

      for (const [threadId, thread] of threads) {
        thread.runs = runsByThread.get(threadId) ?? [];
        thread.waiting_input = requestByThread.get(threadId) ?? null;
        for (const run of thread.runs) {
          const key = `${threadId}\u0000${run.run_id}`;
          run.failure = failures.get(key) ?? null;
          const last = activity.get(key);
          if (last !== undefined) {
            run.last_activity_at = last.ts;
            run.last_activity_source = last.source;
          }
        }
      }
      if (malformed > 0) warnings.push(`T3: ${malformed} malformed liveness rows were skipped`);
      return { threads, warnings, available: true };
    }),
  );
