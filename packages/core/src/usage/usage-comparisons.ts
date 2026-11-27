import * as Effect from "effect/Effect";
import {
  CONTEXT_GROUP,
  CONTEXT_MODES,
  COORDINATOR_GROUP,
  NfError,
  STRATEGIES,
  STRATEGY_GROUP,
} from "@nf/contracts";
import type {
  ContextMode,
  ContextStats,
  ContextStatsRow,
  CoordinatorStats,
  CoordinatorStatsRow,
  CostSummary,
  Strategy,
  StrategyStats,
  StrategyStatsRow,
} from "@nf/contracts";
import {
  selectCoordinationModelCosts,
  selectCoordinatorRepairs,
  selectCoordinatorTasks,
  selectCoordinatorThreads,
  selectCoordinatorWorkerCosts,
} from "../persistence/coordinators.persistence.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import {
  selectCoordinatorSpawnCount,
  selectSpawnCountsByContext,
  selectSpawnCountsByStrategy,
} from "../persistence/subagent.persistence.ts";
import {
  selectCoordinationCosts,
  selectContextCosts,
  selectContextTasks,
  selectStrategyCosts,
  selectStrategyTasks,
} from "../persistence/usage-queries.persistence.ts";
import type { StrategyScope } from "../persistence/usage-queries.persistence.ts";
import { costSummary, priceSources } from "./usage-stats.ts";
import type { CostedEvent, PricedEvent } from "./usage-stats.ts";

export interface StrategyStatsOptions {
  projectId?: string | null | undefined;
  allProjects?: boolean | undefined;
}

/** Named strategies first, then the tasks without one, then the coordinator. */
function strategyRank(row: StrategyStatsRow): number {
  if (row.coordination === true) return STRATEGIES.length + 1;
  return row.strategy === null ? STRATEGIES.length : STRATEGIES.indexOf(row.strategy);
}

/**
 * The coordinator threads' own usage as its own row: no tasks and no verdict, so it never reaches
 * a first-pass rate. A project without a coordinator thread, or one that never reported usage and
 * spawned nothing, has nothing to show and gets no row.
 */
const coordinationRow = Effect.fnUntraced(function* (coordinatorThreads: readonly string[]) {
  if (coordinatorThreads.length === 0) return null;
  const costs = yield* selectCoordinationCosts(coordinatorThreads);
  const spawns = yield* selectCoordinatorSpawnCount(coordinatorThreads);
  if (costs.length === 0 && spawns === 0) return null;
  const row = {
    strategy: null,
    coordination: true,
    tasks: 0,
    n: 0,
    first_pass: 0,
    first_pass_rate: null,
    cost_to_acceptance: costSummary(costs),
    spawns,
  } satisfies StrategyStatsRow;
  return { row, costs };
});

/**
 * Compare strategies: tasks each ran, what reaching acceptance cost and how often the first
 * attempt was accepted. Only `done` tasks contribute cost and a verdict; tasks without a strategy
 * form their own group. The coordinator's usage is a `coordination` row, never a first-pass rate.
 */
export const strategyStats = Effect.fn("UsageStats.strategyStats")(function* (
  opts: StrategyStatsOptions,
) {
  const store = yield* TaskStore;
  const allProjects = opts.allProjects === true;
  let scope: StrategyScope;
  let project: { id: string; name: string } | null = null;
  let coordinatorThreads: readonly string[] = [];
  if (allProjects) {
    scope = { kind: "all" };
  } else {
    if (!opts.projectId) {
      return yield* new NfError({
        code: "no_project",
        message: "stats need a project or --all-projects",
      });
    }
    const p = yield* store.getProject(opts.projectId);
    scope = { kind: "project", projectId: p.id };
    project = { id: p.id, name: p.name };
    coordinatorThreads = yield* selectCoordinatorThreads(p.id);
  }
  const costs = new Map<Strategy | null, PricedEvent[]>();
  for (const row of yield* selectStrategyCosts(scope)) {
    const list = costs.get(row.strategy) ?? [];
    list.push(row);
    costs.set(row.strategy, list);
  }
  const priced = [...costs.values()].flat();
  const spawns = yield* selectSpawnCountsByStrategy(scope);
  const rows: StrategyStatsRow[] = (yield* selectStrategyTasks(scope)).map((row) => ({
    strategy: row.strategy,
    tasks: row.tasks,
    n: row.n,
    first_pass: row.first_pass,
    first_pass_rate: row.n === 0 ? null : row.first_pass / row.n,
    cost_to_acceptance: costSummary(costs.get(row.strategy) ?? []),
    spawns: spawns.get(row.strategy) ?? 0,
  }));
  const coordination = yield* coordinationRow(coordinatorThreads);
  if (coordination !== null) rows.push(coordination.row);
  rows.sort((a, b) => strategyRank(a) - strategyRank(b));
  const stats: StrategyStats = {
    by: STRATEGY_GROUP,
    all_projects: allProjects,
    project,
    rows,
    price_sources: priceSources([...priced, ...(coordination?.costs ?? [])]),
  };
  return stats;
});

