import * as Schema from "effect/Schema";
import { AttemptStatus, ContextMode } from "./attempt.ts";
import { PriceSourceStatus } from "./prices.ts";
import { SubagentKind } from "./subagent.ts";
import { Strategy, TaskStatus } from "./task.ts";

export const USAGE_SOURCE = { T3: "t3", PI: "pi" } as const;
export type UsageSource = (typeof USAGE_SOURCE)[keyof typeof USAGE_SOURCE];
export const USAGE_SOURCES: readonly UsageSource[] = Object.values(USAGE_SOURCE);
export const UsageSource = Schema.Literals(Object.values(USAGE_SOURCE));
export const isUsageSource = (value: string): value is UsageSource =>
  USAGE_SOURCES.some((source) => source === value);

export const USAGE_STATUS = {
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
} as const;
export type UsageStatus = (typeof USAGE_STATUS)[keyof typeof USAGE_STATUS];
export const USAGE_STATUSES: readonly UsageStatus[] = Object.values(USAGE_STATUS);
export const UsageStatus = Schema.Literals(Object.values(USAGE_STATUS));

export const COST_QUALITY = {
  REPORTED: "reported",
  ESTIMATED: "estimated",
  UNKNOWN: "unknown",
} as const;
export type CostQuality = (typeof COST_QUALITY)[keyof typeof COST_QUALITY];
export const COST_QUALITIES: readonly CostQuality[] = Object.values(COST_QUALITY);
export const CostQuality = Schema.Literals(Object.values(COST_QUALITY));

export const USAGE_BUCKET = {
  ATTEMPT: "attempt",
  COORDINATION: "coordination",
  UNATTRIBUTED: "unattributed",
} as const;
export type UsageBucket = (typeof USAGE_BUCKET)[keyof typeof USAGE_BUCKET];
export const USAGE_BUCKETS: readonly UsageBucket[] = Object.values(USAGE_BUCKET);
export const UsageBucket = Schema.Literals(Object.values(USAGE_BUCKET));

export const USAGE_GROUP = {
  TASK: "task",
  ATTEMPT: "attempt",
  MODEL: "model",
  PROFILE: "profile",
  MONTH: "month",
} as const;
export type UsageGroup = (typeof USAGE_GROUP)[keyof typeof USAGE_GROUP];
export const USAGE_GROUPS: readonly UsageGroup[] = Object.values(USAGE_GROUP);
export const UsageGroup = Schema.Literals(Object.values(USAGE_GROUP));

/** Task-level grouping: the strategy is a task field, so its metrics are acceptance cost and
 * first-pass rate. */
export const STRATEGY_GROUP = "strategy" as const;

/** Task-level grouping like `strategy`, over an attempt's context transfer mode. */
export const CONTEXT_GROUP = "context" as const;

/** Task-level grouping by the model that coordinated the attempts dispatching the work. */
export const COORDINATOR_GROUP = "coordinator" as const;
export const STATS_GROUPS: readonly string[] = [
  ...USAGE_GROUPS,
  STRATEGY_GROUP,
  CONTEXT_GROUP,
  COORDINATOR_GROUP,
];

export const SYNC_STATUS = { OK: "ok", PARTIAL: "partial", FAILED: "failed" } as const;
export type SyncStatus = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS];
export const SyncStatus = Schema.Literals(Object.values(SYNC_STATUS));

/** T3 `otherUsage` rows carry no cache split, so they stay unpriced and use this source-key
 * prefix. */
export const AGGREGATE_SOURCE_PREFIX = "t3:sub:";

const NullableString = Schema.NullOr(Schema.String);
const TokenCount = Schema.NullOr(Schema.Finite);

/** `input_tokens` is uncached input only, cache stays apart, `output_tokens` includes reasoning
 * (`reasoning_tokens` is a reporting subset, never priced on top). Unknown is `null`, never 0. */
export const TokenFields = Schema.Struct({
  input_tokens: TokenCount,
  output_tokens: TokenCount,
  cache_read_tokens: TokenCount,
  cache_write_tokens: TokenCount,
  reasoning_tokens: TokenCount,
});
export type TokenFields = typeof TokenFields.Type;

