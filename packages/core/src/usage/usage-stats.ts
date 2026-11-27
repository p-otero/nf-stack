import * as Effect from "effect/Effect";
import { COST_QUALITY, NfError, TASK_STATUS, USAGE_BUCKET, USAGE_GROUPS } from "@nf/contracts";
import type {
  Attempt,
  AttemptSubagents,
  AttemptUsage,
  CostQuality,
  CostSummary,
  SubagentUsageGroup,
  TaskUsage,
  TokenFields,
  UsageGroup,
  UsageRow,
  UsageStats,
  UsageTotals,
} from "@nf/contracts";
import { isAggregateSourceKey } from "../domain/usage.ts";
import { selectCoordinatorThreads } from "../persistence/coordinators.persistence.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import {
  selectChildSpawns,
  selectSpawnCountsByAttempt,
  selectSpawnCountsByModel,
  selectSpawnGroups,
} from "../persistence/subagent.persistence.ts";
import type {
  ChildSpawnRow,
  SpawnGroupRow,
  SpawnScope,
} from "../persistence/subagent.persistence.ts";
import { selectStatsEvents } from "../persistence/usage-queries.persistence.ts";
import type { StatsEventRow } from "../persistence/usage-queries.persistence.ts";

/** Anything the cost summary needs: a stored event or one column of one. */
export type CostedEvent = { readonly cost_usd: number | null; readonly cost_quality: CostQuality };

/** A costed row that also remembers which price layer estimated it. */
export type PricedEvent = CostedEvent & { readonly price_source: string | null };

/** Priced total with its quality rules, shared with every view that reports cost. */
export function costSummary(rows: readonly CostedEvent[]): CostSummary {
  let value = 0;
  let priced = false;
  let reported = 0;
  let estimated = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.cost_usd !== null) {
      value += row.cost_usd;
      priced = true;
    }
    if (row.cost_quality === COST_QUALITY.REPORTED && row.cost_usd !== null) reported++;
    else if (row.cost_quality === COST_QUALITY.ESTIMATED && row.cost_usd !== null) estimated++;
    else unknown++;
  }
  const quality: CostQuality = !priced
    ? COST_QUALITY.UNKNOWN
    : estimated > 0 || unknown > 0
      ? COST_QUALITY.ESTIMATED
      : COST_QUALITY.REPORTED;
  return {
    value: priced ? Number(value.toFixed(12)) : null,
    quality,
    reported_events: reported,
    estimated_events: estimated,
    unknown_events: unknown,
  };
}

/** Sum of a token column; null when no row knows it (unknown is never 0). */
export function tokenSum(rows: readonly StatsEventRow[], key: keyof TokenFields): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const value = row[key];
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

/** The layers behind the priced events of a view, as `nf stats` notes them. */
export function priceSources(rows: readonly PricedEvent[]): string[] {
  const sources = new Set<string>();
  for (const row of rows)
    if (row.cost_usd !== null && row.price_source !== null) sources.add(row.price_source);
  return [...sources].toSorted();
}

function totals(rows: readonly StatsEventRow[]): UsageTotals {
  const aggregates = rows.filter((row) => isAggregateSourceKey(row.source_key));
  const normal = rows.filter((row) => !isAggregateSourceKey(row.source_key));
  return {
    events: rows.length,
    subagent_events: rows.filter((r) => r.is_subagent === 1).length,
    aggregate: {
      events: aggregates.length,
      input_tokens: tokenSum(aggregates, "input_tokens"),
      output_tokens: tokenSum(aggregates, "output_tokens"),
    },
    input_tokens: tokenSum(normal, "input_tokens"),
    output_tokens: tokenSum(normal, "output_tokens"),
    cache_read_tokens: tokenSum(normal, "cache_read_tokens"),
    cache_write_tokens: tokenSum(normal, "cache_write_tokens"),
    reasoning_tokens: tokenSum(normal, "reasoning_tokens"),
    cost: costSummary(rows),
  };
}

function groupKey(row: StatsEventRow, by: UsageGroup): string {
  if (by === "task") return row.task_key ?? row.bucket;
  if (by === "attempt") return row.attempt_key ?? row.bucket;
  if (by === "model") return row.model ?? "(unknown)";
  if (by === "profile")
    return (
      row.profile ??
      (row.attempt_id !== null || row.parent_attempt_id !== null ? "(no profile)" : row.bucket)
    );
  return row.ts.slice(0, 7);
}

function rowPriority(key: string): number {
  if (key === USAGE_BUCKET.COORDINATION) return 1;
  if (key === USAGE_BUCKET.UNATTRIBUTED) return 2;
  return 0;
}

export interface StatsOptions {
  by: string;
  projectId?: string | null | undefined;
  allProjects?: boolean | undefined;
}

