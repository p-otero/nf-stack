import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { CostQuality } from "@nf/contracts";
import { textId } from "../domain/usage.ts";
import { text } from "../domain/validate.ts";
import type { StrategyScope } from "./usage-queries.persistence.ts";

/** The coordinator thread whose turn started an attempt, and that turn's model. */
export interface CoordinatorTurn {
  readonly thread: string;
  readonly model: string | null;
}

const threadsIn = Effect.fn("CoordinatorStore.selectCoordinatorThreadsIn")(function* (
  sql: SqlClient.SqlClient,
  projectId: string,
) {
  const rows = yield* sql<{ thread_id: string }>`SELECT coordinator_thread_id AS thread_id
      FROM projects WHERE id = ${projectId} AND coordinator_thread_id IS NOT NULL
    UNION
    SELECT thread_id FROM coordinator_threads WHERE project_id = ${projectId}`;
  return rows
    .map((row) => textId(row.thread_id))
    .filter((thread): thread is string => thread !== null);
});

/** A project's coordinator threads: its legacy column plus every registered thread. */
export const selectCoordinatorThreadsIn = (sql: SqlClient.SqlClient, projectId: string) =>
  threadsIn(sql, projectId);

/** A project's coordinator threads, through the store's client. */
export const selectCoordinatorThreads = Effect.fn("CoordinatorStore.selectCoordinatorThreads")(
  function* (projectId: string) {
    const sql = yield* SqlClient.SqlClient;
    return yield* threadsIn(sql, projectId);
  },
);

interface TurnRow {
  thread: string;
  model: string | null;
  ts: string;
}

const closestTurn = Effect.fn("CoordinatorStore.closestTurn")(function* (
  sql: SqlClient.SqlClient,
  thread: string,
  at: string,
) {
  const rows = yield* sql<{ model: string | null; ts: string }>`SELECT model, ts FROM usage_events
    WHERE t3_thread_id = ${thread} AND ts <= ${at}
    ORDER BY ts DESC, id DESC LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { thread, model: row.model, ts: row.ts };
});

/** The earliest turn recorded after `at`, the record of the run an attempt started in. */
const followingTurn = Effect.fn("CoordinatorStore.followingTurn")(function* (
  sql: SqlClient.SqlClient,
  thread: string,
  at: string,
) {
  const rows = yield* sql<{ model: string | null; ts: string }>`SELECT model, ts FROM usage_events
    WHERE t3_thread_id = ${thread} AND ts > ${at}
    ORDER BY ts, id LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { thread, model: row.model, ts: row.ts };
});

const turnAt = Effect.fn("CoordinatorStore.coordinatorTurn")(function* (
  sql: SqlClient.SqlClient,
  threads: readonly string[],
  at: string,
) {
  let latest: TurnRow | null = null;
  for (const thread of threads) {
    const turn = yield* closestTurn(sql, thread, at);
    if (turn === null) continue;
    if (latest === null || turn.ts > latest.ts) latest = turn;
  }
  if (latest !== null) return { thread: latest.thread, model: latest.model };
  let next: TurnRow | null = null;
  for (const thread of threads) {
    const turn = yield* followingTurn(sql, thread, at);
    if (turn === null) continue;
    if (next === null || turn.ts < next.ts) next = turn;
  }
  if (next !== null) return { thread: next.thread, model: next.model };
  const only = threads[0];
  return threads.length === 1 && only !== undefined ? { thread: only, model: null } : null;
});

/**
 * The coordinator whose turn at or before `at` is the latest, else its earliest turn after `at`:
 * usage is written when a turn completes, so a run dispatches attempts before its turn is recorded.
 */
export const coordinatorTurnIn = (
  sql: SqlClient.SqlClient,
  threads: readonly string[],
  at: string,
) => turnAt(sql, threads, at);

const backfillIn = Effect.fnUntraced(function* (sql: SqlClient.SqlClient) {
  const attempts = yield* sql<{
    id: string;
    project_id: string;
    started_at: string;
    coordinator_thread_id: string | null;
    coordinator_model: string | null;
  }>`SELECT a.id, t.project_id, a.started_at, a.coordinator_thread_id, a.coordinator_model
    FROM attempts a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.coordinator_thread_id IS NULL OR a.coordinator_model IS NULL
    ORDER BY a.started_at, a.id`;
  const threads = new Map<string, readonly string[]>();
  for (const attempt of attempts) {
    let projectThreads = threads.get(attempt.project_id);
    if (projectThreads === undefined) {
      projectThreads = yield* threadsIn(sql, attempt.project_id);
      threads.set(attempt.project_id, projectThreads);
    }
    if (projectThreads.length === 0) continue;
    const turn = yield* turnAt(sql, projectThreads, attempt.started_at);
    if (turn === null) continue;
    const thread = attempt.coordinator_thread_id ?? turn.thread;
    const model = attempt.coordinator_model ?? turn.model;
    if (thread === attempt.coordinator_thread_id && model === attempt.coordinator_model) continue;
    yield* sql`UPDATE attempts SET coordinator_thread_id = ${thread},
        coordinator_model = ${model} WHERE id = ${attempt.id}`;
  }
});

/**
 * Fill the coordinator attribution of attempts that have none, from their project's usage
 * events. Attempts that still have no known coordinator stay NULL; a recorded value is kept.
 */
export const backfillAttemptCoordinators = Effect.fn(
  "CoordinatorStore.backfillAttemptCoordinators",
)(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* backfillIn(sql);
});

