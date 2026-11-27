import { CONTEXT_MODE, TASK_STATUS } from "@nf/contracts";
import type {
  ContextMode,
  TelemetryCacheContext,
  TelemetryCacheModel,
  TelemetryDay,
} from "@nf/contracts";
import type { PriceFile } from "../domain/prices.ts";
import type { StatsEventRow, TelemetryTaskRow } from "../persistence/usage-queries.persistence.ts";
import type { ScopeAttemptRow } from "../persistence/usage-queries.persistence.ts";
import { NO_MODEL } from "./telemetry-labels.ts";
import {
  cacheSavings,
  cacheShare,
  costQuantity,
  measured,
  medianQuantity,
  perAccepted,
  tokenQuantity,
  tokenValue,
} from "./telemetry-metrics.ts";
import { costSummary } from "./usage-stats.ts";

/** Cache rows read new work first, then the two ways of continuing a thread, then compaction. */
const CACHE_CONTEXTS: readonly ContextMode[] = [
  CONTEXT_MODE.FRESH,
  CONTEXT_MODE.REUSE,
  CONTEXT_MODE.FORK,
  CONTEXT_MODE.COMPACT,
];

/**
 * Cache reuse per attempt context transfer. A task can sit in several rows, as in
 * `nf stats --by context`: what the task cost is reported under each context its attempts used.
 */
function cacheContexts(input: {
  readonly tasks: readonly TelemetryTaskRow[];
  readonly attempts: readonly ScopeAttemptRow[];
  readonly events: readonly StatsEventRow[];
  readonly prices: PriceFile | undefined;
}): TelemetryCacheContext[] {
  const done = new Set(
    input.tasks.filter((task) => task.status === TASK_STATUS.DONE).map((task) => task.key),
  );
  const keyByTaskId = new Map(input.tasks.map((task) => [task.id, task.key]));
  const rows: TelemetryCacheContext[] = [];
  for (const mode of CACHE_CONTEXTS) {
    const attempts = input.attempts.filter((attempt) => attempt.context_mode === mode);
    const events = input.events.filter(
      (event) => event.context_mode === mode && event.task_key !== null,
    );
    if (attempts.length === 0 && events.length === 0) continue;
    const taskKeys = new Set<string>();
    for (const attempt of attempts) {
      const key = keyByTaskId.get(attempt.task_id);
      if (key !== undefined) taskKeys.add(key);
    }
    const modeTasks = input.tasks.filter((task) => taskKeys.has(task.key));
    const accepted = events.filter((event) => event.task_key !== null && done.has(event.task_key));
    const base = accepted.filter((event) => event.attempt_repair_of === null);
    const repair = accepted.filter((event) => event.attempt_repair_of !== null);
    const verdicts = modeTasks.filter((task) => task.accepted_first_pass !== null);
    const perTask = new Map<string, number>();
    for (const event of accepted) {
      if (event.cost_usd === null || event.task_key === null) continue;
      perTask.set(event.task_key, (perTask.get(event.task_key) ?? 0) + event.cost_usd);
    }
    const costToAcceptance = {
      ...costQuantity(costSummary(accepted)),
      base: costQuantity(costSummary(base)),
      repair: costQuantity(costSummary(repair)),
      median: medianQuantity([...perTask.values()]),
    };
    const repairAttempts = attempts.filter((attempt) => attempt.repair_of !== null).length;
    rows.push({
      mode,
      tasks: modeTasks.length,
      n: verdicts.length,
      firstPass: {
        accepted: verdicts.filter((task) => task.accepted_first_pass === 1).length,
        total: verdicts.length,
      },
      costToAcceptance,
      costPerAcceptedTask: perAccepted(
        costToAcceptance,
        modeTasks.filter((task) => task.status === TASK_STATUS.DONE).length,
      ),
      tokens: tokenQuantity(events),
      cacheRead: measured(tokenValue(events, ["cache_read_tokens"])),
      cacheShare: cacheShare(events),
      attempts: { newWork: attempts.length - repairAttempts, repair: repairAttempts },
    });
  }
  return rows;
}

/** One row per model, dearest cached input first; models without a cache read stay at the end. */
function cacheModels(
  events: readonly StatsEventRow[],
  prices: PriceFile | undefined,
): TelemetryCacheModel[] {
  const byModel = new Map<string, StatsEventRow[]>();
  for (const event of events) {
    const id = event.model ?? NO_MODEL;
    const rows = byModel.get(id) ?? [];
    rows.push(event);
    byModel.set(id, rows);
  }
  const models: TelemetryCacheModel[] = [...byModel].map(([id, rows]) => ({
    id,
    tokens: tokenQuantity(rows),
    cacheRead: measured(tokenValue(rows, ["cache_read_tokens"])),
    cacheShare: cacheShare(rows),
    unpriced: cacheSavings(rows, prices).unpricedEvents,
  }));
  return models.toSorted((a, b) => {
    const cached = (b.cacheRead.value ?? -1) - (a.cacheRead.value ?? -1);
    return cached !== 0 ? cached : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Cost per UTC day, the tasks' work and the coordinator threads' own turns apart. */
function dailyCosts(
  taskEvents: readonly StatsEventRow[],
  coordination: readonly StatsEventRow[],
): TelemetryDay[] {
  const days = new Map<string, { workers: StatsEventRow[]; coordination: StatsEventRow[] }>();
  const dayOf = (day: string) => {
    const existing = days.get(day);
    if (existing !== undefined) return existing;
    const created = { workers: [], coordination: [] };
    days.set(day, created);
    return created;
  };
  for (const event of taskEvents) dayOf(event.ts.slice(0, 10)).workers.push(event);
  for (const event of coordination) dayOf(event.ts.slice(0, 10)).coordination.push(event);
  return [...days]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, events]) => ({
      date,
      workers: costQuantity(costSummary(events.workers)),
      coordination: costQuantity(costSummary(events.coordination)),
    }));
}

export { cacheContexts, cacheModels, dailyCosts };
