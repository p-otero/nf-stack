import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LATEST_VERSION,
  MIGRATIONS,
  backfillAttemptCoordinators,
  coordinatorStats,
  migrationStatements,
  registerCoordinatorThread,
  strategyStats,
  syncUsage,
  telemetryView,
  usageStats,
} from "../src/index.ts";
import type { CostQuality, Task } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import {
  addTask,
  cleanupAll,
  fixture,
  openStore,
  passAll,
  pricesOf,
  startImpl,
  tempDir,
} from "./helpers.ts";

afterEach(cleanupAll);

const AT = "2026-02-01T00:00:00.000Z";

interface EventOptions {
  key: string;
  thread: string;
  model: string | null;
  ts: string;
  cost?: number | null;
  /** The T3 run the turn belongs to; one run is one dispatch of the coordinator. */
  run?: string;
  /** The layer that priced the turn; absent means a charge Pi reported itself. */
  source?: string;
}

/** A stored coordination turn, `nf sync` would have written it. */
async function coordination(f: Fixture, options: EventOptions): Promise<void> {
  const cost = options.cost ?? 0.1;
  await f.sql(
    `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
       native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
       cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `coord-${options.key}`,
    "t3",
    `t3:turn:${options.key}`,
    f.store.machine,
    options.thread,
    null,
    options.run ?? "run-1",
    `turn-${options.key}`,
    "claudeAgent",
    options.model,
    options.ts,
    40,
    4,
    null,
    null,
    null,
    "complete",
    0,
    cost,
    options.source === undefined ? "reported" : "estimated",
    options.source ?? "pi",
    null,
    null,
    "coordination",
    options.ts,
  );
}

/** A stored worker event on one attempt, priced by the fixture. */
async function worker(
  f: Fixture,
  options: {
    key: string;
    attemptId: string;
    model?: string;
    cost: number | null;
    quality?: CostQuality;
  },
): Promise<void> {
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
    "run-2",
    `turn-${options.key}`,
    "pi",
    options.model ?? "worker-model",
    "2026-01-01T10:00:00Z",
    10,
    5,
    null,
    null,
    null,
    "complete",
    0,
    options.cost,
    quality,
    quality === "reported" ? "pi" : quality === "estimated" ? "litellm" : null,
    null,
    options.attemptId,
    "attempt",
    "2026-01-01T10:00:00Z",
  );
}

async function accept(f: Fixture, key: string): Promise<Task> {
  await f.store.setStatus(f.projectId, key, "working");
  await f.store.setStatus(f.projectId, key, "review");
  await passAll(f, key);
  return f.store.acceptTask(f.projectId, key);
}

describe("attempt coordinator attribution", () => {
  test("derives the coordinator thread and the model that ran its closest turn", async () => {
    const f = await fixture();
    const task = await addTask(f);
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    await coordination(f, {
      key: "old",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2020-01-01T00:00:00.000Z",
      cost: 0.2,
    });
    await coordination(f, {
      key: "switch",
      thread: "thread-meta",
      model: "model-deepseek",
      ts: "2020-06-01T00:00:00.000Z",
      cost: 0.3,
    });
    await coordination(f, {
      key: "future",
      thread: "thread-meta",
      model: "model-future",
      ts: "2099-01-01T00:00:00.000Z",
      cost: 0.4,
    });

    const attempt = await startImpl(f, task.key, { kind: "research" });
    expect(attempt.coordinator_thread_id).toBe("thread-meta");
    expect(attempt.coordinator_model).toBe("model-deepseek");
    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-deepseek",
    });
  });

  test("two coordinator threads: the one that spoke last before the start wins", async () => {
    const f = await fixture();
    const task = await addTask(f);
    await f.run(registerCoordinatorThread(f.projectId, "thread-a"));
    await f.run(registerCoordinatorThread(f.projectId, "thread-b"));
    await coordination(f, {
      key: "a-old",
      thread: "thread-a",
      model: "model-a",
      ts: "2020-01-01T00:00:00.000Z",
    });
    await coordination(f, {
      key: "b-future",
      thread: "thread-b",
      model: "model-b",
      ts: "2099-01-01T00:00:00.000Z",
    });

    const first = await startImpl(f, task.key, { kind: "research" });
    expect(first).toMatchObject({
      coordinator_thread_id: "thread-a",
      coordinator_model: "model-a",
    });

    await coordination(f, {
      key: "b-recent",
      thread: "thread-b",
      model: "model-b",
      ts: "2020-03-01T00:00:00.000Z",
    });
    const second = await startImpl(f, task.key, { kind: "design" });
    expect(second).toMatchObject({
      coordinator_thread_id: "thread-b",
      coordinator_model: "model-b",
    });
  });

  test("an explicit coordinator model wins over the derived one", async () => {
    const f = await fixture();
    const task = await addTask(f);
    const withoutCoordinator = await startImpl(f, task.key, { kind: "research" });
    expect(withoutCoordinator.coordinator_thread_id).toBeNull();
    expect(withoutCoordinator.coordinator_model).toBeNull();

    const overridden = await startImpl(f, task.key, {
      kind: "design",
      coordinatorModel: "model-chosen",
    });
    expect(overridden.coordinator_thread_id).toBeNull();
    expect(overridden.coordinator_model).toBe("model-chosen");
  });

  test("the backfill fills attempts that predate the coordinator registry and keeps a recorded value", async () => {
    const f = await fixture();
    const first = await addTask(f, { title: "before the registry" });
    const legacy = await startImpl(f, first.key, { kind: "research" });
    expect(legacy.coordinator_thread_id).toBeNull();

    // Nothing is registered yet, so the backfill has no coordinator and leaves the attempt NULL.
    await f.run(backfillAttemptCoordinators());
    expect(await f.store.getAttempt(f.projectId, legacy.key)).toMatchObject({
      coordinator_thread_id: null,
      coordinator_model: null,
    });

    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    await coordination(f, {
      key: "early",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2020-01-01T00:00:00.000Z",
      cost: 0.2,
    });
    await f.run(backfillAttemptCoordinators());
    expect(await f.store.getAttempt(f.projectId, legacy.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-opus",
    });

    const second = await addTask(f, { title: "explicit model" });
    const chosen = await startImpl(f, second.key, {
      kind: "research",
      coordinatorModel: "model-chosen",
    });
    await f.run(backfillAttemptCoordinators());
    expect(await f.store.getAttempt(f.projectId, chosen.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-chosen",
    });
  });

  test("migrating a v8 store backfills its attempts from the coordinator's usage", async () => {
    const home = tempDir("nf-coordinator-v8-");
    const raw = new DatabaseSync(join(home, "nf.db"));
    try {
      for (const migration of MIGRATIONS.slice(0, 8))
        for (const statement of migrationStatements(migration)) raw.exec(statement);
      raw.exec("PRAGMA user_version = 8");
      raw
        .prepare(
          `INSERT INTO projects (id, machine_id, name, prefix, root_path,
             coordinator_thread_id, created_at)
           VALUES ('p1','m1','legacy','LG','C:/legacy','thread-old','2020-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO tasks (id, machine_id, project_id, seq, key, title, goal, status,
             created_at, updated_at)
           VALUES ('t1','m1','p1',1,'LG-001','t','g','todo','2020-01-01T00:00:00.000Z',
             '2020-01-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO attempts (id, machine_id, task_id, seq, key, kind, status, mechanism,
             started_at, updated_at)
           VALUES ('a1','m1','t1',1,'LG-001-A1','research','succeeded','delegate_task',
             '2020-06-01T00:00:00.000Z','2020-06-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO attempts (id, machine_id, task_id, seq, key, kind, status, mechanism,
             started_at, updated_at)
           VALUES ('a2','m1','t1',2,'LG-001-A2','design','succeeded','delegate_task',
             '2019-12-01T00:00:00.000Z','2019-12-01T00:00:00.000Z')`,
        )
        .run();
      raw
        .prepare(
          `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id, model, ts,
             input_tokens, output_tokens, usage_status, is_subagent, cost_usd, cost_quality,
             attempt_id, bucket, created_at)
           VALUES ('e1','t3','t3:turn:e1','m1','thread-old','legacy-model',
             '2020-01-01T00:00:00.000Z',40,4,'complete',0,0.2,'reported',NULL,'coordination',
             '2020-01-01T00:00:00.000Z')`,
        )
        .run();
    } finally {
      raw.close();
    }

    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({
        user_version: LATEST_VERSION,
      });
      expect(await opened.store.getAttempt("p1", "LG-001-A1")).toMatchObject({
        coordinator_thread_id: "thread-old",
        coordinator_model: "legacy-model",
      });
      // The coordinator's only turn is recorded after this start: it is the run the attempt
      // started in, so its model is the coordinator.
      expect(await opened.store.getAttempt("p1", "LG-001-A2")).toMatchObject({
        coordinator_thread_id: "thread-old",
        coordinator_model: "legacy-model",
      });
    } finally {
      await opened.close();
    }
  });

  test("nf sync backfills an attempt once its coordinator turns are ingested", async () => {
    const f = await fixture();
    const task = await addTask(f);
    const attempt = await startImpl(f, task.key, { kind: "research" });
    expect(attempt.coordinator_thread_id).toBeNull();
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    await coordination(f, {
      key: "ingested",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2020-01-01T00:00:00.000Z",
    });

    const dir = tempDir("nf-coordinator-sync-");
    const t3State = join(dir, "statev2.sqlite");
    const db = new DatabaseSync(t3State);
    try {
      db.exec(`CREATE TABLE orchestration_v2_projection_provider_threads (
          provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT NOT NULL,
          provider_instance_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE orchestration_v2_projection_provider_turns (
          provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
          provider_thread_id TEXT NOT NULL, run_attempt_id TEXT,
          status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}');`);
    } finally {
      db.close();
    }
    const result = await f.run(
      syncUsage({
        t3State,
        piSessions: join(dir, "sessions"),
        prices: pricesOf(() => null),
        source: "t3",
      }),
    );
    // The empty source warns about its missing subagent projection; it must not fail.
    expect(result.sources[0]?.status).not.toBe("failed");
    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-opus",
    });
  });

  test("a start before the coordinator's first recorded turn takes that run's model", async () => {
    const f = await fixture();
    const task = await addTask(f);
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    const attempt = await startImpl(f, task.key, { kind: "research" });
    expect(attempt).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: null,
    });

    // Usage is written when a turn completes, so the dispatching turn lands after the start.
    await coordination(f, {
      key: "dispatch",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2099-01-01T00:00:00.000Z",
      run: "run-dispatch",
    });
    await coordination(f, {
      key: "later",
      thread: "thread-meta",
      model: "model-deepseek",
      ts: "2099-06-01T00:00:00.000Z",
      run: "run-later",
    });

    await f.run(backfillAttemptCoordinators());
    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-opus",
    });
  });

  test("with no earlier turn, the coordinator thread whose run comes next is picked", async () => {
    const f = await fixture();
    const task = await addTask(f);
    await f.run(registerCoordinatorThread(f.projectId, "thread-a"));
    await f.run(registerCoordinatorThread(f.projectId, "thread-b"));
    const attempt = await startImpl(f, task.key, { kind: "research" });
    expect(attempt.coordinator_thread_id).toBeNull();

    await coordination(f, {
      key: "a-next",
      thread: "thread-a",
      model: "model-a",
      ts: "2099-06-01T00:00:00.000Z",
      run: "run-a",
    });
    await coordination(f, {
      key: "b-next",
      thread: "thread-b",
      model: "model-b",
      ts: "2099-01-01T00:00:00.000Z",
      run: "run-b",
    });

    await f.run(backfillAttemptCoordinators());
    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-b",
      coordinator_model: "model-b",
    });
  });

  test("registering a coordinator thread re-derives the attempts that started before it", async () => {
    const f = await fixture();
    const task = await addTask(f, { title: "dispatched before the registry" });
    const attempt = await startImpl(f, task.key, { kind: "research" });
    expect(attempt).toMatchObject({ coordinator_thread_id: null, coordinator_model: null });

    await coordination(f, {
      key: "dispatch",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2099-01-01T00:00:00.000Z",
    });
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));

    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-opus",
    });
  });

  test("nf sync fills an attempt from the coordinator turn recorded after its start", async () => {
    const f = await fixture();
    const task = await addTask(f);
    const attempt = await startImpl(f, task.key, { kind: "research" });
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    await coordination(f, {
      key: "dispatch",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2099-01-01T00:00:00.000Z",
    });

    const dir = tempDir("nf-coordinator-sync-next-");
    const t3State = join(dir, "statev2.sqlite");
    const db = new DatabaseSync(t3State);
    try {
      db.exec(`CREATE TABLE orchestration_v2_projection_provider_threads (
          provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT NOT NULL,
          provider_instance_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE orchestration_v2_projection_provider_turns (
          provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
          provider_thread_id TEXT NOT NULL, run_attempt_id TEXT,
          status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT,
          payload_json TEXT NOT NULL DEFAULT '{}');`);
    } finally {
      db.close();
    }
    const result = await f.run(
      syncUsage({
        t3State,
        piSessions: join(dir, "sessions"),
        prices: pricesOf(() => null),
        source: "t3",
      }),
    );
    expect(result.sources[0]?.status).not.toBe("failed");
    expect(await f.store.getAttempt(f.projectId, attempt.key)).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-opus",
    });
  });
});