/**
 * Compare context transfers the same way strategies are compared: how many tasks used each one,
 * what their attempts cost on tasks that reached acceptance, and how often those tasks were
 * accepted first-pass. A task that changed context appears in every context it used, so the
 * first-pass counts are per context and the costs still add up to the acceptance cost.
 */
export const contextStats = Effect.fn("UsageStats.contextStats")(function* (
  opts: StrategyStatsOptions,
) {
  const store = yield* TaskStore;
  const allProjects = opts.allProjects === true;
  let scope: StrategyScope;
  let project: { id: string; name: string } | null = null;
  if (allProjects) {
    scope = { kind: "all" };
  } else {
    if (!opts.projectId) {
      return yield* new NfError({
        code: "no_project",
        message: "stats need a project or --all-projects",
      });
    }
    const p = yield* store.getProject(opts.projectId);
    scope = { kind: "project", projectId: p.id };
    project = { id: p.id, name: p.name };
  }
  const costs = new Map<ContextMode, PricedEvent[]>();
  for (const row of yield* selectContextCosts(scope)) {
    const list = costs.get(row.context) ?? [];
    list.push(row);
    costs.set(row.context, list);
  }
  const spawns = yield* selectSpawnCountsByContext(scope);
  const rows: ContextStatsRow[] = (yield* selectContextTasks(scope)).map((row) => ({
    context: row.context,
    tasks: row.tasks,
    n: row.n,
    first_pass: row.first_pass,
    first_pass_rate: row.n === 0 ? null : row.first_pass / row.n,
    cost_to_acceptance: costSummary(costs.get(row.context) ?? []),
    spawns: spawns.get(row.context) ?? 0,
  }));
  rows.sort((a, b) => CONTEXT_MODES.indexOf(a.context) - CONTEXT_MODES.indexOf(b.context));
  const stats: ContextStats = {
    by: CONTEXT_GROUP,
    all_projects: allProjects,
    project,
    rows,
    price_sources: priceSources([...costs.values()].flat()),
  };
  return stats;
});

export interface CoordinatorStatsOptions {
  projectId?: string | null | undefined;
  allProjects?: boolean | undefined;
  profileBreakdown?: boolean | undefined;
}

interface CoordinatorNumbers {
  tasks: number;
  accepted: number;
  n: number;
  first_pass: number;
  repairs: number;
  human_interventions: number;
}

const emptyNumbers = (): CoordinatorNumbers => ({
  tasks: 0,
  accepted: 0,
  n: 0,
  first_pass: 0,
  repairs: 0,
  human_interventions: 0,
});

interface CoordinatorProfileGroup {
  coordinator: string | null;
  profile: string | null;
  numbers: CoordinatorNumbers;
  worker: PricedEvent[];
}

interface CoordinatorGroup {
  coordinator: string | null;
  coordination: PricedEvent[];
  profiles: CoordinatorProfileGroup[];
}

const groupKey = (coordinator: string | null, profile: string | null) =>
  `${coordinator ?? "\u0000"}\u0001${profile ?? "\u0000"}`;

/** Every costed turn behind a coordinator's rows, for the view's price-source note. */
const costedTurns = (group: CoordinatorGroup): PricedEvent[] => [
  ...group.coordination,
  ...group.profiles.flatMap((profile) => profile.worker),
];

/** Unknown coordinators and profiles sort last; the rest alphabetically. */
const compareNullable = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);

function sumNumbers(groups: readonly CoordinatorProfileGroup[]): CoordinatorNumbers {
  const total = emptyNumbers();
  for (const group of groups) {
    total.tasks += group.numbers.tasks;
    total.accepted += group.numbers.accepted;
    total.n += group.numbers.n;
    total.first_pass += group.numbers.first_pass;
    total.repairs += group.numbers.repairs;
    total.human_interventions += group.numbers.human_interventions;
  }
  return total;
}

/** Known coordination plus worker cost per accepted task; unknown parts are skipped. */
function costPerAccepted(
  coordination: CostSummary,
  worker: CostSummary,
  accepted: number,
): number | null {
  if (accepted === 0) return null;
  const known = [coordination.value, worker.value].filter(
    (value): value is number => value !== null,
  );
  if (known.length === 0) return null;
  return Number((known.reduce((sum, value) => sum + value, 0) / accepted).toFixed(12));
}

