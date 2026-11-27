import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  STRATEGIES,
  TASK_STATUS,
  TELEMETRY_COORDINATION_ID,
  TELEMETRY_ENTITY_KIND,
  TELEMETRY_GROUP_BY,
  USAGE_BUCKET,
  TelemetryView,
} from "@nf/contracts";
import type {
  TelemetryEntityKind,
  TelemetryFirstPass,
  TelemetryGroupBy,
  TelemetryMetrics,
  TelemetryRow,
  TelemetryView as TelemetryViewType,
} from "@nf/contracts";
import type { PriceFile } from "../domain/prices.ts";
import { colorIndexes } from "../domain/telemetry.ts";
import { selectCoordinatorThreads } from "../persistence/coordinators.persistence.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import {
  selectCoordinatorSpawnCount,
  selectSpawnCountsByAttempt,
  selectSpawnCountsByModel,
  selectSpawnCountsByStrategy,
} from "../persistence/subagent.persistence.ts";
import type { SpawnScope } from "../persistence/subagent.persistence.ts";
import {
  selectScopeAttempts,
  selectStatsEvents,
  selectTelemetryTasks,
} from "../persistence/usage-queries.persistence.ts";
import type {
  ScopeAttemptRow,
  StatsEventRow,
  StrategyScope,
  TelemetryTaskRow,
} from "../persistence/usage-queries.persistence.ts";
import { cacheContexts, cacheModels, dailyCosts } from "./telemetry-cache.ts";
import { NO_COORDINATOR, NO_MODEL, NO_PROFILE, NO_STRATEGY } from "./telemetry-labels.ts";
import {
  cacheShare,
  cacheSavings,
  costQuantity,
  measured,
  medianQuantity,
  perAccepted,
  share,
  tokenQuantity,
  tokenValue,
} from "./telemetry-metrics.ts";
import { costSummary, priceSources } from "./usage-stats.ts";

const decodeTelemetryView = Schema.decodeEffect(TelemetryView);

const coordinatorEntity = (model: string | null): Entity => ({
  id: model ?? NO_COORDINATOR,
  label: model ?? NO_COORDINATOR,
});

/**
 * The metrics of one entity: its tasks count every open one, its cost only the accepted path
 * (`acceptedExtra` adds work that belongs to no task, such as the coordinator's own turns) and its
 * tokens every event the entity reported, because a token spent on an open task was still spent.
 */
function metrics(input: {
  readonly tasks: readonly TelemetryTaskRow[];
  readonly events: readonly StatsEventRow[];
  readonly spawns: number;
  readonly acceptedExtra?: readonly StatsEventRow[];
}): TelemetryMetrics {
  const done = new Set(
    input.tasks.filter((task) => task.status === TASK_STATUS.DONE).map((task) => task.key),
  );
  const accepted = [
    ...input.events.filter((event) => event.task_key !== null && done.has(event.task_key)),
    ...(input.acceptedExtra ?? []),
  ];
  const base = accepted.filter((event) => event.attempt_repair_of === null);
  const repair = accepted.filter((event) => event.attempt_repair_of !== null);
  const perTask = new Map<string, number>();
  for (const event of accepted) {
    if (event.cost_usd === null || event.task_key === null) continue;
    perTask.set(event.task_key, (perTask.get(event.task_key) ?? 0) + event.cost_usd);
  }
  const repaired = new Set<string>();
  for (const event of input.events) {
    const attempt = event.attempt_id ?? event.parent_attempt_id;
    if (event.attempt_repair_of !== null && attempt !== null) repaired.add(attempt);
  }
  const verdicts = input.tasks.filter((task) => task.accepted_first_pass !== null);
  const firstPass: TelemetryFirstPass = {
    accepted: verdicts.filter((task) => task.accepted_first_pass === 1).length,
    total: verdicts.length,
  };
  const costToAcceptance = {
    ...costQuantity(costSummary(accepted)),
    base: costQuantity(costSummary(base)),
    repair: costQuantity(costSummary(repair)),
    median: medianQuantity([...perTask.values()]),
  };
  return {
    tasks: input.tasks.length,
    n: firstPass.total,
    firstPass,
    costToAcceptance,
    costPerAcceptedTask: perAccepted(costToAcceptance, done.size),
    tokens: tokenQuantity(input.events),
    cacheRead: measured(tokenValue(input.events, ["cache_read_tokens"])),
    cacheShare: cacheShare(input.events),
    repairs: repaired.size,
    spawns: input.spawns,
  };
}

