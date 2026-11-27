import * as Effect from "effect/Effect";
import {
  CONTEXT_GROUP,
  COORDINATOR_GROUP,
  STATS_GROUPS,
  STRATEGY_GROUP,
  USAGE_GROUPS,
  contextStats,
  coordinatorStats,
  strategyStats,
  taskUsage,
  usageStats,
} from "@nf/core";
import type {
  AttemptUsage,
  ContextStats,
  CoordinatorStats,
  CoordinatorStatsRow,
  CostSummary,
  StrategyStats,
  TaskUsage,
  UsageRow,
  UsageStats,
  UsageTotals,
} from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";

const UNKNOWN = "—";

const usageError = (message: string) => new UsageError({ message });

function compact(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function tokens(value: number | null): string {
  if (value === null) return UNKNOWN;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${compact(value / 1_000)}k`;
  if (value < 1_000_000_000) return `${compact(value / 1_000_000)}M`;
  return `${compact(value / 1_000_000_000)}B`;
}

function cost(value: CostSummary): string {
  if (value.value === null) return UNKNOWN;
  return `${value.quality === "estimated" ? "~" : ""}$${value.value.toFixed(6)}`;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

function metricCells(t: UsageTotals): string[] {
  return [
    String(t.events),
    tokens(t.input_tokens),
    tokens(t.output_tokens),
    tokens(t.cache_read_tokens),
    tokens(t.cache_write_tokens),
    tokens(t.reasoning_tokens),
    cost(t.cost),
    String(t.aggregate.events),
    tokens(t.aggregate.input_tokens),
    tokens(t.aggregate.output_tokens),
  ];
}

const METRICS = [
  "EVENTS",
  "IN",
  "OUT",
  "READ",
  "WRITE",
  "REASONING",
  "COST",
  "AGG-EV",
  "AGG-IN",
  "AGG-OUT",
];

function aggregateNote(t: UsageTotals): string {
  return (
    `AGG-* are unpriced T3 subagent aggregates (${t.aggregate.events} events, ` +
    `${tokens(t.aggregate.input_tokens)} input, ${tokens(t.aggregate.output_tokens)} output)`
  );
}

function listText(data: UsageStats): string {
  const scope = data.all_projects
    ? "all projects"
    : data.project
      ? `project ${data.project.name}`
      : "";
  const out = [scope, ""];
  if (data.rows.length === 0) {
    out.push("no usage recorded; run 'nf sync'");
  } else {
    const showSpawns = data.by === "model";
    const headers = [data.by.toUpperCase(), ...(showSpawns ? ["SPAWNS"] : []), ...METRICS];
    const cells = (row: UsageRow) => [
      row.key,
      ...(showSpawns ? [String(row.spawns)] : []),
      ...metricCells(row),
    ];
    out.push(table(headers, data.rows.map(cells)));
    out.push("");
    out.push(
      table(
        ["TOTAL", ...(showSpawns ? ["SPAWNS"] : []), ...METRICS],
        [["", ...(showSpawns ? [String(data.spawns)] : []), ...metricCells(data.totals)]],
      ),
    );
    if (data.totals.aggregate.events > 0) out.push(aggregateNote(data.totals));
    if (data.totals.cost.unknown_events > 0) {
      const aggregates =
        data.totals.aggregate.events > 0
          ? ` including ${data.totals.aggregate.events} subagent aggregates`
          : "";
      out.push(
        `${data.totals.cost.unknown_events} events have no known price${aggregates} ` +
          `(see price file)`,
      );
    }
    const sources = priceSourcesNote(data.price_sources);
    if (sources !== null) out.push(sources);
  }
  return out.join("\n");
}

function percent(rate: number | null): string {
  return rate === null ? UNKNOWN : `${(rate * 100).toFixed(0)}%`;
}

function money(value: number | null): string {
  return value === null ? UNKNOWN : `$${value.toFixed(6)}`;
}

/** Which price layers the costs in this view were estimated from. */
function priceSourcesNote(sources: readonly string[]): string | null {
  return sources.length === 0 ? null : `prices: ${sources.join(", ")}`;
}

interface GroupRow {
  label: string;
  tasks: number;
  spawns: number;
  n: number;
  first_pass_rate: number | null;
  cost_to_acceptance: CostSummary;
}

/** Task-level groupings (`strategy`, `context`) share one layout: tasks, sample and cost. */
function groupsText(scope: string, header: string, rows: GroupRow[], notes: string[]): string {
  const out = [scope, ""];
  if (rows.length === 0) {
    out.push("no tasks");
    return out.join("\n");
  }
  out.push(
    table(
      [header, "TASKS", "SPAWNS", "N", "FIRST-PASS", "COST"],
      rows.map((r) => [
        r.label,
        String(r.tasks),
        String(r.spawns),
        String(r.n),
        percent(r.first_pass_rate),
        cost(r.cost_to_acceptance),
      ]),
    ),
  );
  if (notes.length > 0) out.push("", ...notes);
  return out.join("\n");
}

const SMALL_SAMPLE = "n < 10: indicative";

/** Small samples make a first-pass rate noise: mark them as indicative, not comparable. */
function strategyText(data: StrategyStats): string {
  const scope = data.all_projects
    ? "all projects"
    : data.project
      ? `project ${data.project.name}`
      : "";
  const notes = [];
  if (data.rows.some((r) => r.n < 10)) notes.push(SMALL_SAMPLE);
  if (data.rows.some((r) => r.coordination === true))
    notes.push("coordination: the coordinator thread's own usage, not a task");
  const sources = priceSourcesNote(data.price_sources);
  if (sources !== null) notes.push(sources);
  return groupsText(
    scope,
    "STRATEGY",
    data.rows.map((r) => ({
      label: r.coordination === true ? "coordination" : (r.strategy ?? UNKNOWN),
      tasks: r.tasks,
      spawns: r.spawns,
      n: r.n,
      first_pass_rate: r.first_pass_rate,
      cost_to_acceptance: r.cost_to_acceptance,
    })),
    notes,
  );
}

function contextText(data: ContextStats): string {
  const scope = data.all_projects
    ? "all projects"
    : data.project
      ? `project ${data.project.name}`
      : "";
  const notes = [];
  if (data.rows.some((r) => r.n < 10)) notes.push(SMALL_SAMPLE);
  if (data.rows.some((r) => r.tasks > 0))
    notes.push("a task that changed context counts in each one");
  const sources = priceSourcesNote(data.price_sources);
  if (sources !== null) notes.push(sources);
  return groupsText(
    scope,
    "CONTEXT",
    data.rows.map((r) => ({
      label: r.context,
      tasks: r.tasks,
      spawns: r.spawns,
      n: r.n,
      first_pass_rate: r.first_pass_rate,
      cost_to_acceptance: r.cost_to_acceptance,
    })),
    notes,
  );
}

const COORDINATOR_NOTE =
  "coordination: the coordinator threads' own turns, priced by the model that ran each one";
const PER_ACCEPTED_NOTE =
  "total/accepted: known coordination plus worker cost of the accepted tasks, divided by them";
const PROFILE_NOTE =
  "profile rows carry no coordination cost: a coordinator thread's turns belong to the coordinator";

function coordinatorText(data: CoordinatorStats): string {
  const scope = data.all_projects
    ? "all projects"
    : data.project
      ? `project ${data.project.name}`
      : "";
  const out = [scope, ""];
  if (data.rows.length === 0) {
    out.push("no usage recorded; run 'nf sync'");
    return out.join("\n");
  }
  const headers = [
    "COORDINATOR",
    ...(data.profile_breakdown ? ["PROFILE"] : []),
    "TASKS",
    "ACCEPTED",
    "N",
    "FIRST-PASS",
    "REPAIRS",
    "INTERV",
    "COORD",
    "WORKER",
    "TOTAL/ACCEPTED",
  ];
  const cells = (row: CoordinatorStatsRow): string[] => [
    row.coordinator ?? UNKNOWN,
    ...(data.profile_breakdown
      ? [row.profile === undefined ? UNKNOWN : (row.profile ?? "(no profile)")]
      : []),
    String(row.tasks),
    String(row.accepted),
    String(row.n),
    percent(row.first_pass_rate),
    String(row.repairs),
    String(row.human_interventions),
    cost(row.coordination_cost),
    cost(row.worker_cost),
    money(row.cost_per_accepted_task),
  ];
  out.push(table(headers, data.rows.map(cells)));
  const notes: string[] = [];
  if (data.rows.some((row) => row.profile === undefined && row.n < 10)) notes.push(SMALL_SAMPLE);
  notes.push(COORDINATOR_NOTE, PER_ACCEPTED_NOTE);
  if (data.profile_breakdown) notes.push(PROFILE_NOTE);
  const sources = priceSourcesNote(data.price_sources);
  if (sources !== null) notes.push(sources);
  out.push("", ...notes);
  return out.join("\n");
}

function taskText(usage: TaskUsage): string {
  const out = [
    `${usage.task.key}  ${usage.task.status}  ${usage.task.title}`,
    "",
    table(
      ["ATTEMPT", "KIND", "STATUS", ...METRICS],
      usage.attempts.map((a: AttemptUsage) => [a.key, a.kind, a.status, ...metricCells(a)]),
    ),
  ];
  const groups = usage.attempts.flatMap((attempt) =>
    attempt.subagents.groups.map((group) => ({ attempt: attempt.key, group })),
  );
  if (groups.length > 0) {
    out.push("");
    out.push("SUBAGENTS");
    out.push(
      table(
        ["ATTEMPT", "KIND", "MODEL", "SPAWNS", ...METRICS.slice(0, 7)],
        groups.map(({ attempt, group }) => [
          attempt,
          group.kind,
          group.model ?? UNKNOWN,
          String(group.count),
          ...metricCells(group.usage).slice(0, 7),
        ]),
      ),
    );
    if (groups.some(({ group }) => group.kind === "native"))
      out.push("native subagent usage is inside the parent's AGG-* columns");
  }
  out.push("");
  if (usage.totals.aggregate.events > 0) out.push(aggregateNote(usage.totals));
  const label = usage.done ? "cost to acceptance" : "cost so far (task not done)";
  out.push(`${label}: ${cost(usage.cost_to_acceptance)}`);
  const spawns = usage.attempts.reduce((sum, a) => sum + a.subagents.count, 0);
  out.push(
    `events: ${usage.totals.events}  attempts: ${usage.attempts.length}` +
      (spawns > 0 ? `  spawns: ${spawns}` : ""),
  );
  if (usage.cost_to_acceptance.unknown_events > 0) {
    const aggregates =
      usage.totals.aggregate.events > 0
        ? ` including ${usage.totals.aggregate.events} subagent aggregates`
        : "";
    out.push(`${usage.cost_to_acceptance.unknown_events} events have no known price${aggregates}`);
  }
  const sources = priceSourcesNote(usage.price_sources);
  if (sources !== null) out.push(sources);
  return out.join("\n");
}

export const stats = Effect.fn("cli.stats")(function* (argv: string[]) {
  const cli = yield* Cli;
  // Accept a bare --project as "the current project" (already the default) while
  // keeping the global --project <ref> selector working for the other commands.
  const cleaned = argv.filter((arg, i) => {
    const next = argv[i + 1];
    return !(arg === "--project" && (next === undefined || next.startsWith("--")));
  });
  const a = yield* parse(
    cleaned,
    {
      by: { type: "string" },
      "all-projects": { type: "boolean" },
      "profile-breakdown": { type: "boolean" },
    },
    2,
  );
  const allProjects = a.bool("all-projects");
  const breakdown = a.bool("profile-breakdown");
  const [kind, key] = a.positionals;
  const by = a.str("by") ?? "task";
  if (kind !== undefined) {
    if (kind !== "task") return yield* usageError(`unknown stats view '${kind}' (task)`);
    if (key === undefined) return yield* usageError("missing <task>");
    if (a.has("by")) return yield* usageError("nf stats task does not take --by");
    if (breakdown) return yield* usageError("nf stats task does not take --profile-breakdown");
    if (allProjects) return yield* usageError("nf stats task needs a single project");
    const project = yield* cli.project;
    const usage = yield* cli.withStore(taskUsage(project.id, key));
    return yield* cli.emit(usage, () => taskText(usage));
  }
  if (by === STRATEGY_GROUP) {
    if (breakdown) return yield* usageError("--profile-breakdown needs --by coordinator");
    const projectId = allProjects ? null : (yield* cli.project).id;
    const result = yield* cli.withStore(strategyStats({ projectId, allProjects }));
    return yield* cli.emit(result, () => strategyText(result));
  }
  if (by === CONTEXT_GROUP) {
    if (breakdown) return yield* usageError("--profile-breakdown needs --by coordinator");
    const projectId = allProjects ? null : (yield* cli.project).id;
    const result = yield* cli.withStore(contextStats({ projectId, allProjects }));
    return yield* cli.emit(result, () => contextText(result));
  }
  if (by === COORDINATOR_GROUP) {
    const projectId = allProjects ? null : (yield* cli.project).id;
    const result = yield* cli.withStore(
      coordinatorStats({ projectId, allProjects, profileBreakdown: breakdown }),
    );
    return yield* cli.emit(result, () => coordinatorText(result));
  }
  if (breakdown) return yield* usageError("--profile-breakdown needs --by coordinator");
  if (!(USAGE_GROUPS as readonly string[]).includes(by)) {
    return yield* usageError(`invalid --by '${by}' (${STATS_GROUPS.join("|")})`);
  }
  const projectId = allProjects ? null : (yield* cli.project).id;
  const result = yield* cli.withStore(usageStats({ by, projectId, allProjects }));
  return yield* cli.emit(result, () => listText(result));
});
