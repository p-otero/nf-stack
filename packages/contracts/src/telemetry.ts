/** Board Telemetry tab view. It regroups the events `nf stats` already prices: unknown stays
 * `null` with quality `unknown`, the coordinator thread is never part of a task metric, and
 * sample-size thresholds belong to the board. */
import * as Schema from "effect/Schema";
import { ContextMode } from "./attempt.ts";
import { Quantity } from "./board.ts";

/** What the rows are grouped by; the board switches between them. */
export const TELEMETRY_GROUP_BY = {
  STRATEGY: "strategy",
  MODEL: "model",
  PROFILE: "profile",
  TASK: "task",
  COORDINATOR: "coordinator",
} as const;
export type TelemetryGroupBy = (typeof TELEMETRY_GROUP_BY)[keyof typeof TELEMETRY_GROUP_BY];
export const TELEMETRY_GROUP_BYS: readonly TelemetryGroupBy[] = Object.values(TELEMETRY_GROUP_BY);
export const TelemetryGroupBy = Schema.Literals(Object.values(TELEMETRY_GROUP_BY));

/** What a row stands for; the coordinator thread carries no first-pass verdict. */
export const TELEMETRY_ENTITY_KIND = {
  STRATEGY: "strategy",
  MODEL: "model",
  PROFILE: "profile",
  TASK: "task",
  COORDINATOR: "coordinator",
  COORDINATION: "coordination",
} as const;
export type TelemetryEntityKind =
  (typeof TELEMETRY_ENTITY_KIND)[keyof typeof TELEMETRY_ENTITY_KIND];
export const TELEMETRY_ENTITY_KINDS: readonly TelemetryEntityKind[] =
  Object.values(TELEMETRY_ENTITY_KIND);
export const TelemetryEntityKind = Schema.Literals(Object.values(TELEMETRY_ENTITY_KIND));

/** Number of `--chart-<n>` tokens an entity's color index can name. */
export const TELEMETRY_COLORS = 5;

export const TELEMETRY_COORDINATION_ID = "coordination" as const;

const TelemetryColor = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: TELEMETRY_COLORS }),
);

export const TelemetryEntity = Schema.Struct({
  /** Stable grouping key: the strategy, model, profile or task key. */
  id: Schema.String,
  /** What the board shows for the row. */
  label: Schema.String,
  kind: TelemetryEntityKind,
  /** `--chart-<n>` token, distinct within a view while the entities fit the palette; `null` for the
   * coordinator, which paints with the neutral swatch. */
  color: Schema.NullOr(TelemetryColor),
});
export type TelemetryEntity = typeof TelemetryEntity.Type;

/** Accepted tasks with a first-pass verdict; the rate's sample. */
export const TelemetryFirstPass = Schema.Struct({
  accepted: Schema.Finite,
  total: Schema.Finite,
});
export type TelemetryFirstPass = typeof TelemetryFirstPass.Type;

/** Cost to acceptance as `nf stats` reports it, split into `base` and `repair`, with the median
 * per-task cost of acceptance. */
export const TelemetryCost = Schema.Struct({
  ...Quantity.fields,
  base: Quantity,
  repair: Quantity,
  median: Quantity,
});
export type TelemetryCost = typeof TelemetryCost.Type;

/** The metrics every row carries, and the totals plus the coordinator's own usage. */
const TelemetryMetricFields = {
  /** Tasks in the row, open ones included. */
  tasks: Schema.Finite,
  /** Accepted tasks with a first-pass verdict. */
  n: Schema.Finite,
  firstPass: TelemetryFirstPass,
  costToAcceptance: TelemetryCost,
  /** Known cost to acceptance per accepted task; null without an accepted task or a price. */
  costPerAcceptedTask: Quantity,
  tokens: Quantity,
  /** Input, cache read and cache write are the input side of `tokens`; this is the cached part. */
  cacheRead: Quantity,
  /** Cache read / (input + cache read + cache write), 0..1; null when the input side is unknown. */
  cacheShare: Schema.NullOr(Schema.Finite),
  /** Repair attempts behind the accepted tasks' events. */
  repairs: Schema.Finite,
  /** Subagent spawns of the entity's attempts, as `nf stats` counts them. */
  spawns: Schema.Finite,
};

export const TelemetryShare = Schema.Struct({
  /** Part of the task totals, 0..1; null when either side is unknown or for the coordinator. */
  cost: Schema.NullOr(Schema.Finite),
  /** Same terms as `cost`. */
  tokens: Schema.NullOr(Schema.Finite),
});
export type TelemetryShare = typeof TelemetryShare.Type;