/**
 * Two coordinating models on one thread (a model switch), three accepted tasks and one task
 * dispatched by a coordinator turn that recorded no model, whose coordinator stays unknown.
 */
async function coordinatedProject(f: Fixture): Promise<void> {
  await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
  await coordination(f, {
    key: "opus",
    thread: "thread-meta",
    model: "model-opus",
    ts: "2020-01-01T00:00:00.000Z",
    cost: 0.2,
  });

  const firstPass = await addTask(f, { title: "opus first pass", profile: "bounded" });
  const first = await startImpl(f, firstPass.key);
  await worker(f, { key: "o1", attemptId: first.id, cost: 0.5, quality: "reported" });
  await f.store.finishAttempt(f.projectId, first.key, { status: "succeeded", outcome: "ok" });
  await accept(f, firstPass.key);

  const repaired = await addTask(f, { title: "opus repair", profile: "bounded" });
  const broken = await startImpl(f, repaired.key);
  await worker(f, { key: "o2", attemptId: broken.id, cost: 0.001 });
  await f.store.finishAttempt(f.projectId, broken.key, { status: "failed", outcome: "no" });
  const repair = await startImpl(f, repaired.key, { repairOf: broken.key });
  await worker(f, { key: "o3", attemptId: repair.id, cost: 0.001 });
  await f.store.finishAttempt(f.projectId, repair.key, { status: "succeeded", outcome: "ok" });
  await f.store.intervene(f.projectId, repaired.key, "asked for the failing test");
  await accept(f, repaired.key);

  await coordination(f, {
    key: "deepseek",
    thread: "thread-meta",
    model: "model-deepseek",
    ts: "2020-03-01T00:00:00.000Z",
    cost: 0.3,
  });
  const cheap = await addTask(f, { title: "deepseek", profile: "frontier" });
  const deepseekAttempt = await startImpl(f, cheap.key);
  await worker(f, { key: "d1", attemptId: deepseekAttempt.id, cost: 0.1 });
  await f.store.finishAttempt(f.projectId, deepseekAttempt.key, {
    status: "succeeded",
    outcome: "ok",
  });
  await accept(f, cheap.key);

  await f.run(registerCoordinatorThread(f.projectId, "thread-unnamed"));
  await coordination(f, {
    key: "unnamed",
    thread: "thread-unnamed",
    model: null,
    ts: "2020-04-01T00:00:00.000Z",
    cost: 0,
  });
  const unknownTask = await addTask(f, { title: "coordinator without a model" });
  const unknown = await startImpl(f, unknownTask.key, { kind: "research" });
  expect(unknown).toMatchObject({
    coordinator_thread_id: "thread-unnamed",
    coordinator_model: null,
  });
}