interface Entity {
  readonly id: string;
  readonly label: string;
}

interface Bucket extends Entity {
  readonly kind: TelemetryEntityKind;
  readonly taskKeys: Set<string>;
  readonly events: StatsEventRow[];
}

export interface TelemetryOptions {
  /** The project to group, or `null` for every project in the store. */
  readonly projectId: string | null;
  readonly groupBy: TelemetryGroupBy;
  /** The snapshot's "now": it dates the range when the store has no usage yet. */
  readonly at: string;
  /** The machine's price chain; without it cache savings stay unknown, never guessed. */
  readonly prices?: PriceFile | undefined;
}

/**
 * One project's or every project's telemetry, from the same events and cost rules as `nf stats`;
 * across projects every coordination thread is included, as in `nf stats --all-projects`.
 */
export const telemetryView = Effect.fn("Telemetry.telemetryView")(function* (
  opts: TelemetryOptions,
) {
  const store = yield* TaskStore;
  const project = opts.projectId === null ? null : yield* store.getProject(opts.projectId);
  const scope: StrategyScope =
    project === null ? { kind: "all" } : { kind: "project", projectId: project.id };
  const projectId = project?.id ?? null;
  const coordinatorThreads = project === null ? [] : yield* selectCoordinatorThreads(project.id);
  const tasks = yield* selectTelemetryTasks(scope);
  const attempts = yield* selectScopeAttempts(scope);
  const events = yield* selectStatsEvents(
    projectId === null ? { kind: "all" } : { kind: "project", projectId, coordinatorThreads },
  );
  const spawnScope: SpawnScope =
    projectId === null ? { kind: "all" } : { kind: "project", projectId, coordinatorThreads };
  const spawnsByAttempt = yield* selectSpawnCountsByAttempt(spawnScope);
  const spawnsByStrategy =
    opts.groupBy === TELEMETRY_GROUP_BY.STRATEGY
      ? yield* selectSpawnCountsByStrategy(scope)
      : new Map<string | null, number>();
  const spawnsByModel =
    opts.groupBy === TELEMETRY_GROUP_BY.MODEL
      ? yield* selectSpawnCountsByModel(spawnScope)
      : new Map<string, number>();
  const coordinatorSpawns = yield* selectCoordinatorSpawnCount(coordinatorThreads);

  const taskByKey = new Map(tasks.map((task) => [task.key, task]));
  const keyByTaskId = new Map(tasks.map((task) => [task.id, task.key]));
  const attemptsByTask = new Map<string, ScopeAttemptRow[]>();
  for (const attempt of attempts) {
    const list = attemptsByTask.get(attempt.task_id) ?? [];
    list.push(attempt);
    attemptsByTask.set(attempt.task_id, list);
  }
  const attemptsOf = (taskKeys: ReadonlySet<string>): ScopeAttemptRow[] => {
    const out: ScopeAttemptRow[] = [];
    for (const key of taskKeys) {
      const task = taskByKey.get(key);
      if (task === undefined) continue;
      out.push(...(attemptsByTask.get(task.id) ?? []));
    }
    return out;
  };

  /** The entity a task (and, for models, one of its events) contributes to. */
  const entityOf = (task: TelemetryTaskRow, event: StatsEventRow | null): Entity => {
    if (opts.groupBy === "strategy")
      return { id: task.strategy ?? NO_STRATEGY, label: task.strategy ?? "(no strategy)" };
    if (opts.groupBy === "profile")
      return { id: task.profile ?? NO_PROFILE, label: task.profile ?? NO_PROFILE };
    if (opts.groupBy === "task") return { id: task.key, label: `${task.key} · ${task.title}` };
    const model = event?.model ?? NO_MODEL;
    return { id: model, label: model };
  };
  const kind: TelemetryEntityKind =
    opts.groupBy === TELEMETRY_GROUP_BY.MODEL
      ? TELEMETRY_ENTITY_KIND.MODEL
      : opts.groupBy === TELEMETRY_GROUP_BY.PROFILE
        ? TELEMETRY_ENTITY_KIND.PROFILE
        : opts.groupBy === TELEMETRY_GROUP_BY.TASK
          ? TELEMETRY_ENTITY_KIND.TASK
          : opts.groupBy === TELEMETRY_GROUP_BY.COORDINATOR
            ? TELEMETRY_ENTITY_KIND.COORDINATOR
            : TELEMETRY_ENTITY_KIND.STRATEGY;
  const spawnsIn = (id: string, taskKeys: ReadonlySet<string>): number => {
    if (opts.groupBy === TELEMETRY_GROUP_BY.STRATEGY) {
      return spawnsByStrategy.get(id === NO_STRATEGY ? null : id) ?? 0;
    }
    if (opts.groupBy === TELEMETRY_GROUP_BY.MODEL) return spawnsByModel.get(id) ?? 0;
    let total = 0;
    for (const attempt of attemptsOf(taskKeys)) total += spawnsByAttempt.get(attempt.id) ?? 0;
    return total;
  };

  const buckets = new Map<string, Bucket>();
  const bucketOf = (entity: Entity): Bucket => {
    const existing = buckets.get(entity.id);
    if (existing !== undefined) return existing;
    const created: Bucket = { ...entity, kind, taskKeys: new Set(), events: [] };
    buckets.set(entity.id, created);
    return created;
  };
  if (
    opts.groupBy !== TELEMETRY_GROUP_BY.MODEL &&
    opts.groupBy !== TELEMETRY_GROUP_BY.COORDINATOR
  ) {
    for (const task of tasks) bucketOf(entityOf(task, null)).taskKeys.add(task.key);
  }
  if (opts.groupBy === TELEMETRY_GROUP_BY.COORDINATOR) {
    for (const attempt of attempts) {
      const key = keyByTaskId.get(attempt.task_id);
      if (key !== undefined)
        bucketOf(coordinatorEntity(attempt.coordinator_model)).taskKeys.add(key);
    }
  }
  const coordination: StatsEventRow[] = [];
  const coordinatorSet = new Set(coordinatorThreads);
  for (const event of events) {
    // Across projects every coordination thread belongs to the view; one project's view takes only its own.
    if (
      event.bucket === USAGE_BUCKET.COORDINATION &&
      (project === null || (event.t3_thread_id !== null && coordinatorSet.has(event.t3_thread_id)))
    ) {
      coordination.push(event);
      continue;
    }
    const task = event.task_key === null ? undefined : taskByKey.get(event.task_key);
    if (task === undefined) continue;
    const bucket =
      opts.groupBy === TELEMETRY_GROUP_BY.COORDINATOR
        ? bucketOf(coordinatorEntity(event.attempt_coordinator_model))
        : bucketOf(entityOf(task, event));
    bucket.taskKeys.add(task.key);
    bucket.events.push(event);
  }

  const colors = colorIndexes([...buckets.keys()]);
  const rowOf = (bucket: Bucket, color: number | null): TelemetryRow => {
    const bucketTasks = [...bucket.taskKeys].flatMap((key) => {
      const task = taskByKey.get(key);
      return task === undefined ? [] : [task];
    });
    const spawns = spawnsIn(bucket.id, bucket.taskKeys);
    return {
      entity: { id: bucket.id, label: bucket.label, kind: bucket.kind, color },
      ...metrics({ tasks: bucketTasks, events: bucket.events, spawns }),
      share: { cost: null, tokens: null },
    };
  };
  const rows: TelemetryRow[] = [...buckets.values()].map((bucket) =>
    rowOf(bucket, colors.get(bucket.id) ?? null),
  );
  if (coordination.length > 0 || coordinatorSpawns > 0) {
    rows.push({
      entity: {
        id: TELEMETRY_COORDINATION_ID,
        label: TELEMETRY_COORDINATION_ID,
        kind: TELEMETRY_ENTITY_KIND.COORDINATION,
        color: null,
      },
      ...metrics({
        tasks: [],
        events: coordination,
        spawns: coordinatorSpawns,
        acceptedExtra: coordination,
      }),
      share: { cost: null, tokens: null },
    });
  }
  rows.sort(compareRows);

  const taskEvents = events.filter(
    (event) => event.task_key !== null && taskByKey.has(event.task_key),
  );
  const taskSpawns = [...spawnsByAttempt.values()].reduce((sum, n) => sum + n, 0);
  const totals = {
    ...metrics({ tasks, events: taskEvents, spawns: taskSpawns }),
    coordination: {
      cost: costQuantity(costSummary(coordination)),
      tokens: tokenQuantity(coordination),
      spawns: coordinatorSpawns,
    },
  };

  const timed = [...taskEvents, ...coordination].flatMap((event) => {
    const at = Date.parse(event.ts);
    return Number.isNaN(at) ? [] : [at];
  });
  const fallback = Number.isNaN(Date.parse(opts.at)) ? 0 : Date.parse(opts.at);
  const from = timed.length === 0 ? fallback : Math.min(...timed);
  const to = timed.length === 0 ? fallback : Math.max(...timed);
  const unpriced = taskEvents.filter((event) => event.cost_usd === null);
  const savings = cacheSavings(taskEvents, opts.prices);

  const view: TelemetryViewType = {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    groupBy: opts.groupBy,
    rows: rows.map((row) => withShare(row, totals)),
    totals,
    unpriced: { events: unpriced.length, tokens: tokenQuantity(unpriced).value },
    cache: {
      contexts: cacheContexts({ tasks, attempts, events: taskEvents, prices: opts.prices }),
      models: cacheModels(taskEvents, opts.prices),
      totals: {
        tokens: tokenQuantity(taskEvents),
        cacheRead: measured(tokenValue(taskEvents, ["cache_read_tokens"])),
        cacheShare: cacheShare(taskEvents),
        savings: savings.value,
        unpriced: savings.unpricedTokens === 0 ? null : savings.unpricedTokens,
      },
    },
    daily: dailyCosts(taskEvents, coordination),
    price_sources: priceSources([...taskEvents, ...coordination]),
  };
  return yield* decodeTelemetryView(view);
});

