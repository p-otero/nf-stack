import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ContextMode, CostQuality, Strategy, TaskStatus, UsageBucket } from "@nf/contracts";

/** A stored event joined with its attempt and task, as stats need it. */
export interface StatsEventRow {
  source_key: string;
  ts: string;
  model: string | null;
  bucket: UsageBucket;
  is_subagent: number;
  cost_usd: number | null;
  cost_quality: CostQuality;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  attempt_id: string | null;
  parent_attempt_id: string | null;
  t3_thread_id: string | null;
  /** The coordinator model of the event's attempt (or of the attempt that spawned it). */
  attempt_coordinator_model: string | null;
  attempt_key: string | null;
  task_key: string | null;
  profile: string | null;
  /** Set when the event's attempt repairs another one: its cost is repair, not base. */
  attempt_repair_of: string | null;
  /** The context the event's attempt (or the attempt that spawned it) transferred. */
  context_mode: ContextMode | null;
  /** The layer the cost estimate came from (`litellm`, `openrouter`, `manual`) or `pi`. */
  price_source: string | null;
}

export type StatsScope =
  | { readonly kind: "all" }
  | {
      readonly kind: "project";
      readonly projectId: string;
      readonly coordinatorThreads: readonly string[];
    }
  | { readonly kind: "attempts"; readonly attemptIds: readonly string[] };

/** Project scope for the task-level strategy aggregates. */
export type StrategyScope =
  { readonly kind: "all" } | { readonly kind: "project"; readonly projectId: string };

export interface StrategyTaskRow {
  strategy: Strategy | null;
  tasks: number;
  /** Accepted tasks that have a first-pass verdict: the rate's denominator. */
  n: number;
  first_pass: number;
}

/** A task as the telemetry view groups it. */
export interface TelemetryTaskRow {
  id: string;
  key: string;
  title: string;
  strategy: Strategy | null;
  profile: string | null;
  status: TaskStatus;
  /** 1, 0 or NULL: no verdict yet. */
  accepted_first_pass: number | null;
}

/** Every task of the scope, open ones included: telemetry rows group tasks, not only usage. */
export const selectTelemetryTasks = Effect.fn("UsageStore.selectTelemetryTasks")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
  return [
    ...(yield* sql<TelemetryTaskRow>`SELECT t.id, t.key, t.title, t.strategy, t.profile, t.status,
      t.accepted_first_pass FROM tasks t ${where}`),
  ];
});

/** An attempt of the scope, to attribute spawns and repairs to the task that owns it. */
export interface ScopeAttemptRow {
  id: string;
  task_id: string;
  repair_of: string | null;
  coordinator_model: string | null;
  context_mode: ContextMode;
}

export const selectScopeAttempts = Effect.fn("UsageStore.selectScopeAttempts")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
  return [
    ...(yield* sql<ScopeAttemptRow>`SELECT a.id, a.task_id, a.repair_of, a.coordinator_model,
        a.context_mode
      FROM attempts a
      JOIN tasks t ON t.id = a.task_id ${where}`),
  ];
});

/**
 * The coordinator threads' own usage. It belongs to no task, so no strategy or task row covers it;
 * `nf stats --by strategy` and `nf stats --by coordinator` report it apart.
 */
export const selectCoordinationCosts = Effect.fn("UsageStore.selectCoordinationCosts")(function* (
  coordinatorThreads: readonly string[],
) {
  const sql = yield* SqlClient.SqlClient;
  if (coordinatorThreads.length === 0) return [];
  return [
    ...(yield* sql<{
      cost_usd: number | null;
      cost_quality: CostQuality;
      price_source: string | null;
    }>`SELECT e.cost_usd,
          e.cost_quality, e.price_source FROM usage_events e
          WHERE e.bucket = 'coordination' AND e.t3_thread_id IN ${sql.in(coordinatorThreads)}`),
  ];
});

/** Task counts and first-pass verdicts per strategy; NULL is its own group. */
export const selectStrategyTasks = Effect.fn("UsageStore.selectStrategyTasks")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
  const rows = yield* sql<StrategyTaskRow>`SELECT t.strategy AS strategy, COUNT(*) AS tasks,
      SUM(CASE WHEN t.accepted_first_pass IS NOT NULL THEN 1 ELSE 0 END) AS n,
      SUM(CASE WHEN t.accepted_first_pass = 1 THEN 1 ELSE 0 END) AS first_pass
    FROM tasks t ${where}
    GROUP BY t.strategy`;
  return rows.map((row) => ({
    strategy: row.strategy ?? null,
    tasks: row.tasks,
    n: row.n,
    first_pass: row.first_pass,
  }));
});