describe("coordinator stats", () => {
  test("compares coordinating models by cost per accepted task and effectiveness", async () => {
    const f = await fixture();
    await coordinatedProject(f);

    const stats = await f.run(coordinatorStats({ projectId: f.projectId }));
    expect(stats.by).toBe("coordinator");
    expect(stats.profile_breakdown).toBe(false);
    expect(stats.project?.name).toBe("demo");
    expect(stats.rows.map((row) => row.coordinator)).toEqual([
      "model-deepseek",
      "model-opus",
      null,
    ]);
    // Both layers behind these costs: Pi's reported charge and the LiteLLM estimate.
    expect(stats.price_sources).toEqual(["litellm", "pi"]);

    const opus = stats.rows[1];
    expect(opus).toMatchObject({
      tasks: 2,
      accepted: 2,
      n: 2,
      first_pass: 1,
      repairs: 1,
      human_interventions: 1,
    });
    expect(opus?.first_pass_rate).toBe(0.5);
    expect(opus?.coordination_cost).toMatchObject({ value: 0.2, quality: "reported" });
    expect(opus?.worker_cost).toMatchObject({ value: 0.502, quality: "estimated" });
    expect(opus?.cost_per_accepted_task).toBeCloseTo(0.351, 12);

    const deepseek = stats.rows[0];
    expect(deepseek).toMatchObject({
      tasks: 1,
      accepted: 1,
      n: 1,
      first_pass: 1,
      repairs: 0,
      human_interventions: 0,
    });
    expect(deepseek?.first_pass_rate).toBe(1);
    expect(deepseek?.coordination_cost.value).toBeCloseTo(0.3, 12);
    expect(deepseek?.worker_cost).toMatchObject({ value: 0.1, quality: "estimated" });
    expect(deepseek?.cost_per_accepted_task).toBeCloseTo(0.4, 12);

    const unknown = stats.rows[2];
    expect(unknown).toMatchObject({ tasks: 1, accepted: 0, n: 0, first_pass_rate: null });
    expect(unknown?.worker_cost.value).toBeNull();
    expect(unknown?.cost_per_accepted_task).toBeNull();

    // Each coordination turn is priced under the model that ran it, in the model grouping too.
    const models = await f.run(usageStats({ by: "model", projectId: f.projectId }));
    const byModel = new Map(models.rows.map((row) => [row.key, row]));
    expect(byModel.get("model-opus")?.cost.value).toBeCloseTo(0.2, 12);
    expect(byModel.get("model-deepseek")?.cost.value).toBeCloseTo(0.3, 12);
    expect(byModel.get("worker-model")?.cost.value).toBeCloseTo(0.602, 12);
  });

  test("--profile-breakdown adds sub-rows under each coordinator", async () => {
    const f = await fixture();
    await coordinatedProject(f);

    const stats = await f.run(coordinatorStats({ projectId: f.projectId, profileBreakdown: true }));
    expect(stats.profile_breakdown).toBe(true);
    expect(stats.rows.map((row) => [row.coordinator, row.profile])).toEqual([
      ["model-deepseek", undefined],
      ["model-deepseek", "frontier"],
      ["model-opus", undefined],
      ["model-opus", "bounded"],
      [null, undefined],
      [null, null],
    ]);

    const parent = stats.rows[2];
    const bounded = stats.rows[3];
    expect(bounded).toMatchObject({ tasks: 2, accepted: 2, n: 2, repairs: 1 });
    expect(bounded?.coordination_cost.value).toBeNull();
    expect(bounded?.worker_cost.value).toBeCloseTo(0.502, 12);
    expect(bounded?.cost_per_accepted_task).toBeCloseTo(0.251, 12);
    expect(parent?.worker_cost.value).toBe(bounded?.worker_cost.value);
    expect(parent?.coordination_cost.value).toBeCloseTo(0.2, 12);
    expect(parent?.cost_per_accepted_task).toBeCloseTo(0.351, 12);

    const all = await f.run(coordinatorStats({ allProjects: true, profileBreakdown: true }));
    expect(all.all_projects).toBe(true);
    expect(all.rows.length).toBe(stats.rows.length);
  });

  test("registered extra coordinator threads count as coordination, legacy column included", async () => {
    const f = await fixture();
    await f.store.registerProject({
      name: "demo",
      rootPath: f.root,
      coordinatorThreadId: "thread-legacy",
    });
    await f.run(registerCoordinatorThread(f.projectId, "thread-extra"));
    await coordination(f, {
      key: "legacy",
      thread: "thread-legacy",
      model: "model-opus",
      ts: "2020-01-01T00:00:00.000Z",
      cost: 0.2,
    });
    await coordination(f, {
      key: "extra",
      thread: "thread-extra",
      model: "model-opus",
      ts: "2020-02-01T00:00:00.000Z",
      cost: 0.3,
    });

    const strategies = await f.run(strategyStats({ projectId: f.projectId }));
    const coordinationRow = strategies.rows.at(-1);
    expect(coordinationRow?.coordination).toBe(true);
    expect(coordinationRow?.cost_to_acceptance.value).toBeCloseTo(0.5, 12);

    const stats = await f.run(coordinatorStats({ projectId: f.projectId }));
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0]).toMatchObject({
      coordinator: "model-opus",
      tasks: 0,
      accepted: 0,
      n: 0,
      cost_per_accepted_task: null,
    });
    expect(stats.rows[0]?.coordination_cost.value).toBeCloseTo(0.5, 12);
  });

  test("names the price layer behind its costs, like every other stats view", async () => {
    const f = await fixture();
    await f.run(registerCoordinatorThread(f.projectId, "thread-meta"));
    await coordination(f, {
      key: "reported",
      thread: "thread-meta",
      model: "model-opus",
      ts: "2020-01-01T00:00:00.000Z",
      cost: 0.2,
    });
    // What `nf sync` writes when the price chain answered from OpenRouter.
    await coordination(f, {
      key: "chained",
      thread: "thread-meta",
      model: "model-deepseek",
      ts: "2020-02-01T00:00:00.000Z",
      cost: 0.05,
      source: "openrouter",
    });

    const stats = await f.run(coordinatorStats({ projectId: f.projectId }));
    expect(stats.price_sources).toEqual(["openrouter", "pi"]);
  });

  test("the telemetry coordinator grouping reports the same totals as nf stats", async () => {
    const f = await fixture();
    await coordinatedProject(f);

    const stats = await f.run(coordinatorStats({ projectId: f.projectId }));
    const view = await f.run(
      telemetryView({ projectId: f.projectId, groupBy: "coordinator", at: AT }),
    );
    expect(view.groupBy).toBe("coordinator");
    expect(view.rows.map((row) => row.entity.kind)).toEqual([
      "coordinator",
      "coordinator",
      "coordinator",
      "coordination",
    ]);

    for (const row of stats.rows) {
      const entity = view.rows.find(
        (candidate) => candidate.entity.id === (row.coordinator ?? "(unknown)"),
      );
      expect(entity?.tasks).toBe(row.tasks);
      expect(entity?.n).toBe(row.n);
      expect(entity?.firstPass.total).toBe(row.n);
      expect(entity?.firstPass.accepted).toBe(row.first_pass);
      expect(entity?.repairs).toBe(row.repairs);
      expect(entity?.costToAcceptance.value).toBe(row.worker_cost.value);
    }

    const workerCost = stats.rows.reduce((sum, row) => sum + (row.worker_cost.value ?? 0), 0);
    const coordinationCost = stats.rows.reduce(
      (sum, row) => sum + (row.coordination_cost.value ?? 0),
      0,
    );
    expect(view.totals.costToAcceptance.value).toBeCloseTo(workerCost, 12);
    expect(view.totals.coordination.cost.value).toBeCloseTo(coordinationCost, 12);
    expect(view.totals.tasks).toBe(4);
    expect(view.totals.n).toBe(3);
    expect(view.totals.firstPass).toEqual({ accepted: 2, total: 3 });
    expect(view.totals.repairs).toBe(1);
    expect(view.totals.coordination.spawns).toBe(0);

    // The two coordinating models split the coordination turns they ran on the one thread.
    const opus = view.rows.find((row) => row.entity.id === "model-opus");
    expect(opus?.costToAcceptance.value).toBeCloseTo(0.502, 12);
    const deepseek = view.rows.find((row) => row.entity.id === "model-deepseek");
    expect(deepseek?.costToAcceptance.value).toBeCloseTo(0.1, 12);
  });
});
