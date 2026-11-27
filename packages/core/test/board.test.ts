import { afterEach, describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { TaskView, boardViews } from "../src/index.ts";
import type { TaskView as TaskViewType } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { addTask, cleanupAll, fixture, passAll, startImpl, tempDir } from "./helpers.ts";
import { delegatedThreadId, run, t3State, thread, turnItem, waitingRequest } from "./t3-state.ts";

afterEach(cleanupAll);

const decodeTaskViews = Schema.decodeSync(Schema.Array(TaskView));
const AT = "2026-01-01T12:00:00.000Z";

interface EventOptions {
  key: string;
  attemptId: string;
  ts: string;
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cost?: number | null;
  quality?: "reported" | "estimated" | "unknown";
  sourceKey?: string;
}

/** A stored usage event; unknown token or cost fields stay NULL. */
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
    options.sourceKey ?? `t3:turn:${options.key}`,
    f.store.machine,
    "thread-a",
    "uuid-a",
    "run-1",
    `turn-${options.key}`,
    "pi",
    "model-x",
    options.ts,
    options.input ?? null,
    options.output ?? null,
    options.cacheRead ?? null,
    null,
    null,
    "complete",
    0,
    options.cost ?? null,
    quality,
    quality === "reported" ? "pi" : quality === "estimated" ? "litellm" : null,
    null,
    options.attemptId,
    "attempt",
    options.ts,
  );
}

/** Backdate an attempt so liveness has something to reason about; the store always starts it now. */
async function backdate(f: Fixture, attemptKey: string, startedAt: string): Promise<void> {
  await f.sql(`UPDATE attempts SET started_at = ? WHERE key = ?`, startedAt, attemptKey);
}

async function views(f: Fixture): Promise<readonly TaskViewType[]> {
  return f.run(boardViews(f.projectId, AT));
}