/** What reaching acceptance cost under each strategy: one row per priced or unpriced event. */
export const selectStrategyCosts = Effect.fn("UsageStore.selectStrategyCosts")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`AND t.project_id = ${scope.projectId}` : sql.literal("");
  const rows = yield* sql<StrategyCostRow>`SELECT t.strategy AS strategy, e.cost_usd AS cost_usd,
      e.cost_quality AS cost_quality, e.price_source AS price_source
    FROM usage_events e
    JOIN attempts a ON a.id = COALESCE(e.attempt_id, e.parent_attempt_id)
    JOIN tasks t ON t.id = a.task_id
    WHERE t.status = 'done' ${where}`;
  return rows.map((row) => ({
    strategy: row.strategy ?? null,
    cost_usd: row.cost_usd,
    cost_quality: row.cost_quality,
    price_source: row.price_source,
  }));
});

export interface StrategyCostRow {
  strategy: Strategy | null;
  cost_usd: number | null;
  cost_quality: CostQuality;
  price_source: string | null;
}

export interface ContextTaskRow {
  context: ContextMode;
  tasks: number;
  /** Accepted tasks that have a first-pass verdict: the rate's denominator. */
  n: number;
  first_pass: number;
}

/** Task counts and first-pass verdicts per attempt context transfer; a task may be in several. */
export const selectContextTasks = Effect.fn("UsageStore.selectContextTasks")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
  const rows = yield* sql<ContextTaskRow>`SELECT a.context_mode AS context,
      COUNT(DISTINCT t.id) AS tasks,
      COUNT(DISTINCT CASE WHEN t.accepted_first_pass IS NOT NULL THEN t.id END) AS n,
      COUNT(DISTINCT CASE WHEN t.accepted_first_pass = 1 THEN t.id END) AS first_pass
    FROM attempts a
    JOIN tasks t ON t.id = a.task_id
    ${where}
    GROUP BY a.context_mode`;
  return rows.map((row) => ({
    context: row.context,
    tasks: row.tasks,
    n: row.n,
    first_pass: row.first_pass,
  }));
});

/** What attempts of each context cost on tasks that reached acceptance. */
export const selectContextCosts = Effect.fn("UsageStore.selectContextCosts")(function* (
  scope: StrategyScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const where =
    scope.kind === "project" ? sql`AND t.project_id = ${scope.projectId}` : sql.literal("");
  const rows = yield* sql<ContextCostRow>`SELECT a.context_mode AS context, e.cost_usd AS cost_usd,
      e.cost_quality AS cost_quality, e.price_source AS price_source
    FROM usage_events e
    JOIN attempts a ON a.id = COALESCE(e.attempt_id, e.parent_attempt_id)
    JOIN tasks t ON t.id = a.task_id
    WHERE t.status = 'done' ${where}`;
  return rows.map((row) => ({
    context: row.context,
    cost_usd: row.cost_usd,
    cost_quality: row.cost_quality,
    price_source: row.price_source,
  }));
});

export interface ContextCostRow {
  context: ContextMode;
  cost_usd: number | null;
  cost_quality: CostQuality;
  price_source: string | null;
}

export const selectStatsEvents = Effect.fn("UsageStore.selectStatsEvents")(function* (
  scope: StatsScope,
) {
  const sql = yield* SqlClient.SqlClient;
  const select = sql`SELECT e.source_key, e.ts, e.model, e.bucket, e.is_subagent, e.cost_usd, e.cost_quality,
    e.price_source, e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens,
    e.reasoning_tokens, e.attempt_id, e.parent_attempt_id, e.t3_thread_id,
    COALESCE(a.coordinator_model, pa.coordinator_model) AS attempt_coordinator_model,
    COALESCE(a.key, pa.key) AS attempt_key, COALESCE(t.key, pt.key) AS task_key,
    COALESCE(t.profile, pt.profile) AS profile, COALESCE(a.repair_of, pa.repair_of) AS attempt_repair_of,
    COALESCE(a.context_mode, pa.context_mode) AS context_mode
    FROM usage_events e
    LEFT JOIN attempts a ON a.id = e.attempt_id
    LEFT JOIN tasks t ON t.id = a.task_id
    LEFT JOIN attempts pa ON pa.id = e.parent_attempt_id
    LEFT JOIN tasks pt ON pt.id = pa.task_id`;
  if (scope.kind === "all") return [...(yield* sql<StatsEventRow>`${select}`)];
  if (scope.kind === "project") {
    const coordination =
      scope.coordinatorThreads.length > 0
        ? sql`OR (e.bucket = 'coordination' AND e.t3_thread_id IN ${sql.in(scope.coordinatorThreads)})`
        : sql.literal("");
    return [
      ...(yield* sql<StatsEventRow>`${select}
          WHERE (e.attempt_id IS NOT NULL AND t.project_id = ${scope.projectId})
             OR (e.parent_attempt_id IS NOT NULL AND pt.project_id = ${scope.projectId})
             ${coordination}`),
    ];
  }
  if (scope.attemptIds.length === 0) return [];
  return [
    ...(yield* sql<StatsEventRow>`${select}
      WHERE e.attempt_id IN ${sql.in(scope.attemptIds)}
         OR e.parent_attempt_id IN ${sql.in(scope.attemptIds)}`),
  ];
});
