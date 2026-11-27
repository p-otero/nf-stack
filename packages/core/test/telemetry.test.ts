import { afterEach, describe, expect, test } from "bun:test";
import {
  STRATEGIES,
  TELEMETRY_COLORS,
  TelemetryView,
  colorIndexes,
  hashedColorIndex,
  strategyStats,
  telemetryView,
  usageStats,
} from "../src/index.ts";
import type { CostQuality, PriceFile, Task, TokenFields } from "../src/index.ts";
import * as Schema from "effect/Schema";
import type { Fixture } from "./helpers.ts";
import { addTask, cleanupAll, fixture, passAll, startImpl, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const decodeTelemetryView = Schema.decodeSync(TelemetryView);
const AT = "2026-02-01T00:00:00.000Z";
const COORDINATOR = "thread-coord";

interface EventOptions {
  key: string;
  attemptId: string;
  cost: number | null;
  quality?: CostQuality;
  model?: string;
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  source?: string | null;
}

/** The price layer `nf sync` records for an event of this quality. */
function priceSource(quality: CostQuality, source: string | null | undefined): string | null {
  if (source !== undefined) return source;
  if (quality === "reported") return "pi";
  if (quality === "estimated") return "litellm";
  return null;
}

/** A stored usage event, `nf sync` would have written it. */
async function event(f: Fixture, options: EventOptions): Promise<void> {
  const quality = options.quality ?? (options.cost === null ? "unknown" : "estimated");
  await f.sql(
    `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
       native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
       cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `row-${options.key}`,
    "t3",
    `t3:turn:${options.key}`,
    f.store.machine,
    "thread-a",
    "uuid-a",
    "run-1",
    `turn-${options.key}`,
    "pi",
    options.model ?? "model-a",
    "2026-01-01T10:00:00Z",
    options.input ?? 100,
    options.output ?? 10,
    options.cacheRead ?? null,
    options.cacheWrite ?? null,
    null,
    "complete",
    0,
    options.cost,
    quality,
    priceSource(quality, options.source),
    null,
    options.attemptId,
    "attempt",
    "2026-01-01T10:00:00Z",
  );
}

/** A spawn row as `nf sync` records it; `attempt_id` NULL is the coordinator's own spawn. */
async function spawn(
  f: Fixture,
  options: {
    key: string;
    parent: string;
    attemptId: string | null;
    model?: string;
    kind?: "app_owned" | "native";
  },
): Promise<void> {
  await f.sql(
    `INSERT INTO subagent_spawns (id, source_key, parent_t3_thread_id, parent_run_id,
       child_t3_thread_id, provider, model, kind, started_at, ended_at, attempt_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    `spawn-${options.key}`,
    `t3:subagent:${options.key}`,
    options.parent,
    "run-1",
    null,
    "claudeAgent",
    options.model ?? "model-a",
    options.kind ?? "app_owned",
    "2026-01-01T10:00:00.000Z",
    "2026-01-01T10:10:00.000Z",
    options.attemptId,
    "2026-01-01T10:10:00.000Z",
  );
}

/** todo -> working -> review -> done with every acceptance item passing. */
async function accept(f: Fixture, key: string): Promise<Task> {
  await f.store.setStatus(f.projectId, key, "working");
  await f.store.setStatus(f.projectId, key, "review");
  await passAll(f, key);
  return f.store.acceptTask(f.projectId, key);
}

function tokenTotal(totals: TokenFields): number {
  return (
    (totals.input_tokens ?? 0) +
    (totals.output_tokens ?? 0) +
    (totals.cache_read_tokens ?? 0) +
    (totals.cache_write_tokens ?? 0)
  );
}

/**
 * Every task accepted: the cost and tokens of the whole project are then both what `nf stats`
 * reports and what reaching acceptance cost, which is what the telemetry view compares.
 */
async function acceptedProject(f: Fixture): Promise<void> {
  const cheap = await addTask(f, { title: "cheap first", strategy: "cheap" });
  const first = await startImpl(f, cheap.key, { model: "model-a" });
  await event(f, {
    key: "c1",
    attemptId: first.id,
    cost: 0.5,
    quality: "reported",
    model: "model-a",
  });
  await f.store.finishAttempt(f.projectId, first.key, { status: "succeeded", outcome: "ok" });
  await accept(f, cheap.key);

  const direct = await addTask(f, { title: "direct repair", strategy: "direct" });
  const broken = await startImpl(f, direct.key, { model: "model-b" });
  await event(f, { key: "d1", attemptId: broken.id, cost: 0.002, model: "model-b" });
  await f.store.finishAttempt(f.projectId, broken.key, { status: "failed", outcome: "no" });
  const repair = await startImpl(f, direct.key, { model: "model-b", repairOf: broken.key });
  await event(f, { key: "d2", attemptId: repair.id, cost: 0.003, model: "model-b" });
  await f.store.finishAttempt(f.projectId, repair.key, { status: "succeeded", outcome: "ok" });
  await accept(f, direct.key);

  const legacy = await addTask(f, { title: "no strategy" });
  const unpriced = await startImpl(f, legacy.key, { model: "model-c" });
  await event(f, { key: "n1", attemptId: unpriced.id, cost: null, model: "model-c" });
  await f.store.finishAttempt(f.projectId, unpriced.key, { status: "succeeded", outcome: "ok" });
  await accept(f, legacy.key);
}

describe("telemetry view", () => {
  test("totals equal nf stats --by strategy and --by model on the same store", async () => {
    const f = await fixture();
    await acceptedProject(f);

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    const strategies = await f.run(strategyStats({ projectId: f.projectId }));
    const models = await f.run(usageStats({ by: "model", projectId: f.projectId }));

    expect(view.groupBy).toBe("strategy");
    expect(view.rows.map((row) => row.entity.id)).toEqual(["direct", "cheap", "none"]);
    expect(view.rows.map((row) => row.entity.kind)).toEqual(["strategy", "strategy", "strategy"]);

    // Same rows as `nf stats --by strategy`, cost, tasks and sample included.
    expect(strategies.rows.map((row) => row.strategy)).toEqual(["direct", "cheap", null]);
    for (const [index, row] of strategies.rows.entries()) {
      const entity = view.rows[index];
      expect(entity?.tasks).toBe(row.tasks);
      expect(entity?.n).toBe(row.n);
      expect(entity?.firstPass.total).toBe(row.n);
      expect(entity?.firstPass.accepted).toBe(row.first_pass);
      expect(entity?.spawns).toBe(row.spawns);
      expect(entity?.costToAcceptance.value).toBe(row.cost_to_acceptance.value);
      expect(entity?.costToAcceptance.quality).toBe(
        row.cost_to_acceptance.value === null
          ? "unknown"
          : row.cost_to_acceptance.quality === "reported"
            ? "measured"
            : "estimated",
      );
    }

    // `direct` accepted only after a repair: the two halves stack to its total.
    const direct = view.rows[0];
    expect(direct?.firstPass).toEqual({ accepted: 0, total: 1 });
    expect(direct?.repairs).toBe(1);
    expect(direct?.costToAcceptance.base).toEqual({
      value: 0.002,
      quality: "estimated",
      source: "litellm",
    });
    expect(direct?.costToAcceptance.repair.value).toBe(0.003);
    expect(direct?.costToAcceptance.value).toBe(0.005);
    expect(direct?.costToAcceptance.median).toEqual({ value: 0.005, quality: "derived" });

    const cheap = view.rows[1];
    expect(cheap?.firstPass).toEqual({ accepted: 1, total: 1 });
    expect(cheap?.costToAcceptance.repair).toEqual({ value: null, quality: "unknown" });
    expect(cheap?.tokens).toEqual({ value: 110, quality: "measured" });
    expect(cheap?.share.cost).toBeCloseTo(0.5 / 0.505, 12);
    // Four events of 110 tokens each: the cheap task owns one of them.
    expect(cheap?.share.tokens).toBeCloseTo(0.25, 12);

    // Totals: what `nf stats` totals report, unpriced spend included in the count, never in cost.
    const strategiesCost = strategies.rows.reduce(
      (sum, row) => sum + (row.cost_to_acceptance.value ?? 0),
      0,
    );
    expect(view.totals.costToAcceptance.value).toBeCloseTo(strategiesCost, 12);
    expect(view.totals.costToAcceptance.value).toBeCloseTo(models.totals.cost.value as number, 12);
    expect(view.totals.tokens.value).toBe(tokenTotal(models.totals));
    expect(view.totals.tasks).toBe(3);
    expect(view.totals.n).toBe(3);
    expect(view.totals.firstPass).toEqual({ accepted: 2, total: 3 });
    expect(view.totals.spawns).toBe(models.spawns);
    expect(view.unpriced.events).toBe(1);
    expect(view.unpriced.tokens).toBe(110);
    expect(view.range).toEqual({
      from: "2026-01-01T10:00:00.000Z",
      to: "2026-01-01T10:00:00.000Z",
    });

    const byModel = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "model", at: AT }),
    );
    expect(byModel.groupBy).toBe("model");
    expect(byModel.rows.map((row) => row.entity.id)).toEqual(["model-a", "model-b", "model-c"]);
    expect(byModel.rows.map((row) => row.entity.kind)).toEqual(["model", "model", "model"]);
    for (const row of models.rows) {
      const entity = byModel.rows.find((candidate) => candidate.entity.id === row.key);
      expect(entity?.costToAcceptance.value).toBe(row.cost.value);
      expect(entity?.tokens.value).toBe(tokenTotal(row));
    }
    expect(byModel.totals.costToAcceptance.value).toBeCloseTo(
      models.totals.cost.value as number,
      12,
    );
  });

  test("names the price layers behind its costs, as nf stats does", async () => {
    const f = await fixture();
    await acceptedProject(f);

    const strategy = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    const strategies = await f.run(strategyStats({ projectId: f.projectId }));
    expect(strategy.price_sources).toEqual(strategies.price_sources);
    expect(strategy.price_sources).toEqual(["litellm", "pi"]);

    const byModel = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "model", at: AT }),
    );
    const models = await f.run(usageStats({ by: "model", projectId: f.projectId }));
    expect(byModel.price_sources).toEqual(models.price_sources);
  });

  test("names OpenRouter when the catalog priced the accepted tasks", async () => {
    const f = await fixture();
    const task = await addTask(f, { title: "catalog priced", strategy: "cheap" });
    const attempt = await startImpl(f, task.key, { model: "model-a" });
    await event(f, {
      key: "catalog",
      attemptId: attempt.id,
      cost: 0.004,
      source: "openrouter",
      model: "model-a",
    });
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded", outcome: "ok" });
    await accept(f, task.key);

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    expect(view.price_sources).toEqual(["openrouter"]);
  });

  test("names the layer of an open task, whose usage the daily series and cache rows still price", async () => {
    const f = await fixture();
    const accepted = await addTask(f, { title: "accepted", strategy: "cheap" });
    const doneAttempt = await startImpl(f, accepted.key, { model: "model-a" });
    await event(f, {
      key: "done",
      attemptId: doneAttempt.id,
      cost: 0.5,
      quality: "reported",
      model: "model-a",
    });
    await f.store.finishAttempt(f.projectId, doneAttempt.key, {
      status: "succeeded",
      outcome: "ok",
    });
    await accept(f, accepted.key);

    const open = await addTask(f, { title: "open", strategy: "direct" });
    const openAttempt = await startImpl(f, open.key, { model: "model-b" });
    await event(f, {
      key: "open",
      attemptId: openAttempt.id,
      cost: 0.004,
      source: "openrouter",
      model: "model-b",
      cacheRead: 100,
    });

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    expect(view.price_sources).toEqual(["openrouter", "pi"]);
    expect(view.daily).toMatchObject([{ date: "2026-01-01", workers: { value: 0.504 } }]);
    expect(view.cache.totals.cacheRead.value).toBe(100);

    // `nf stats --by strategy` prices acceptance only, so the open task's layer stays out.
    const strategies = await f.run(strategyStats({ projectId: f.projectId }));
    expect(strategies.price_sources).toEqual(["pi"]);
  });

  test("the coordinator is its own entity, never a task and never a first-pass sample", async () => {
    const f = await fixture();
    await f.store.registerProject({
      name: "demo",
      rootPath: f.root,
      coordinatorThreadId: COORDINATOR,
    });
    await acceptedProject(f);
    const taskAttempt = (await f.store.getAttempt(f.projectId, "T-001-A1")).id;
    await spawn(f, { key: "task", parent: "thread-a", attemptId: taskAttempt, model: "model-a" });
    await spawn(f, { key: "coord", parent: COORDINATOR, attemptId: null, model: "model-z" });
    await f.sql(
      `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
         native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
         cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "row-coord",
      "t3",
      "t3:turn:coord",
      f.store.machine,
      COORDINATOR,
      null,
      "run-2",
      "turn-coord",
      "pi",
      "model-z",
      "2026-01-01T09:00:00Z",
      40,
      4,
      null,
      null,
      null,
      "complete",
      0,
      0.75,
      "reported",
      "pi",
      null,
      null,
      "coordination",
      "2026-01-01T09:00:00Z",
    );

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    const coord = view.rows.find((row) => row.entity.kind === "coordination");
    expect(coord?.entity.id).toBe("coordination");
    expect(coord).toMatchObject({
      tasks: 0,
      n: 0,
      firstPass: { accepted: 0, total: 0 },
      repairs: 0,
      spawns: 1,
    });
    expect(coord?.costToAcceptance).toMatchObject({
      value: 0.75,
      quality: "measured",
      source: "pi",
    });
    expect(coord?.tokens).toEqual({ value: 44, quality: "measured" });
    // Coordination sorts last: it is not a strategy, and it is no part of the task totals.
    expect(view.rows.at(-1)?.entity.kind).toBe("coordination");
    expect(coord?.share).toEqual({ cost: null, tokens: null });
    expect(coord?.entity.color).toBeNull();
    expect(view.totals.firstPass).toEqual({ accepted: 2, total: 3 });
    expect(view.totals.n).toBe(3);
    expect(view.totals.tasks).toBe(3);
    expect(view.totals.costToAcceptance.value).toBeCloseTo(0.505, 12);
    expect(view.totals.spawns).toBe(1);
    expect(view.totals.coordination).toEqual({
      cost: { value: 0.75, quality: "measured", source: "pi" },
      tokens: { value: 44, quality: "measured" },
      spawns: 1,
    });
    expect(view.range.from).toBe("2026-01-01T09:00:00.000Z");

    // `nf stats --by strategy` reports the same coordination row.
    const strategies = await f.run(strategyStats({ projectId: f.projectId }));
    const row = strategies.rows.at(-1);
    expect(row).toMatchObject({ strategy: null, coordination: true, tasks: 0, n: 0, spawns: 1 });
    expect(row?.first_pass_rate).toBeNull();
    expect(row?.cost_to_acceptance).toMatchObject({ value: 0.75, quality: "reported" });
    expect(strategies.rows.slice(0, -1).map((r) => r.strategy)).toEqual(["direct", "cheap", null]);
    expect(strategies.rows.every((r) => r.coordination !== true || r.n === 0)).toBe(true);
  });

  test("groups by profile and task, and leaves a project without usage unknown", async () => {
    const f = await fixture();
    const empty = await f.run(telemetryView({ projectId: f.projectId, groupBy: "task", at: AT }));
    expect(empty.rows).toEqual([]);
    expect(empty.totals.tasks).toBe(0);
    expect(empty.totals.costToAcceptance.value).toBeNull();
    expect(empty.totals.tokens.value).toBeNull();
    expect(empty.range).toEqual({ from: AT, to: AT });

    const profiled = await addTask(f, { title: "profiled", strategy: "cheap", profile: "bounded" });
    const attempt = await startImpl(f, profiled.key, { model: "model-a" });
    await event(f, { key: "p1", attemptId: attempt.id, cost: 0.25, model: "model-a" });
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded", outcome: "ok" });
    await accept(f, profiled.key);

    const byProfile = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "profile", at: AT }),
    );
    expect(byProfile.rows.map((row) => [row.entity.id, row.entity.kind])).toEqual([
      ["bounded", "profile"],
    ]);
    expect(byProfile.rows[0]?.share.cost).toBe(1);

    const byTask = await f.run(telemetryView({ projectId: f.projectId, groupBy: "task", at: AT }));
    expect(byTask.rows.map((row) => row.entity.label)).toEqual(["T-001 · profiled"]);
    expect(byTask.rows[0]?.entity).toMatchObject({ id: "T-001", kind: "task" });
    expect(byTask.rows[0]?.entity.color).toBe(1);
  });

  test("task entities carry the prefixed key", async () => {
    const f = await fixture();
    const project = (await f.store.registerProject({ name: "nf-stack", rootPath: tempDir() }))
      .project;
    await f.store.addTask(project.id, {
      title: "Prefixed",
      goal: "keys carry the project prefix",
      acceptance: ["NF-001"],
    });
    const view = await f.run(telemetryView({ projectId: project.id, groupBy: "task", at: AT }));
    expect(view.rows.map((row) => row.entity.id)).toEqual(["NF-001"]);
    expect(view.rows[0]?.entity.label).toBe("NF-001 · Prefixed");
  });

  test("one view paints its entities in distinct colors and the coordinator in none", async () => {
    const f = await fixture();
    await acceptedProject(f);
    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    // Three strategies: numbered in sorted order, so no two rows share a colour.
    expect(view.rows.map((row) => [row.entity.id, row.entity.color])).toEqual([
      ["direct", 2],
      ["cheap", 1],
      ["none", 3],
    ]);
    expect(decodeTelemetryView(view)).toEqual(view);

    // While the ids fit the palette they are numbered, independently of the row order.
    expect([...colorIndexes(["plan", "auto", "cheap"])]).toEqual([
      ["auto", 1],
      ["cheap", 2],
      ["plan", 3],
    ]);
    expect(colorIndexes(["cheap"])).toEqual(colorIndexes(["cheap"]));
    // Beyond the palette an id falls back to its own hash, so it keeps its colour.
    const many = ["a", "b", "c", "d", "e", "f"];
    expect([...colorIndexes(many)]).toEqual(many.map((id) => [id, hashedColorIndex(id)]));
    for (const [, color] of colorIndexes(many)) {
      expect(color).toBeGreaterThanOrEqual(1);
      expect(color).toBeLessThanOrEqual(TELEMETRY_COLORS);
    }
    expect(STRATEGIES).toContain("cheap");
  });

  test("the totals are the tasks': the coordinator's usage stays out of them", async () => {
    const f = await fixture();
    await f.store.registerProject({
      name: "demo",
      rootPath: f.root,
      coordinatorThreadId: COORDINATOR,
    });
    // One accepted task at 0.5, and a coordinator that spent more than it.
    const task = await addTask(f, { title: "only task", strategy: "cheap" });
    const attempt = await startImpl(f, task.key, { model: "model-a" });
    await event(f, { key: "t1", attemptId: attempt.id, cost: 0.5, quality: "reported" });
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded", outcome: "ok" });
    await accept(f, task.key);
    await spawn(f, { key: "task", parent: "thread-a", attemptId: attempt.id });
    await spawn(f, { key: "coord", parent: COORDINATOR, attemptId: null });
    await f.sql(
      `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
         native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
         cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "row-coord",
      "t3",
      "t3:turn:coord",
      f.store.machine,
      COORDINATOR,
      null,
      "run-2",
      "turn-coord",
      "pi",
      "model-z",
      "2026-01-01T09:00:00Z",
      4000,
      400,
      null,
      null,
      null,
      "complete",
      0,
      2.5,
      "reported",
      "pi",
      null,
      null,
      "coordination",
      "2026-01-01T09:00:00Z",
    );

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT }),
    );
    const taskRow = view.rows.find((row) => row.entity.id === "cheap");
    const coord = view.rows.find((row) => row.entity.kind === "coordination");
    expect(taskRow?.costToAcceptance.value).toBe(0.5);
    expect(coord?.costToAcceptance.value).toBe(2.5);

    // The totals are exactly the task row, never the task plus the coordinator.
    expect(view.totals.tasks).toBe(1);
    expect(view.totals.n).toBe(1);
    expect(view.totals.firstPass).toEqual({ accepted: 1, total: 1 });
    expect(view.totals.costToAcceptance.value).toBe(0.5);
    expect(view.totals.costToAcceptance.median).toEqual({ value: 0.5, quality: "derived" });
    const taskTokens = taskRow?.tokens.value ?? null;
    expect(taskTokens).toBe(110);
    expect(view.totals.tokens.value).toBe(taskTokens);
    expect(view.totals.repairs).toBe(0);
    expect(view.totals.spawns).toBe(1);
    // The coordinator is reported apart, and its share of the task totals does not exist.
    expect(view.totals.coordination).toEqual({
      cost: { value: 2.5, quality: "measured", source: "pi" },
      tokens: { value: 4400, quality: "measured" },
      spawns: 1,
    });
    expect(coord?.share).toEqual({ cost: null, tokens: null });
    expect(taskRow?.share.cost).toBe(1);
    expect(taskRow?.share.tokens).toBe(1);
    // Unpriced events behind the totals are the tasks' own.
    expect(view.unpriced.events).toBe(0);
  });
});