function coordinatorRow(
  coordinator: string | null,
  profile: string | null | undefined,
  numbers: CoordinatorNumbers,
  coordination: readonly CostedEvent[],
  worker: readonly CostedEvent[],
): CoordinatorStatsRow {
  const coordinationCost = costSummary(coordination);
  const workerCost = costSummary(worker);
  return {
    coordinator,
    ...(profile === undefined ? {} : { profile }),
    tasks: numbers.tasks,
    accepted: numbers.accepted,
    n: numbers.n,
    first_pass: numbers.first_pass,
    first_pass_rate: numbers.n === 0 ? null : numbers.first_pass / numbers.n,
    repairs: numbers.repairs,
    human_interventions: numbers.human_interventions,
    coordination_cost: coordinationCost,
    worker_cost: workerCost,
    cost_per_accepted_task: costPerAccepted(coordinationCost, workerCost, numbers.accepted),
  };
}

/**
 * Compare coordinating models: the tasks each dispatched, how effective they were (accepted,
 * first-pass rate, repairs, human interventions) and what reaching acceptance cost — the
 * coordinator's own turns priced by the model that ran each one, plus the workers' attempts.
 * A task counts under every coordinator that started one of its attempts.
 */
export const coordinatorStats = Effect.fn("UsageStats.coordinatorStats")(function* (
  opts: CoordinatorStatsOptions,
) {
  const store = yield* TaskStore;
  const allProjects = opts.allProjects === true;
  const breakdown = opts.profileBreakdown === true;
  let scope: StrategyScope;
  let project: { id: string; name: string } | null = null;
  let coordinatorThreads: readonly string[] = [];
  if (allProjects) {
    scope = { kind: "all" };
  } else {
    if (!opts.projectId) {
      return yield* new NfError({
        code: "no_project",
        message: "stats need a project or --all-projects",
      });
    }
    const p = yield* store.getProject(opts.projectId);
    scope = { kind: "project", projectId: p.id };
    project = { id: p.id, name: p.name };
    coordinatorThreads = yield* selectCoordinatorThreads(p.id);
  }
  const groups = new Map<string, CoordinatorGroup>();
  const profiles = new Map<string, CoordinatorProfileGroup>();
  const groupOf = (coordinator: string | null): CoordinatorGroup => {
    const key = coordinator ?? "\u0000";
    const existing = groups.get(key);
    if (existing !== undefined) return existing;
    const created: CoordinatorGroup = { coordinator, coordination: [], profiles: [] };
    groups.set(key, created);
    return created;
  };
  const profileGroupOf = (
    coordinator: string | null,
    profile: string | null,
  ): CoordinatorProfileGroup => {
    const existing = profiles.get(groupKey(coordinator, profile));
    if (existing !== undefined) return existing;
    const created: CoordinatorProfileGroup = {
      coordinator,
      profile,
      numbers: emptyNumbers(),
      worker: [],
    };
    profiles.set(groupKey(coordinator, profile), created);
    groupOf(coordinator).profiles.push(created);
    return created;
  };

  for (const row of yield* selectCoordinatorTasks(scope)) {
    const group = profileGroupOf(row.coordinator, row.profile);
    group.numbers.tasks += row.tasks;
    group.numbers.accepted += row.accepted;
    group.numbers.n += row.n;
    group.numbers.first_pass += row.first_pass;
    group.numbers.human_interventions += row.human_interventions;
  }
  for (const row of yield* selectCoordinatorRepairs(scope)) {
    profileGroupOf(row.coordinator, row.profile).numbers.repairs += row.repairs;
  }
  for (const row of yield* selectCoordinatorWorkerCosts(scope)) {
    profileGroupOf(row.coordinator, row.profile).worker.push(row);
  }
  for (const row of yield* selectCoordinationModelCosts(
    allProjects ? { kind: "all" } : { kind: "project", threads: coordinatorThreads },
  )) {
    groupOf(row.model).coordination.push(row);
  }

  const rows: CoordinatorStatsRow[] = [];
  const ordered = [...groups.values()].toSorted((a, b) =>
    compareNullable(a.coordinator, b.coordinator),
  );
  for (const group of ordered) {
    const profilesOf = group.profiles.toSorted((a, b) => compareNullable(a.profile, b.profile));
    rows.push(
      coordinatorRow(
        group.coordinator,
        undefined,
        sumNumbers(profilesOf),
        group.coordination,
        profilesOf.flatMap((profile) => profile.worker),
      ),
    );
    if (breakdown) {
      for (const profile of profilesOf) {
        rows.push(
          coordinatorRow(group.coordinator, profile.profile, profile.numbers, [], profile.worker),
        );
      }
    }
  }
  const stats: CoordinatorStats = {
    by: COORDINATOR_GROUP,
    all_projects: allProjects,
    project,
    profile_breakdown: breakdown,
    rows,
    price_sources: priceSources(ordered.flatMap(costedTurns)),
  };
  return stats;
});