describe("board views", () => {
  test("maps tasks, dependencies, acceptance and attempts to the board contract", async () => {
    const f = await fixture();
    const first = await addTask(f, {
      title: "First",
      goal: "Ship the first slice",
      profile: "bounded",
      acceptance: ["it builds", "it ships"],
    });
    await f.store.checkItem(f.projectId, first.key, 1, "pass", "bun run verify");
    const second = await addTask(f, {
      title: "Second",
      dependsOn: [first.key],
      acceptance: ["after the first"],
    });
    const third = await addTask(f, { title: "Third", dependsOn: [second.key] });

    const attempt = await startImpl(f, first.key, {
      provider: "pi",
      model: "deepseek-x",
      options: { thinking: "max" },
      reason: "cheapest route",
      contextMode: "fork",
      sourceThread: "thread-origin",
    });
    await f.store.updateAttempt(f.projectId, attempt.key, {
      thread_id: "thread-1",
      thread_link: "t3-thread://v2/env/thread-1",
      executed_model: "deepseek-y",
      addCommits: ["abc1234"],
      addChecks: [{ command: "bun test", result: "pass", detail: "12 tests" }],
    });
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded" });
    const repair = await startImpl(f, first.key, { repairOf: attempt.key });
    const review = await startImpl(f, first.key, { kind: "review" });
    for (const key of [repair.key, review.key]) {
      await f.store.finishAttempt(f.projectId, key, { status: "succeeded" });
    }
    await passAll(f, first.key);
    await f.store.setStatus(f.projectId, first.key, "working");
    await f.store.setStatus(f.projectId, first.key, "review");
    await f.store.acceptTask(f.projectId, first.key);
    await f.store.intervene(f.projectId, first.key, "nudge");

    const [a, b, c] = await views(f);
    expect([a?.id, b?.id, c?.id]).toEqual([first.key, second.key, third.key]);
    expect(a).toMatchObject({
      id: "T-001",
      title: "First",
      goal: "Ship the first slice",
      project: "demo",
      status: "done",
      profile: "bounded",
      acceptedFirstPass: false,
      counts: { attempts: 3, repairs: 1, reviews: 1, humanInterventions: 1 },
    });
    expect(a?.ready).toBeUndefined();
    expect(a?.acceptance).toEqual([
      { text: "it builds", result: "pass", evidence: "ok" },
      { text: "it ships", result: "pass", evidence: "ok" },
    ]);
    expect(b?.dependsOn).toEqual([{ id: "T-001", title: "First", status: "done" }]);
    expect(b?.ready).toBe(true);
    expect(c?.ready).toBe(false);

    const [configured, repaired, reviewed] = a?.attempts ?? [];
    expect(configured).toMatchObject({
      id: attempt.key,
      kind: "implementation",
      status: "succeeded",
      profile: "bounded",
      configured: {
        provider: "pi",
        model: "deepseek-x",
        effort: { name: "thinking", value: "max" },
      },
      executed: {
        provider: "pi",
        model: "deepseek-y",
        effort: { name: "thinking", value: "max" },
      },
      contextMode: "fork",
      sourceThread: { id: "thread-origin" },
      reason: "cheapest route",
      thread: { id: "thread-1", href: "t3-thread://v2/env/thread-1" },
      startedAt: expect.any(String),
      endedAt: expect.any(String),
      liveness: "finished",
      checks: [{ name: "bun test", result: "pass", note: "12 tests" }],
      commits: ["abc1234"],
    });
    expect(repaired?.repairOf).toBe(attempt.key);
    expect(reviewed?.kind).toBe("review");
    expect(reviewed?.executed).toBeUndefined();
  });

  test("prefixed task and attempt keys reach the board views", async () => {
    const f = await fixture();
    const project = (await f.store.registerProject({ name: "nf-stack", rootPath: tempDir() }))
      .project;
    const task = await f.store.addTask(project.id, {
      title: "Prefixed",
      goal: "keys carry the project prefix",
      acceptance: ["NF-001"],
    });
    const attempt = await f.store.startAttempt(project.id, "T-001", {
      kind: "implementation",
      mechanism: "direct",
    });
    const [view] = decodeTaskViews(await f.run(boardViews(project.id, AT)));
    expect(task.key).toBe("NF-001");
    expect(attempt.key).toBe("NF-001-A1");
    expect(view?.id).toBe("NF-001");
    expect(view?.attempts[0]?.id).toBe("NF-001-A1");
  });

  test("usage is measured, estimated or unknown, and never prices subagent aggregates", async () => {
    const f = await fixture();
    const task = await addTask(f, { title: "Usage" });
    const priced = await startImpl(f, task.key);
    await f.store.finishAttempt(f.projectId, priced.key, { status: "succeeded" });
    const unpriced = await startImpl(f, task.key, { repairOf: priced.key });
    await f.store.finishAttempt(f.projectId, unpriced.key, {
      status: "failed",
      failure_class: "timeout",
      failure_detail: "the provider hung",
      retry_at: "2026-01-02T09:00:00.000Z",
    });

    await event(f, {
      key: "a",
      attemptId: priced.id,
      ts: "2026-01-01T11:00:00.000Z",
      input: 100,
      output: 10,
      cacheRead: 1000,
      cost: 0.5,
      quality: "reported",
    });
    await event(f, {
      key: "b",
      attemptId: priced.id,
      ts: "2026-01-01T11:01:00.000Z",
      input: 50,
      output: 5,
      cost: 0.25,
      quality: "estimated",
    });
    await event(f, {
      key: "agg",
      attemptId: priced.id,
      ts: "2026-01-01T11:02:00.000Z",
      input: 100_000,
      output: 100_000,
      sourceKey: "t3:sub:aggregate",
    });
    await event(f, {
      key: "c",
      attemptId: unpriced.id,
      ts: "2026-01-01T11:03:00.000Z",
      input: 7,
      output: 1,
      cost: null,
    });

    const [view] = await views(f);
    const [first, second] = view?.attempts ?? [];
    expect(first?.usage?.costUsd).toEqual({ value: 0.75, quality: "estimated", source: "litellm" });
    expect(first?.usage?.inputTokens).toEqual({ value: 150, quality: "measured" });
    expect(first?.usage?.outputTokens).toEqual({ value: 15, quality: "measured" });
    expect(first?.usage?.cacheReadTokens).toEqual({ value: 1000, quality: "measured" });
    expect(first?.usage?.durationMs?.quality).toBe("derived");
    expect(second?.usage?.costUsd).toEqual({ value: null, quality: "unknown" });
    expect(second?.usage?.inputTokens).toEqual({ value: 7, quality: "measured" });
    expect(second?.blocker).toEqual({
      kind: "timeout",
      summary: "the provider hung",
      retryAt: "2026-01-02T09:00:00.000Z",
    });
    expect(view?.usage?.costUsd).toEqual({ value: 0.75, quality: "estimated", source: "litellm" });
    expect(view?.usage?.inputTokens.value).toBe(157);
    expect(view?.counts).toEqual({ attempts: 2, repairs: 1, reviews: 0, humanInterventions: 0 });
  });

  test("a task without usage events reports no usage instead of zero", async () => {
    const f = await fixture();
    const task = await addTask(f);
    const attempt = await startImpl(f, task.key);
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded" });
    await passAll(f, task.key);
    await f.store.setStatus(f.projectId, task.key, "working");
    await f.store.setStatus(f.projectId, task.key, "review");
    await f.store.acceptTask(f.projectId, task.key);
    const [view] = await views(f);
    expect(view?.usage).toBeUndefined();
    expect(view?.attempts[0]?.usage).toBeUndefined();
    expect(view?.acceptedFirstPass).toBe(true);
  });

  test("liveness follows the live status and the newest activity", async () => {
    const f = await fixture();
    const running = await addTask(f, { title: "Running" });
    const recent = (await startImpl(f, running.key)).id;
    await f.store.updateAttempt(f.projectId, "T-001-A1", { status: "active" });
    await backdate(f, "T-001-A1", "2026-01-01T11:00:00.000Z");
    await event(f, {
      key: "recent",
      attemptId: recent,
      ts: "2026-01-01T11:55:00.000Z",
      input: 10,
      cost: 0.01,
    });

    const idleTask = await addTask(f, { title: "Idle" });
    const idle = (await startImpl(f, idleTask.key)).id;
    await f.store.updateAttempt(f.projectId, "T-002-A1", { status: "active" });
    await backdate(f, "T-002-A1", "2026-01-01T08:00:00.000Z");
    await event(f, {
      key: "idle",
      attemptId: idle,
      ts: "2026-01-01T10:00:00.000Z",
      input: 10,
      cost: 0.01,
    });

    const deadTask = await addTask(f, { title: "Dead" });
    await startImpl(f, deadTask.key);
    await f.store.updateAttempt(f.projectId, "T-003-A1", { status: "active" });
    await backdate(f, "T-003-A1", "2025-12-30T08:00:00.000Z");

    const [a, b, c] = await views(f);
    expect(a?.attempts[0]).toMatchObject({
      liveness: "running",
      lastActivityAt: "2026-01-01T11:55:00.000Z",
    });
    expect(a?.activeAttemptId).toBe("T-001-A1");
    expect(b?.attempts[0]).toMatchObject({
      liveness: "idle",
      lastActivityAt: "2026-01-01T10:00:00.000Z",
    });
    expect(b?.activeAttemptId).toBe("T-002-A1");
    expect(c?.attempts[0]).toMatchObject({ liveness: "suspect_dead" });
    expect(c?.attempts[0]?.lastActivityAt).toBeUndefined();
    expect(c?.activeAttemptId).toBe("T-003-A1");
  });

  test("liveness comes from T3's projections when the state database is given", async () => {
    const f = await fixture();
    const waiting = await addTask(f, { title: "Waiting" });
    await f.store.setStatus(f.projectId, waiting.key, "working");
    await startImpl(f, waiting.key);
    await f.store.updateAttempt(f.projectId, "T-001-A1", {
      status: "active",
      thread_id: "thread-live",
    });
    await backdate(f, "T-001-A1", "2026-01-01T11:55:00.000Z");

    const gone = await addTask(f, { title: "Gone" });
    await startImpl(f, gone.key);
    await f.store.updateAttempt(f.projectId, "T-002-A1", {
      status: "active",
      thread_id: "thread-gone",
    });

    const state = t3State();
    thread(state.db, "thread-live");
    run(state.db, {
      id: "run-live",
      thread: "thread-live",
      ordinal: 1,
      status: "running",
      requestedAt: "2026-01-01T11:50:00.000Z",
    });
    turnItem(state.db, {
      id: "item-live",
      thread: "thread-live",
      run: "run-live",
      updatedAt: "2026-01-01T11:59:00.000Z",
    });
    waitingRequest(state.db, {
      id: "request-live",
      thread: "thread-live",
      node: "node-live",
      run: "run-live",
      createdAt: "2026-01-01T11:58:00.000Z",
    });
    state.db.close();

    const [a, b] = await f.run(boardViews(f.projectId, AT, { t3State: state.file }));
    expect(a?.attempts[0]).toMatchObject({
      liveness: "waiting_input",
      lastActivityAt: "2026-01-01T11:58:00.000Z",
    });
    expect(a?.attempts[0]?.livenessEvidence).toBe("Waiting for user input for 2 minutes");
    expect(b?.attempts[0]).toMatchObject({
      liveness: "suspect_dead",
      livenessEvidence: "Its conversation is no longer in T3",
    });
    expect(b?.attempts[0]?.lastActivityAt).toBeUndefined();

    // Without the source the recorded heuristic still answers from the attempt's own timing.
    const [c] = await views(f);
    expect(c?.attempts[0]?.liveness).toBe("running");
    expect(c?.attempts[0]?.livenessEvidence).toBeUndefined();
  });

  test("a dispatched attempt is live from its delegated thread before the binding is recorded", async () => {
    const f = await fixture();
    await addTask(f, { title: "Delegated" });
    await startImpl(f, "T-001", { clientRequestId: "demo-T-001-A1" });

    const state = t3State();
    const threadId = delegatedThreadId("demo-T-001-A1");
    thread(state.db, threadId);
    run(state.db, {
      id: "run-delegated",
      thread: threadId,
      ordinal: 1,
      status: "running",
      requestedAt: "2026-01-01T11:50:00.000Z",
    });
    turnItem(state.db, {
      id: "item-delegated",
      thread: threadId,
      run: "run-delegated",
      updatedAt: "2026-01-01T11:59:00.000Z",
    });
    state.db.close();

    const [view] = await f.run(boardViews(f.projectId, AT, { t3State: state.file }));
    expect(view?.attempts[0]).toMatchObject({
      status: "dispatching",
      liveness: "running",
      lastActivityAt: "2026-01-01T11:59:00.000Z",
    });
    // The board reads the binding from T3 without recording it.
    expect(await f.store.getAttempt(f.projectId, "T-001-A1")).toMatchObject({
      status: "dispatching",
      thread_id: null,
    });

    // A dispatch T3 never turned into a thread past the stall window is flagged, not hidden.
    const unbound = await addTask(f, { title: "Unbound" });
    await startImpl(f, unbound.key, { clientRequestId: "demo-T-002-A1" });
    await f.sql(
      "UPDATE attempts SET started_at = ? WHERE key = 'T-002-A1'",
      "2025-12-30T08:00:00.000Z",
    );
    const [, stale] = await f.run(boardViews(f.projectId, AT, { t3State: state.file }));
    expect(stale?.attempts[0]).toMatchObject({ status: "dispatching", liveness: "suspect_dead" });
    expect(stale?.attempts[0]?.livenessEvidence).toBe("Sent 52 hours ago, but T3 never started it");
  });

  test("the views decode against the board contract schema", async () => {
    const f = await fixture();
    const task = await addTask(f, { dependsOn: [] });
    const attempt = await startImpl(f, task.key);
    await f.store.finishAttempt(f.projectId, attempt.key, { status: "failed" });
    await event(f, { key: "x", attemptId: attempt.id, ts: "2026-01-01T11:00:00.000Z", cost: null });
    const decoded = decodeTaskViews(await views(f));
    expect(decoded[0]?.attempts[0]?.blocker).toBeUndefined();
    expect(decoded[0]?.attempts[0]?.usage?.costUsd.quality).toBe("unknown");
  });
});