/** One unit of consumption read from a source, before attribution. */
export const UsageEventInput = Schema.Struct({
  ...TokenFields.fields,
  source: UsageSource,
  /** Stable, session-independent dedupe key. */
  source_key: Schema.String,
  t3_thread_id: NullableString,
  native_session_id: NullableString,
  run_id: NullableString,
  turn_id: NullableString,
  provider: NullableString,
  model: NullableString,
  ts: Schema.String,
  usage_status: UsageStatus,
  is_subagent: Schema.Boolean,
  cost_usd: Schema.NullOr(Schema.Finite),
  cost_quality: CostQuality,
  price_source: NullableString,
  price_date: NullableString,
});
export type UsageEventInput = typeof UsageEventInput.Type;

/** A stored usage event (`usage_events` row). */
export const UsageEvent = Schema.Struct({
  ...UsageEventInput.fields,
  id: Schema.String,
  machine_id: Schema.String,
  attempt_id: NullableString,
  bucket: UsageBucket,
  created_at: Schema.String,
});
export type UsageEvent = typeof UsageEvent.Type;

export const SourceSyncResult = Schema.Struct({
  source: UsageSource,
  status: SyncStatus,
  seen: Schema.Finite,
  /** Source entries skipped inside the reader (Pi fork replays). */
  duplicates: Schema.Finite,
  inserted: Schema.Finite,
  updated: Schema.Finite,
  skipped: Schema.Finite,
  attributed: Schema.Finite,
  coordination: Schema.Finite,
  unattributed: Schema.Finite,
  /** Subagent spawn records T3 reported for this source (0 for Pi). */
  spawns: Schema.Finite,
  cursor: NullableString,
  error: NullableString,
  warnings: Schema.Array(Schema.String),
});
export type SourceSyncResult = typeof SourceSyncResult.Type;

export const SyncResult = Schema.Struct({
  dry_run: Schema.Boolean,
  price_date: NullableString,
  /** The price layers behind this sync's cost estimates, in lookup order. */
  price_sources: Schema.Array(PriceSourceStatus),
  sources: Schema.Array(SourceSyncResult),
  seen: Schema.Finite,
  inserted: Schema.Finite,
  updated: Schema.Finite,
  skipped: Schema.Finite,
  attributed: Schema.Finite,
  coordination: Schema.Finite,
  unattributed: Schema.Finite,
  spawns: Schema.Finite,
  warnings: Schema.Array(Schema.String),
});
export type SyncResult = typeof SyncResult.Type;

export const CostSummary = Schema.Struct({
  value: Schema.NullOr(Schema.Finite),
  quality: CostQuality,
  reported_events: Schema.Finite,
  estimated_events: Schema.Finite,
  unknown_events: Schema.Finite,
});
export type CostSummary = typeof CostSummary.Type;

/** Unpriced T3 `otherUsage` rows, shown apart from normal consumption. */
export const AggregateTotals = Schema.Struct({
  events: Schema.Finite,
  input_tokens: TokenCount,
  output_tokens: TokenCount,
});
export type AggregateTotals = typeof AggregateTotals.Type;

export const UsageTotals = Schema.Struct({
  events: Schema.Finite,
  subagent_events: Schema.Finite,
  aggregate: AggregateTotals,
  ...TokenFields.fields,
  cost: CostSummary,
});
export type UsageTotals = typeof UsageTotals.Type;

/** Spawns of one kind and model, with the app-owned child usage they produced. */
export const SubagentUsageGroup = Schema.Struct({
  kind: SubagentKind,
  model: NullableString,
  count: Schema.Finite,
  /** Native subagents have no events here; their tokens stay in the parent's AGG-* columns. */
  usage: UsageTotals,
});
export type SubagentUsageGroup = typeof SubagentUsageGroup.Type;

export const AttemptSubagents = Schema.Struct({
  count: Schema.Finite,
  groups: Schema.Array(SubagentUsageGroup),
});
export type AttemptSubagents = typeof AttemptSubagents.Type;

export const UsageRow = Schema.Struct({
  key: Schema.String,
  /** Subagent spawns behind this row's attempts. */
  spawns: Schema.Finite,
  ...UsageTotals.fields,
});
export type UsageRow = typeof UsageRow.Type;