/** Aggregate stored usage by task, attempt, model, profile or month. */
export const usageStats = Effect.fn("UsageStats.usageStats")(function* (opts: StatsOptions) {
  const store = yield* TaskStore;
  const by = USAGE_GROUPS.find((group) => group === opts.by);
  if (by === undefined) {
    return yield* new NfError({
      code: "invalid_value",
      message: `invalid group '${opts.by}' (one of ${USAGE_GROUPS.join("|")})`,
    });
  }
  const allProjects = opts.allProjects === true;
  let rows: StatsEventRow[];
  let project: { id: string; name: string } | null = null;
  let coordinatorThreads: readonly string[] = [];
  if (allProjects) {
    rows = yield* selectStatsEvents({ kind: "all" });
  } else {
    if (!opts.projectId) {
      return yield* new NfError({
        code: "no_project",
        message: "stats need a project or --all-projects",
      });
    }
    const p = yield* store.getProject(opts.projectId);
    coordinatorThreads = yield* selectCoordinatorThreads(p.id);
    rows = yield* selectStatsEvents({
      kind: "project",
      projectId: p.id,
      coordinatorThreads,
    });
    project = { id: p.id, name: p.name };
  }
  const groups = new Map<string, StatsEventRow[]>();
  for (const row of rows) {
    const key = groupKey(row, by);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const spawnScope: SpawnScope = project
    ? { kind: "project", projectId: project.id, coordinatorThreads }
    : { kind: "all" };
  const spawnsByModel =
    by === "model" ? yield* selectSpawnCountsByModel(spawnScope) : new Map<string, number>();
  const spawnsByAttempt =
    by === "model" ? new Map<string, number>() : yield* selectSpawnCountsByAttempt(spawnScope);
  if (by === "model") {
    // A model used only for provider-native subagents has no priced events of its own.
    for (const model of spawnsByModel.keys()) if (!groups.has(model)) groups.set(model, []);
  }
  const spawnsOf = (key: string, list: readonly StatsEventRow[]): number => {
    if (by === "model") return spawnsByModel.get(key) ?? 0;
    const attempts = new Set<string>();
    for (const row of list) {
      const attempt = row.attempt_id ?? row.parent_attempt_id;
      if (attempt !== null) attempts.add(attempt);
    }
    let total = 0;
    for (const attempt of attempts) total += spawnsByAttempt.get(attempt) ?? 0;
    return total;
  };
  const usageRow = (key: string, list: readonly StatsEventRow[]): UsageRow => ({
    key,
    spawns: spawnsOf(key, list),
    ...totals(list),
  });
  const out: UsageRow[] = [...groups.entries()]
    .map(([key, list]) => usageRow(key, list))
    .toSorted((a, b) =>
      rowPriority(a.key) === rowPriority(b.key)
        ? a.key.localeCompare(b.key)
        : rowPriority(a.key) - rowPriority(b.key),
    );
  const stats: UsageStats = {
    by,
    all_projects: allProjects,
    project,
    rows: out,
    totals: totals(rows),
    price_sources: priceSources(rows),
    spawns:
      [...spawnsByModel.values()].reduce((sum, n) => sum + n, 0) +
      [...spawnsByAttempt.values()].reduce((sum, n) => sum + n, 0),
  };
  return stats;
});

/** Spawns of one attempt, with the usage of the app-owned child threads they started. */
function subagentUsage(
  attemptId: string,
  spawns: readonly SpawnGroupRow[],
  children: readonly ChildSpawnRow[],
  childRows: readonly StatsEventRow[],
): AttemptSubagents {
  const childByThread = new Map(children.map((child) => [child.child_t3_thread_id, child]));
  const groups: SubagentUsageGroup[] = spawns
    .filter((spawn) => spawn.attempt_id === attemptId)
    .map((spawn) => ({
      kind: spawn.kind,
      model: spawn.model,
      count: spawn.count,
      usage: totals(
        childRows.filter((row) => {
          const child = row.t3_thread_id === null ? undefined : childByThread.get(row.t3_thread_id);
          return (
            child?.attempt_id === attemptId &&
            child.kind === spawn.kind &&
            child.model === spawn.model
          );
        }),
      ),
    }));
  return { count: groups.reduce((sum, group) => sum + group.count, 0), groups };
}

/** Per-attempt usage of one task, with the cost of every attempt that led to acceptance. */
export const taskUsage = Effect.fn("UsageStats.taskUsage")(function* (
  projectId: string,
  taskRef: string,
) {
  const store = yield* TaskStore;
  const task = yield* store.getTask(projectId, taskRef);
  const attempts = yield* store.listAttempts(projectId, task.key);
  const rows = yield* selectStatsEvents({
    kind: "attempts",
    attemptIds: attempts.map((a) => a.id),
  });
  const spawns = yield* selectSpawnGroups(attempts.map((a) => a.id));
  const children = yield* selectChildSpawns(attempts.map((a) => a.id));
  const attemptUsage = (attempt: Attempt): AttemptUsage => {
    const own = rows.filter((row) => row.attempt_id === attempt.id);
    const childRows = rows.filter((row) => row.parent_attempt_id === attempt.id);
    return {
      key: attempt.key,
      kind: attempt.kind,
      status: attempt.status,
      started_at: attempt.started_at,
      ended_at: attempt.ended_at,
      ...totals(own),
      subagents: subagentUsage(attempt.id, spawns, children, childRows),
    };
  };
  const attemptRows: AttemptUsage[] = attempts.map(attemptUsage);
  const sum = totals(rows);
  const usage: TaskUsage = {
    task: { key: task.key, title: task.title, status: task.status },
    done: task.status === TASK_STATUS.DONE,
    attempts: attemptRows,
    totals: sum,
    cost_to_acceptance: sum.cost,
    price_sources: priceSources(rows),
  };
  return usage;
});