/** What one entity costs and how many tasks and verdicts stand behind it. */
export const TelemetryMetrics = Schema.Struct({ ...TelemetryMetricFields });
export type TelemetryMetrics = typeof TelemetryMetrics.Type;

export const TelemetryRow = Schema.Struct({
  entity: TelemetryEntity,
  ...TelemetryMetricFields,
  share: TelemetryShare,
});
export type TelemetryRow = typeof TelemetryRow.Type;

/** The coordinator thread's own usage, which no task metric above includes. */
export const TelemetryCoordinationTotals = Schema.Struct({
  cost: Quantity,
  tokens: Quantity,
  spawns: Schema.Finite,
});
export type TelemetryCoordinationTotals = typeof TelemetryCoordinationTotals.Type;

export const TelemetryTotals = Schema.Struct({
  ...TelemetryMetricFields,
  coordination: TelemetryCoordinationTotals,
});
export type TelemetryTotals = typeof TelemetryTotals.Type;

/** One attempt context transfer: what it cost per accepted task, its verdicts and its cache reuse. */
export const TelemetryCacheContext = Schema.Struct({
  mode: ContextMode,
  tasks: Schema.Finite,
  n: Schema.Finite,
  firstPass: TelemetryFirstPass,
  /** Accepted-path cost, with repair attempts apart from new work. */
  costToAcceptance: TelemetryCost,
  /** Known cost to acceptance per accepted task; null without an accepted task or a price. */
  costPerAcceptedTask: Quantity,
  tokens: Quantity,
  cacheRead: Quantity,
  cacheShare: Schema.NullOr(Schema.Finite),
  /** Attempts in this context, new work and repairs apart. */
  attempts: Schema.Struct({ newWork: Schema.Finite, repair: Schema.Finite }),
});
export type TelemetryCacheContext = typeof TelemetryCacheContext.Type;

/** One model's cached input, across the tasks' attempts and every context mode. */
export const TelemetryCacheModel = Schema.Struct({
  id: Schema.String,
  tokens: Quantity,
  cacheRead: Quantity,
  cacheShare: Schema.NullOr(Schema.Finite),
  /** Events behind this model whose cache read has no complete input and cache-read rate. */
  unpriced: Schema.Finite,
});
export type TelemetryCacheModel = typeof TelemetryCacheModel.Type;

/** Cache reuse and what the cached input saved, from the same rates that priced the events. */
export const TelemetryCache = Schema.Struct({
  contexts: Schema.Array(TelemetryCacheContext),
  models: Schema.Array(TelemetryCacheModel),
  /** The task events behind both groupings; the coordinator thread stays out, as in the totals. */
  totals: Schema.Struct({
    tokens: Quantity,
    cacheRead: Quantity,
    cacheShare: Schema.NullOr(Schema.Finite),
    /** (input rate - cache read rate) x cache read tokens, over the events a price covers. */
    savings: Quantity,
    /** Cache read tokens of events without both rates: `savings` is then a floor. */
    unpriced: Schema.NullOr(Schema.Finite),
  }),
});
export type TelemetryCache = typeof TelemetryCache.Type;

/** One UTC day's cost, whoever ran it. */
export const TelemetryDay = Schema.Struct({
  /** YYYY-MM-DD. */
  date: Schema.String,
  /** The tasks' attempts and unattributed work with a task. */
  workers: Quantity,
  /** The coordinator threads' own turns. */
  coordination: Quantity,
});
export type TelemetryDay = typeof TelemetryDay.Type;

export const TelemetryView = Schema.Struct({
  /** ISO 8601 UTC: the first and last event behind the view, or the snapshot time when empty. */
  range: Schema.Struct({ from: Schema.String, to: Schema.String }),
  groupBy: TelemetryGroupBy,
  rows: Schema.Array(TelemetryRow),
  /** The project's tasks; the coordinator thread is reported apart in its `coordination`. */
  totals: TelemetryTotals,
  /** Events behind the task totals that no price covers: their cost is a floor, never a guess. */
  unpriced: Schema.Struct({ events: Schema.Finite, tokens: Schema.NullOr(Schema.Finite) }),
  cache: TelemetryCache,
  /** Every day with a priced or unpriced event, oldest first. */
  daily: Schema.Array(TelemetryDay),
  /** Distinct `price_source` values behind the view's costs, cache savings and daily series, sorted. */
  price_sources: Schema.Array(Schema.String),
});
export type TelemetryView = typeof TelemetryView.Type;