export const UsageStats = Schema.Struct({
  by: UsageGroup,
  all_projects: Schema.Boolean,
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  rows: Schema.Array(UsageRow),
  totals: UsageTotals,
  spawns: Schema.Finite,
  /** Distinct `price_source` values of the priced events in scope, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type UsageStats = typeof UsageStats.Type;

/** One strategy's tasks and what reaching acceptance cost under it. */
export const StrategyStatsRow = Schema.Struct({
  /** NULL: the tasks predate strategies or none was chosen. */
  strategy: Schema.NullOr(Strategy),
  /** The coordinator thread's own usage: no tasks, no first-pass verdict. */
  coordination: Schema.optionalKey(Schema.Boolean),
  tasks: Schema.Finite,
  /** Accepted tasks with a first-pass verdict: the rate's sample size. */
  n: Schema.Finite,
  first_pass: Schema.Finite,
  first_pass_rate: Schema.NullOr(Schema.Finite),
  /** Accepted tasks only, with the quality of every event behind the sum. */
  cost_to_acceptance: CostSummary,
  /** Spawns attributed to attempts of these tasks. */
  spawns: Schema.Finite,
});
export type StrategyStatsRow = typeof StrategyStatsRow.Type;

export const StrategyStats = Schema.Struct({
  by: Schema.Literal(STRATEGY_GROUP),
  all_projects: Schema.Boolean,
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  rows: Schema.Array(StrategyStatsRow),
  /** Distinct `price_source` values behind the acceptance costs of these rows, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type StrategyStats = typeof StrategyStats.Type;

/** One context transfer's tasks and what reaching acceptance cost under it. */
export const ContextStatsRow = Schema.Struct({
  context: ContextMode,
  /** Tasks with at least one attempt in this context; a task can appear in several rows. */
  tasks: Schema.Finite,
  /** Accepted tasks with a first-pass verdict: the rate's sample size. */
  n: Schema.Finite,
  first_pass: Schema.Finite,
  first_pass_rate: Schema.NullOr(Schema.Finite),
  /** Accepted tasks only, with the quality of every event behind the sum. */
  cost_to_acceptance: CostSummary,
  /** Spawns attributed to attempts of these tasks in this context. */
  spawns: Schema.Finite,
});
export type ContextStatsRow = typeof ContextStatsRow.Type;

export const ContextStats = Schema.Struct({
  by: Schema.Literal(CONTEXT_GROUP),
  all_projects: Schema.Boolean,
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  rows: Schema.Array(ContextStatsRow),
  /** Distinct `price_source` values behind the acceptance costs of these rows, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type ContextStats = typeof ContextStats.Type;

/** One coordinator model: the tasks it dispatched, its own turns and the workers' cost. */
export const CoordinatorStatsRow = Schema.Struct({
  /** The model of the coordinator thread when the attempts started; NULL when unknown. */
  coordinator: Schema.NullOr(Schema.String),
  /** Set on a `--profile-breakdown` sub-row: the profile of the tasks behind its numbers. */
  profile: Schema.optionalKey(NullableString),
  tasks: Schema.Finite,
  /** Tasks that reached acceptance under this coordinator. */
  accepted: Schema.Finite,
  /** Accepted tasks with a first-pass verdict: the rate's sample size. */
  n: Schema.Finite,
  first_pass: Schema.Finite,
  first_pass_rate: Schema.NullOr(Schema.Finite),
  /** Repair attempts of this coordinator's tasks. */
  repairs: Schema.Finite,
  human_interventions: Schema.Finite,
  /** The coordinator thread's own turns, each priced by the model that ran it. */
  coordination_cost: CostSummary,
  /** The workers' attempts on the accepted tasks. */
  worker_cost: CostSummary,
  /** Known cost (coordination plus worker) per accepted task; NULL when unknown or none. */
  cost_per_accepted_task: Schema.NullOr(Schema.Finite),
});
export type CoordinatorStatsRow = typeof CoordinatorStatsRow.Type;

export const CoordinatorStats = Schema.Struct({
  by: Schema.Literal(COORDINATOR_GROUP),
  all_projects: Schema.Boolean,
  project: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  profile_breakdown: Schema.Boolean,
  rows: Schema.Array(CoordinatorStatsRow),
  /** Distinct `price_source` values of the priced turns behind these rows, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type CoordinatorStats = typeof CoordinatorStats.Type;

export const AttemptUsage = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  status: AttemptStatus,
  started_at: Schema.String,
  ended_at: NullableString,
  ...UsageTotals.fields,
  subagents: AttemptSubagents,
});
export type AttemptUsage = typeof AttemptUsage.Type;

export const TaskUsage = Schema.Struct({
  task: Schema.Struct({ key: Schema.String, title: Schema.String, status: TaskStatus }),
  done: Schema.Boolean,
  attempts: Schema.Array(AttemptUsage),
  totals: UsageTotals,
  cost_to_acceptance: CostSummary,
  /** Distinct `price_source` values of the priced events of this task, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type TaskUsage = typeof TaskUsage.Type;