/** Model-a prices both cache rates; model-b has no cache-read rate, model-c has none at all. */
const PRICES: PriceFile = {
  date: "2026-01-01",
  warnings: [],
  sources: [],
  rates: (model) =>
    model === "model-a"
      ? { input: 2, output: 4, cache_read: 0.5, cache_write: 1, source: "litellm" }
      : model === "model-b"
        ? { input: 1, output: 2, cache_read: null, cache_write: null, source: "litellm" }
        : null,
};

describe("telemetry cache and daily cost", () => {
  test("contexts and models carry the cache totals of nf stats, and daily cost adds up", async () => {
    const f = await fixture();
    await f.store.registerProject({
      name: "demo",
      rootPath: f.root,
      coordinatorThreadId: COORDINATOR,
    });

    const fresh = await addTask(f, { title: "fresh", strategy: "cheap" });
    const first = await startImpl(f, fresh.key, { model: "model-a", contextMode: "fresh" });
    await event(f, {
      key: "f1",
      attemptId: first.id,
      cost: 0.5,
      quality: "reported",
      model: "model-a",
      input: 1000,
      cacheRead: 0,
    });
    await f.store.finishAttempt(f.projectId, first.key, { status: "succeeded", outcome: "ok" });
    await accept(f, fresh.key);

    const reused = await addTask(f, { title: "reused", strategy: "cheap" });
    const again = await startImpl(f, reused.key, { model: "model-a", contextMode: "reuse" });
    await event(f, {
      key: "r1",
      attemptId: again.id,
      cost: 0.25,
      model: "model-a",
      input: 200,
      cacheRead: 8000,
      cacheWrite: 100,
    });
    await f.store.finishAttempt(f.projectId, again.key, { status: "succeeded", outcome: "ok" });
    await accept(f, reused.key);

    const repaired = await addTask(f, { title: "repaired", strategy: "cheap" });
    const broken = await startImpl(f, repaired.key, { model: "model-b", contextMode: "reuse" });
    await event(f, {
      key: "b1",
      attemptId: broken.id,
      cost: 0.02,
      model: "model-b",
      input: 50,
    });
    await f.store.finishAttempt(f.projectId, broken.key, { status: "failed", outcome: "no" });
    const repair = await startImpl(f, repaired.key, {
      model: "model-b",
      contextMode: "reuse",
      repairOf: broken.key,
    });
    await event(f, {
      key: "b2",
      attemptId: repair.id,
      cost: 0.03,
      model: "model-b",
      input: 50,
      cacheRead: 450,
    });
    await f.store.finishAttempt(f.projectId, repair.key, { status: "succeeded", outcome: "ok" });
    await accept(f, repaired.key);

    const forked = await addTask(f, { title: "forked", strategy: "cheap" });
    const fork = await startImpl(f, forked.key, { model: "model-c", contextMode: "fork" });
    await event(f, {
      key: "k1",
      attemptId: fork.id,
      cost: null,
      model: "model-c",
      input: 100,
      cacheRead: 900,
    });
    await f.store.finishAttempt(f.projectId, fork.key, { status: "succeeded", outcome: "ok" });
    await accept(f, forked.key);

    await f.sql(
      `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
         native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
         cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "row-coord",
      "t3",
      "t3:turn:coord",
      f.store.machine,
      COORDINATOR,
      null,
      "run-2",
      "turn-coord",
      "pi",
      "model-a",
      "2026-01-01T09:00:00Z",
      100,
      10,
      null,
      null,
      null,
      "complete",
      0,
      0.75,
      "reported",
      "pi",
      null,
      null,
      "coordination",
      "2026-01-01T09:00:00Z",
    );

    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "strategy", at: AT, prices: PRICES }),
    );
    const stats = await f.run(usageStats({ by: "model", projectId: f.projectId }));

    // Cache read is the task events' own: the coordinator's turn has none, and stays out.
    expect(view.totals.cacheRead.value).toBe(stats.totals.cache_read_tokens);
    expect(view.totals.cacheRead.value).toBe(9350);
    expect(view.cache.totals.cacheRead.value).toBe(stats.totals.cache_read_tokens);
    const input =
      (stats.totals.input_tokens ?? 0) +
      (stats.totals.cache_read_tokens ?? 0) +
      (stats.totals.cache_write_tokens ?? 0);
    // The coordinator's 100 input tokens are in nf stats, never in the tasks' cache share.
    expect(input).toBe(10950);
    expect(view.cache.totals.cacheShare).toBeCloseTo(9350 / (input - 100), 12);
    // model-a prices both rates: 8000 x (2 - 0.5); model-b and model-c are unpriced.
    expect(view.cache.totals.savings).toEqual({ value: 12000, quality: "derived" });
    expect(view.cache.totals.unpriced).toBe(1350);
    expect(view.totals.costToAcceptance.value).toBeCloseTo(0.8, 12);
    expect(
      (view.totals.costToAcceptance.value ?? 0) + (view.totals.coordination.cost.value ?? 0),
    ).toBeCloseTo(stats.totals.cost.value as number, 12);

    // Context transfers keep their canonical order; a task can stand in several.
    expect(view.cache.contexts.map((context) => context.mode)).toEqual(["fresh", "reuse", "fork"]);
    const reuseRow = view.cache.contexts[1];
    expect(reuseRow?.tasks).toBe(2);
    expect(reuseRow?.firstPass).toEqual({ accepted: 1, total: 2 });
    expect(reuseRow?.attempts).toEqual({ newWork: 2, repair: 1 });
    expect(reuseRow?.costToAcceptance.value).toBeCloseTo(0.3, 12);
    expect(reuseRow?.costToAcceptance.base.value).toBeCloseTo(0.27, 12);
    expect(reuseRow?.costToAcceptance.repair.value).toBeCloseTo(0.03, 12);
    expect(reuseRow?.costPerAcceptedTask.value).toBeCloseTo(0.15, 12);
    expect(reuseRow?.cacheRead.value).toBe(8450);
    expect(reuseRow?.cacheShare).toBeCloseTo(8450 / 8850, 12);
    expect(view.cache.contexts[0]?.attempts).toEqual({ newWork: 1, repair: 0 });
    expect(view.cache.contexts[0]?.costPerAcceptedTask.value).toBe(0.5);

    // Models by cached input, the unknown model last even when it is all a turn has.
    expect(view.cache.models.map((model) => model.id)).toEqual(["model-a", "model-c", "model-b"]);
    expect(view.cache.models[0]?.cacheRead.value).toBe(8000);
    expect(view.cache.models[0]?.unpriced).toBe(0);
    expect(view.cache.models[1]?.unpriced).toBe(1);
    expect(view.cache.models[2]?.unpriced).toBe(1);

    // The day splits the workers' spend from the coordinator's own, and adds up to nf stats.
    expect(view.daily).toHaveLength(1);
    expect(view.daily[0]?.date).toBe("2026-01-01");
    expect(view.daily[0]?.workers.value).toBeCloseTo(0.8, 12);
    expect(view.daily[0]?.coordination.value).toBeCloseTo(0.75, 12);
    expect(
      (view.daily[0]?.workers.value ?? 0) + (view.daily[0]?.coordination.value ?? 0),
    ).toBeCloseTo(stats.totals.cost.value as number, 12);

    // Every project's coordination is spend too: the all-projects daily sums equal nf stats.
    const all = await f.run(
      telemetryView({ projectId: null, groupBy: "strategy", at: AT, prices: PRICES }),
    );
    const allStats = await f.run(usageStats({ by: "model", allProjects: true }));
    expect(all.totals.coordination.cost.value).toBeCloseTo(0.75, 12);
    expect(all.daily.some((day) => (day.coordination.value ?? 0) > 0)).toBe(true);
    expect(
      all.daily.reduce(
        (sum, day) => sum + (day.workers.value ?? 0) + (day.coordination.value ?? 0),
        0,
      ),
    ).toBeCloseTo(allStats.totals.cost.value as number, 12);
  });
});