/**
 * Named strategies in their canonical order (the tasks without one after them), the coordinator
 * last; the other groupings by cost, dearest first, because that is the order a reader wants.
 */
function compareRows(a: TelemetryRow, b: TelemetryRow): number {
  const rank = strategyRank(a) - strategyRank(b);
  if (rank !== 0) return rank;
  const costA = a.costToAcceptance.value;
  const costB = b.costToAcceptance.value;
  if (costA !== costB) {
    if (costA === null) return 1;
    if (costB === null) return -1;
    return costB - costA;
  }
  return a.entity.label < b.entity.label ? -1 : a.entity.label > b.entity.label ? 1 : 0;
}

function withShare(row: TelemetryRow, totals: TelemetryMetrics): TelemetryRow {
  if (row.entity.kind === TELEMETRY_ENTITY_KIND.COORDINATION) return row;
  return {
    ...row,
    share: {
      cost: share(row.costToAcceptance, totals.costToAcceptance),
      tokens: share(row.tokens, totals.tokens),
    },
  };
}

function strategyRank(row: TelemetryRow): number {
  if (row.entity.kind === TELEMETRY_ENTITY_KIND.COORDINATION) return STRATEGIES.length + 1;
  if (row.entity.kind !== TELEMETRY_ENTITY_KIND.STRATEGY) return 0;
  const index = STRATEGIES.findIndex((strategy) => strategy === row.entity.id);
  return index === -1 ? STRATEGIES.length : index;
}