/**
 * Record one more coordinator thread of a project; registering a known thread changes nothing. A
 * new thread re-derives the project's attempts it would have started.
 */
export const registerCoordinatorThread = Effect.fn("CoordinatorStore.registerCoordinatorThread")(
  function* (projectId: string, value: string) {
    const sql = yield* SqlClient.SqlClient;
    const thread = yield* text("coordinator thread", value);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const known = yield* threadsIn(sql, projectId);
        if (known.includes(thread)) return { thread, created: false, threads: known };
        const at = new Date(yield* Clock.currentTimeMillis).toISOString();
        yield* sql`INSERT INTO coordinator_threads ${sql.insert({
          project_id: projectId,
          thread_id: thread,
          created_at: at,
        })} ON CONFLICT DO NOTHING`;
        yield* backfillIn(sql);
        return { thread, created: true, threads: [...known, thread] };
      }),
    );
  },
);

/** The v9 data step: same backfill, on the migration's own client. */
export const backfillAttemptCoordinatorsIn = (sql: SqlClient.SqlClient) => backfillIn(sql);

export interface CoordinatorTaskRow {
  coordinator: string | null;
  profile: string | null;
  tasks: number;
  accepted: number;
  n: number;
  first_pass: number;
  human_interventions: number;
}

export interface CoordinatorRepairRow {
  coordinator: string | null;
  profile: string | null;
  repairs: number;
}

export interface CoordinatorCostRow {
  cost_usd: number | null;
  cost_quality: CostQuality;
  /** The price layer behind an estimate, or `pi` for a charge Pi reported itself. */
  price_source: string | null;
}

export interface CoordinatorWorkerCostRow extends CoordinatorCostRow {
  coordinator: string | null;
  profile: string | null;
}

export interface CoordinatorModelCostRow extends CoordinatorCostRow {
  model: string | null;
}

/** Task counts, acceptance and first-pass verdicts per coordinator model and task profile. */
export const selectCoordinatorTasks = Effect.fn("CoordinatorStore.selectCoordinatorTasks")(
  function* (scope: StrategyScope) {
    const sql = yield* SqlClient.SqlClient;
    const where =
      scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
    return [
      ...(yield* sql<CoordinatorTaskRow>`SELECT d.coordinator AS coordinator, d.profile AS profile,
          COUNT(*) AS tasks,
          SUM(CASE WHEN d.status = 'done' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN d.accepted_first_pass IS NOT NULL THEN 1 ELSE 0 END) AS n,
          SUM(CASE WHEN d.accepted_first_pass = 1 THEN 1 ELSE 0 END) AS first_pass,
          SUM(d.human_interventions) AS human_interventions
        FROM (SELECT DISTINCT a.coordinator_model AS coordinator, t.profile AS profile, t.id AS id,
            t.status AS status, t.accepted_first_pass AS accepted_first_pass,
            t.human_interventions AS human_interventions
          FROM attempts a JOIN tasks t ON t.id = a.task_id ${where}) AS d
        GROUP BY d.coordinator, d.profile`),
    ];
  },
);

/** Repair attempts per coordinator model and task profile. */
export const selectCoordinatorRepairs = Effect.fn("CoordinatorStore.selectCoordinatorRepairs")(
  function* (scope: StrategyScope) {
    const sql = yield* SqlClient.SqlClient;
    const where =
      scope.kind === "project" ? sql`AND t.project_id = ${scope.projectId}` : sql.literal("");
    return [
      ...(yield* sql<CoordinatorRepairRow>`SELECT a.coordinator_model AS coordinator,
          t.profile AS profile, COUNT(*) AS repairs
        FROM attempts a JOIN tasks t ON t.id = a.task_id
        WHERE a.repair_of IS NOT NULL ${where}
        GROUP BY a.coordinator_model, t.profile`),
    ];
  },
);

/** What the attempts of accepted tasks cost, per coordinator model and task profile. */
export const selectCoordinatorWorkerCosts = Effect.fn(
  "CoordinatorStore.selectCoordinatorWorkerCosts",
)(function* (scope: StrategyScope) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`AND t.project_id = ${scope.projectId}` : sql.literal("");
  return [
    ...(yield* sql<CoordinatorWorkerCostRow>`SELECT a.coordinator_model AS coordinator,
        t.profile AS profile, e.cost_usd AS cost_usd, e.cost_quality AS cost_quality,
        e.price_source AS price_source
      FROM usage_events e
      JOIN attempts a ON a.id = COALESCE(e.attempt_id, e.parent_attempt_id)
      JOIN tasks t ON t.id = a.task_id
      WHERE t.status = 'done' ${where}`),
  ];
});

export type CoordinationScope =
  { readonly kind: "all" } | { readonly kind: "project"; readonly threads: readonly string[] };

/** The coordinator threads' own turns, each carrying the model that ran it. */
export const selectCoordinationModelCosts = Effect.fn(
  "CoordinatorStore.selectCoordinationModelCosts",
)(function* (scope: CoordinationScope) {
  const sql = yield* SqlClient.SqlClient;
  const select = sql`SELECT e.model AS model, e.cost_usd AS cost_usd,
      e.cost_quality AS cost_quality, e.price_source AS price_source
    FROM usage_events e WHERE e.bucket = 'coordination'`;
  if (scope.kind === "all") return [...(yield* sql<CoordinatorModelCostRow>`${select}`)];
  if (scope.threads.length === 0) return [];
  return [
    ...(yield* sql<CoordinatorModelCostRow>`${select}
      AND e.t3_thread_id IN ${sql.in(scope.threads)}`),
  ];
});
