import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ATTEMPT_FAILURE, attemptLiveness, runFailureClass } from "../src/index.ts";
import type { AttemptLivenessReport } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { cleanupAll, fixture } from "./helpers.ts";
import type { T3State } from "./t3-state.ts";
import {
  delegation,
  delegatedThreadId,
  providerTurn,
  run,
  sentFollowUp,
  t3State,
  thread,
  turnItem,
  waitingRequest,
} from "./t3-state.ts";

afterEach(cleanupAll);

const NOW = Date.now();
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

interface AttemptSpec {
  thread: string | null;
  mechanism?: "delegate_task" | "thread_send_reuse";
  contextMode?: "fresh" | "reuse";
}

/** One task with a live research attempt per spec: research does not take the writing slot. */
async function project(specs: readonly AttemptSpec[]): Promise<Fixture> {
  const f = await fixture();
  await f.store.addTask(f.projectId, {
    title: "Live work",
    goal: "judge liveness",
    acceptance: ["it works"],
  });
  for (const spec of specs) {
    const attempt = await f.store.startAttempt(f.projectId, "T-001", {
      kind: "research",
      mechanism: spec.mechanism ?? "delegate_task",
      contextMode: spec.contextMode ?? "fresh",
      model: "gpt-x",
      reason: "test",
    });
    await f.store.updateAttempt(f.projectId, attempt.key, {
      status: "active",
      thread_id: spec.thread,
    });
  }
  return f;
}

function judge(f: Fixture, state: string, over: { apply?: boolean; stallMinutes?: number } = {}) {
  return f.run(attemptLiveness(f.projectId, { t3State: state, now: new Date(NOW), ...over }));
}

function byKey(
  result: AttemptLivenessReport,
): Map<string, AttemptLivenessReport["attempts"][number]> {
  return new Map(result.attempts.map((a) => [a.attempt, a]));
}

/** All six classes at once, from one state database. */
async function classifyAll(state: T3State): Promise<Fixture> {
  thread(state.db, "thread-running");
  run(state.db, {
    id: "run-running",
    thread: "thread-running",
    ordinal: 1,
    status: "running",
    requestedAt: minutesAgo(30),
  });
  turnItem(state.db, {
    id: "item-running",
    thread: "thread-running",
    run: "run-running",
    updatedAt: minutesAgo(2),
  });

  thread(state.db, "thread-stalled");
  run(state.db, {
    id: "run-stalled",
    thread: "thread-stalled",
    ordinal: 1,
    status: "running",
    requestedAt: minutesAgo(90),
  });
  turnItem(state.db, {
    id: "item-stalled",
    thread: "thread-stalled",
    run: "run-stalled",
    updatedAt: minutesAgo(45),
  });

  thread(state.db, "thread-waiting");
  run(state.db, {
    id: "run-waiting",
    thread: "thread-waiting",
    ordinal: 1,
    status: "running",
    requestedAt: minutesAgo(20),
  });
  turnItem(state.db, {
    id: "item-waiting",
    thread: "thread-waiting",
    run: "run-waiting",
    updatedAt: minutesAgo(3),
  });
  waitingRequest(state.db, {
    id: "request-1",
    thread: "thread-waiting",
    node: "node-waiting",
    run: "run-waiting",
    createdAt: minutesAgo(4),
  });

  thread(state.db, "thread-ok");
  run(state.db, {
    id: "run-ok",
    thread: "thread-ok",
    ordinal: 1,
    status: "completed",
    requestedAt: minutesAgo(60),
    completedAt: minutesAgo(30),
  });

  thread(state.db, "thread-failed");
  run(state.db, {
    id: "run-failed",
    thread: "thread-failed",
    ordinal: 1,
    status: "failed",
    requestedAt: minutesAgo(120),
    completedAt: minutesAgo(100),
  });
  turnItem(state.db, {
    id: "item-failed",
    thread: "thread-failed",
    run: "run-failed",
    updatedAt: minutesAgo(100),
    type: "error",
    failure: {
      class: "provider_error",
      message: "429: Usage limit reached for 5 hour, your limit will reset at 2026-11-16 06:54.",
    },
  });

  // Its last run ended before the attempt started, so a reuse attempt has no run of its own yet.
  thread(state.db, "thread-reuse");
  run(state.db, {
    id: "run-reuse",
    thread: "thread-reuse",
    ordinal: 1,
    status: "completed",
    requestedAt: minutesAgo(300),
    completedAt: minutesAgo(240),
  });

  return project([
    { thread: "thread-running" },
    { thread: "thread-stalled" },
    { thread: "thread-waiting" },
    { thread: "thread-ok" },
    { thread: "thread-failed" },
    { thread: "thread-gone" },
    { thread: "thread-reuse", mechanism: "thread_send_reuse", contextMode: "reuse" },
  ]);
}

describe("attempt liveness from T3's projections", () => {
  test("classifies running, stalled, waiting_input, finished_ok, finished_failed and missing", async () => {
    const state = t3State();
    const f = await classifyAll(state);
    state.db.close();
    const result = await judge(f, state.file);
    const attempts = byKey(result);
    expect([...attempts.keys()]).toEqual([
      "T-001-A1",
      "T-001-A2",
      "T-001-A3",
      "T-001-A4",
      "T-001-A5",
      "T-001-A6",
      "T-001-A7",
    ]);
    expect(attempts.get("T-001-A1")).toMatchObject({
      liveness: "running",
      task: "T-001",
      run_status: "running",
      run_id: "run-running",
      last_activity_at: minutesAgo(2),
    });
    expect(attempts.get("T-001-A1")?.evidence).toContain("run 1 running");
    expect(attempts.get("T-001-A1")?.reason).toBe("Run 1 is running; last turn item 2 minutes ago");
    expect(attempts.get("T-001-A2")).toMatchObject({
      liveness: "stalled",
      run_id: "run-stalled",
      last_activity_at: minutesAgo(45),
    });
    expect(attempts.get("T-001-A2")?.reason).toBe("No activity for 45 minutes; run 1 still open");
    expect(attempts.get("T-001-A3")).toMatchObject({
      liveness: "waiting_input",
      waiting_input: { kind: "user_input", created_at: minutesAgo(4) },
    });
    expect(attempts.get("T-001-A3")?.evidence).toContain("request-1");
    expect(attempts.get("T-001-A3")?.reason).toBe("Waiting for user input for 4 minutes");
    expect(attempts.get("T-001-A4")).toMatchObject({
      liveness: "finished_ok",
      run_status: "completed",
      last_activity_at: minutesAgo(30),
    });
    expect(attempts.get("T-001-A4")?.reason).toBe("Run 1 completed 30 minutes ago");
    expect(attempts.get("T-001-A5")).toMatchObject({
      liveness: "finished_failed",
      failure: {
        class: "quota",
        message: "429: Usage limit reached for 5 hour, your limit will reset at 2026-11-16 06:54.",
      },
    });
    expect(attempts.get("T-001-A5")?.evidence).toContain("run 1 failed");
    expect(attempts.get("T-001-A5")?.reason).toBe("Run 1 failed 1 hour ago");
    expect(attempts.get("T-001-A6")).toMatchObject({
      liveness: "missing",
      thread_id: "thread-gone",
      run_id: null,
      last_activity_at: null,
    });
    expect(attempts.get("T-001-A6")?.reason).toBe("Its conversation is no longer in T3");
    expect(attempts.get("T-001-A7")).toMatchObject({ liveness: "running", run_id: null });
    expect(attempts.get("T-001-A7")?.evidence).toContain("no run requested since the attempt");
    expect(attempts.get("T-001-A7")?.reason).toBe("T3 has not started this send yet");
    expect(attempts.get("T-001-A7")?.run_status).toBeNull();
    expect(result.applied).toBe(false);
    expect(result.stall_minutes).toBe(20);
    expect(result.warnings).toEqual([]);
    // Read-only: the changes listed are the ones --apply would make.
    expect(result.changes).toEqual([
      { attempt: "T-001-A5", from: "active", to: "failed", liveness: "finished_failed" },
      { attempt: "T-001-A6", from: "active", to: "unknown", liveness: "missing" },
    ]);
  });

  test("the stall threshold is an option; the classes do not change", async () => {
    const state = t3State();
    const f = await classifyAll(state);
    state.db.close();
    const result = await judge(f, state.file, { stallMinutes: 120 });
    expect(byKey(result).get("T-001-A2")).toMatchObject({ liveness: "running" });
    expect(result.stall_minutes).toBe(120);
  });

  test("read-only records nothing in the store", async () => {
    const state = t3State();
    const f = await classifyAll(state);
    state.db.close();
    const before = await f.sql<{ n: number }>("SELECT COUNT(*) AS n FROM task_events");
    await judge(f, state.file);
    const after = await f.sql<{ n: number }>("SELECT COUNT(*) AS n FROM task_events");
    expect(after[0]?.n).toBe(before[0]?.n);
    const attempts = await f.store.listAttempts(f.projectId, "T-001");
    expect(attempts.map((a) => a.status)).toEqual(Array(7).fill("active"));
  });

  test("--apply marks missing as unknown and a finished failure as failed, never a success", async () => {
    const state = t3State();
    const f = await classifyAll(state);
    state.db.close();
    const result = await judge(f, state.file, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.changes).toEqual([
      { attempt: "T-001-A5", from: "active", to: "failed", liveness: "finished_failed" },
      { attempt: "T-001-A6", from: "active", to: "unknown", liveness: "missing" },
    ]);
    const attempts = new Map(
      (await f.store.listAttempts(f.projectId, "T-001")).map((a) => [a.key, a]),
    );
    expect(attempts.get("T-001-A5")).toMatchObject({
      status: "failed",
      failure_class: "quota",
      failure_detail:
        "429: Usage limit reached for 5 hour, your limit will reset at 2026-11-16 06:54.",
    });
    expect(attempts.get("T-001-A6")).toMatchObject({ status: "unknown", failure_class: null });
    for (const key of ["T-001-A1", "T-001-A2", "T-001-A3", "T-001-A4", "T-001-A7"]) {
      expect(attempts.get(key)?.status).toBe("active");
    }
    const task = await f.store.getTask(f.projectId, "T-001");
    expect(task.status).toBe("todo");
    const events = await f.sql<{ kind: string; note: string | null }>(
      `SELECT kind, note FROM task_events ORDER BY rowid`,
    );
    expect(events.slice(-2)).toEqual([
      { kind: "attempt_finished", note: "T-001-A5" },
      { kind: "attempt_updated", note: "T-001-A6: status active->unknown" },
    ]);
    // Applying the same report again finds nothing left to change.
    const again = await judge(f, state.file, { apply: true });
    expect(again.changes).toEqual([]);
    expect(again.attempts.find((a) => a.attempt === "T-001-A6")).toMatchObject({
      status: "unknown",
      liveness: "missing",
    });
  });

  test("a reuse attempt is judged by runs requested after it started", async () => {
    const started = t3State();
    thread(started.db, "thread-shared");
    run(started.db, {
      id: "run-old",
      thread: "thread-shared",
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(400),
      completedAt: minutesAgo(390),
    });
    const f = await project([
      { thread: "thread-shared", mechanism: "thread_send_reuse", contextMode: "reuse" },
    ]);
    started.db.close();
    // Started after its thread's only run ended: T3 has not started the reuse run yet.
    await f.sql("UPDATE attempts SET started_at = ? WHERE key = 'T-001-A1'", minutesAgo(200));
    const queued = await judge(f, started.file);
    expect(byKey(queued).get("T-001-A1")).toMatchObject({ liveness: "running", run_id: null });

    // T3 starts the reuse run for the send: the same attempt now follows it.
    const later = t3State();
    thread(later.db, "thread-shared");
    run(later.db, {
      id: "run-queued",
      thread: "thread-shared",
      ordinal: 2,
      status: "running",
      requestedAt: minutesAgo(10),
    });
    turnItem(later.db, {
      id: "item-queued",
      thread: "thread-shared",
      run: "run-queued",
      updatedAt: minutesAgo(1),
    });
    later.db.close();
    await f.sql("UPDATE attempts SET started_at = ? WHERE key = 'T-001-A1'", minutesAgo(15));
    const own = await judge(f, later.file);
    expect(byKey(own).get("T-001-A1")).toMatchObject({
      liveness: "running",
      run_id: "run-queued",
      last_activity_at: minutesAgo(1),
    });
  });

  test("a deleted thread is missing and a silent run falls back to its request time", async () => {
    const state = t3State();
    thread(state.db, "thread-deleted", { deletedAt: minutesAgo(5) });
    run(state.db, {
      id: "run-deleted",
      thread: "thread-deleted",
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(10),
    });
    thread(state.db, "thread-bare");
    run(state.db, {
      id: "run-bare",
      thread: "thread-bare",
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(60),
    });
    providerTurn(state.db, {
      id: "turn-bare",
      thread: "thread-bare",
      node: "node-bare",
      run: "run-bare",
      completedAt: minutesAgo(50),
    });
    const f = await project([{ thread: "thread-deleted" }, { thread: "thread-bare" }]);
    state.db.close();
    const result = await judge(f, state.file);
    expect(byKey(result).get("T-001-A1")).toMatchObject({ liveness: "missing" });
    expect(byKey(result).get("T-001-A1")?.evidence).toContain("deleted");
    expect(byKey(result).get("T-001-A1")?.reason).toBe(
      "Its conversation was deleted 5 minutes ago",
    );
    // No turn item or message, but a provider turn ran 50 minutes ago: still stalled.
    expect(byKey(result).get("T-001-A2")).toMatchObject({
      liveness: "stalled",
      last_activity_at: minutesAgo(50),
    });
    expect(byKey(result).get("T-001-A2")?.evidence).toContain("provider turn");
  });

  test("a missing state database fails loudly, or degrades when best effort", async () => {
    const f = await project([{ thread: "thread-x" }]);
    const missing = join(f.home, "absent", "statev2.sqlite");
    const failure = await f
      .run(attemptLiveness(f.projectId, { t3State: missing, now: new Date(NOW) }))
      .then(
        () => null,
        (error: { message: string }) => error,
      );
    expect(failure?.message).toContain("source database not found");
    const best = await f.run(
      attemptLiveness(f.projectId, { t3State: missing, now: new Date(NOW), bestEffort: true }),
    );
    expect(best.attempts[0]).toMatchObject({
      liveness: null,
      thread_id: "thread-x",
      evidence: "the T3 state database could not be read",
    });
    expect(best.changes).toEqual([]);
    expect(best.warnings[0]).toContain("T3 state unavailable");
  });

  test("a state database without the liveness projections is a schema error", async () => {
    const f = await project([{ thread: "thread-x" }]);
    const empty = join(f.home, "empty.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(empty);
    db.exec("CREATE TABLE unrelated (id TEXT)");
    db.close();
    const failure = await f
      .run(attemptLiveness(f.projectId, { t3State: empty, now: new Date(NOW) }))
      .then(
        () => null,
        (error: { message: string }) => error,
      );
    expect(failure?.message).toContain("has no orchestration_v2_projection_threads table");
  });
});

/** One task with a dispatching attempt, dispatched as `delegate_task` with this client id. */
async function dispatch(clientRequestId: string | null): Promise<Fixture> {
  const f = await fixture();
  await f.store.addTask(f.projectId, {
    title: "Delegated work",
    goal: "bind the dispatch",
    acceptance: ["it works"],
  });
  await f.store.startAttempt(f.projectId, "T-001", {
    kind: "implementation",
    mechanism: "delegate_task",
    clientRequestId,
  });
  return f;
}

const COORDINATOR = "thread-coordinator";

/** One research dispatch per client request id, commanded by `coordinator` when it is known. */
async function dispatchedByCoordinator(
  clientRequestIds: readonly string[],
  coordinator: string | null = COORDINATOR,
): Promise<Fixture> {
  const f = await fixture();
  if (coordinator !== null) {
    await f.sql(
      "INSERT INTO coordinator_threads (project_id, thread_id, created_at) VALUES (?,?,?)",
      f.projectId,
      coordinator,
      new Date().toISOString(),
    );
  }
  await f.store.addTask(f.projectId, { title: "Delegated", goal: "g", acceptance: ["a"] });
  for (const clientRequestId of clientRequestIds) {
    await f.store.startAttempt(f.projectId, "T-001", {
      kind: "research",
      mechanism: "delegate_task",
      clientRequestId,
    });
  }
  return f;
}

/** The child thread of a dispatch T3 recorded with this brief, running since a minute ago. */
function dispatchedThread(
  state: T3State,
  clientRequestId: string,
  prompt: string,
  parent = COORDINATOR,
): string {
  const child = delegatedThreadId(clientRequestId);
  thread(state.db, child);
  run(state.db, {
    id: `run-${clientRequestId}`,
    thread: child,
    ordinal: 1,
    status: "running",
    requestedAt: minutesAgo(5),
  });
  turnItem(state.db, {
    id: `item-${clientRequestId}`,
    thread: child,
    run: `run-${clientRequestId}`,
    updatedAt: minutesAgo(1),
  });
  delegation(state.db, {
    id: `node-${clientRequestId}`,
    parent,
    child,
    prompt,
  });
  return child;
}

describe("binding a follow-up attempt to the run its send created", () => {
  test("three attempts in one conversation are judged by their own runs", async () => {
    const state = t3State();
    const f = await project([
      { thread: null, mechanism: "thread_send_reuse", contextMode: "reuse" },
      { thread: null, mechanism: "thread_send_reuse", contextMode: "reuse" },
      { thread: null, mechanism: "thread_send_reuse", contextMode: "reuse" },
    ]);
    await f.sql("UPDATE attempts SET started_at = ?, status = 'dispatching'", minutesAgo(60));
    const conversation = "thread-conversation";
    thread(state.db, conversation);
    // Earlier work in the conversation, before any of the three attempts started.
    run(state.db, {
      id: "run-earlier",
      thread: conversation,
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(400),
      completedAt: minutesAgo(390),
    });
    run(state.db, {
      id: "run-finished",
      thread: conversation,
      ordinal: 2,
      status: "completed",
      requestedAt: minutesAgo(50),
      completedAt: minutesAgo(40),
    });
    run(state.db, {
      id: "run-running",
      thread: conversation,
      ordinal: 3,
      status: "running",
      requestedAt: minutesAgo(30),
    });
    turnItem(state.db, {
      id: "item-running",
      thread: conversation,
      run: "run-running",
      updatedAt: minutesAgo(2),
    });
    run(state.db, {
      id: "run-waiting",
      thread: conversation,
      ordinal: 4,
      status: "running",
      requestedAt: minutesAgo(20),
    });
    turnItem(state.db, {
      id: "item-waiting",
      thread: conversation,
      run: "run-waiting",
      updatedAt: minutesAgo(3),
    });
    waitingRequest(state.db, {
      id: "request-follow-up",
      thread: conversation,
      node: "node-waiting",
      run: "run-waiting",
      createdAt: minutesAgo(4),
    });
    // A send whose id merely starts with A1's must never speak for A1.
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A10",
      thread: conversation,
      run: "run-waiting",
      createdAt: minutesAgo(20),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A1",
      thread: conversation,
      run: "run-finished",
      createdAt: minutesAgo(50),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A2",
      thread: conversation,
      run: "run-running",
      createdAt: minutesAgo(30),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A3",
      thread: conversation,
      run: "run-waiting",
      createdAt: minutesAgo(20),
    });
    state.db.close();

    const read = await judge(f, state.file);
    const attempts = byKey(read);
    // The newest run after every start is run-waiting; each attempt still has its own.
    expect(attempts.get("T-001-A1")).toMatchObject({
      liveness: "finished_ok",
      thread_id: conversation,
      run_id: "run-finished",
    });
    expect(attempts.get("T-001-A2")).toMatchObject({
      liveness: "running",
      thread_id: conversation,
      run_id: "run-running",
      last_activity_at: minutesAgo(2),
    });
    expect(attempts.get("T-001-A3")).toMatchObject({
      liveness: "waiting_input",
      thread_id: conversation,
      run_id: "run-waiting",
      waiting_input: { kind: "user_input", created_at: minutesAgo(4) },
    });
    expect(read.changes).toEqual([
      { attempt: "T-001-A2", from: "dispatching", to: "active", liveness: "running" },
      { attempt: "T-001-A3", from: "dispatching", to: "active", liveness: "waiting_input" },
    ]);

    await judge(f, state.file, { apply: true });
    const stored = new Map(
      (await f.store.listAttempts(f.projectId, "T-001")).map((attempt) => [attempt.key, attempt]),
    );
    for (const key of ["T-001-A1", "T-001-A2", "T-001-A3"]) {
      expect(stored.get(key)?.thread_id).toBe(conversation);
    }
    expect(stored.get("T-001-A2")?.status).toBe("active");
    expect(stored.get("T-001-A3")?.status).toBe("active");
  });

  test("a send to a conversation the attempt does not use binds no run", async () => {
    const state = t3State();
    const f = await project([
      { thread: "thread-own", mechanism: "thread_send_reuse", contextMode: "reuse" },
    ]);
    await f.sql("UPDATE attempts SET started_at = ?", minutesAgo(10));
    thread(state.db, "thread-own");
    run(state.db, {
      id: "run-own",
      thread: "thread-own",
      ordinal: 3,
      status: "running",
      requestedAt: minutesAgo(2),
    });
    run(state.db, {
      id: "run-elsewhere",
      thread: "thread-other",
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(1),
      completedAt: minutesAgo(1),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A1",
      thread: "thread-other",
      run: "run-elsewhere",
      createdAt: minutesAgo(1),
    });
    state.db.close();

    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: "thread-own",
      run_id: "run-own",
    });
  });

  test("decodes the message id suffix and ignores one that cannot be decoded", async () => {
    const state = t3State();
    const f = await fixture();
    await f.store.addTask(f.projectId, { title: "Decoded", goal: "g", acceptance: ["a"] });
    const encoded = await f.store.startAttempt(f.projectId, "T-001", {
      kind: "research",
      mechanism: "thread_send_reuse",
      contextMode: "reuse",
      clientRequestId: "demo-T-001-A1",
    });
    const malformed = await f.store.startAttempt(f.projectId, "T-001", {
      kind: "research",
      mechanism: "thread_send_reuse",
      contextMode: "reuse",
      clientRequestId: "demo-T-001-A2%ZZ",
    });
    for (const key of [encoded.key, malformed.key]) {
      await f.store.updateAttempt(f.projectId, key, { status: "active", thread_id: "thread-sent" });
    }
    await f.sql("UPDATE attempts SET started_at = ?", minutesAgo(10));
    thread(state.db, "thread-sent");
    run(state.db, {
      id: "run-early",
      thread: "thread-sent",
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(100),
      completedAt: minutesAgo(90),
    });
    run(state.db, {
      id: "run-recent",
      thread: "thread-sent",
      ordinal: 2,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    turnItem(state.db, {
      id: "item-recent",
      thread: "thread-sent",
      run: "run-recent",
      updatedAt: minutesAgo(1),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001%2DA1",
      thread: "thread-sent",
      run: "run-early",
      createdAt: minutesAgo(100),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A2%ZZ",
      thread: "thread-sent",
      run: "run-early",
      createdAt: minutesAgo(99),
    });
    state.db.close();

    const attempts = byKey(await judge(f, state.file));
    expect(attempts.get("T-001-A1")).toMatchObject({
      liveness: "finished_ok",
      run_id: "run-early",
    });
    // A suffix that cannot be decoded names no send, so the started_at rule picks the run.
    expect(attempts.get("T-001-A2")).toMatchObject({
      liveness: "running",
      run_id: "run-recent",
    });
  });
});

describe("binding a delegated attempt to the thread T3 created", () => {
  test("binds in memory, and --apply records the thread and activates the dispatch", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    const threadId = delegatedThreadId("repo-T-001-A1");
    thread(state.db, threadId);
    run(state.db, {
      id: "run-delegated",
      thread: threadId,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    turnItem(state.db, {
      id: "item-delegated",
      thread: threadId,
      run: "run-delegated",
      updatedAt: minutesAgo(1),
    });
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({
      status: "dispatching",
      liveness: "running",
      thread_id: threadId,
      run_id: "run-delegated",
      last_activity_at: minutesAgo(1),
    });
    expect(read.changes).toEqual([
      { attempt: "T-001-A1", from: "dispatching", to: "active", liveness: "running" },
    ]);
    // The read binds in memory only.
    expect((await f.store.getAttempt(f.projectId, "T-001-A1")).thread_id).toBeNull();

    const applied = await judge(f, state.file, { apply: true });
    expect(applied.attempts[0]).toMatchObject({ status: "dispatching", applied_status: "active" });
    expect(await f.store.getAttempt(f.projectId, "T-001-A1")).toMatchObject({
      status: "active",
      thread_id: threadId,
      client_request_id: "repo-T-001-A1",
    });
    const again = await judge(f, state.file, { apply: true });
    expect(again.changes).toEqual([]);
    expect(again.attempts[0]).toMatchObject({ status: "active", thread_id: threadId });
  });

  test("a dispatch bound to a thread whose run already finished stays dispatching", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    const threadId = delegatedThreadId("repo-T-001-A1");
    thread(state.db, threadId);
    run(state.db, {
      id: "run-done",
      thread: threadId,
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(30),
      completedAt: minutesAgo(25),
    });
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({
      status: "dispatching",
      liveness: "finished_ok",
      thread_id: threadId,
    });
    expect(read.changes).toEqual([]);
    await judge(f, state.file, { apply: true });
    expect(await f.store.getAttempt(f.projectId, "T-001-A1")).toMatchObject({
      status: "dispatching",
      thread_id: threadId,
    });
  });

  test("a thread T3 has not created yet is running, not missing, and stays dispatching", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({
      status: "dispatching",
      liveness: "running",
      thread_id: null,
      run_id: null,
    });
    expect(byKey(read).get("T-001-A1")?.evidence).toContain(
      "T3 has not created the delegated thread for client request repo-T-001-A1 yet",
    );
    expect(byKey(read).get("T-001-A1")?.reason).toBe("Sent just now; T3 has not started it yet");
    expect(read.changes).toEqual([]);
    expect((await judge(f, state.file, { apply: true })).changes).toEqual([]);
    expect(await f.store.getAttempt(f.projectId, "T-001-A1")).toMatchObject({
      status: "dispatching",
      thread_id: null,
    });
  });

  test("a dispatch with no thread past the stall window is missing, and --apply records unknown", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    await f.sql("UPDATE attempts SET started_at = ? WHERE key = 'T-001-A1'", minutesAgo(90));
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({
      status: "dispatching",
      liveness: "missing",
      thread_id: null,
      run_id: null,
    });
    expect(byKey(read).get("T-001-A1")?.evidence).toBe(
      "no T3 thread for client request repo-T-001-A1 90m after dispatch",
    );
    expect(byKey(read).get("T-001-A1")?.reason).toBe("Sent 1 hour ago, but T3 never started it");
    expect(read.changes).toEqual([
      { attempt: "T-001-A1", from: "dispatching", to: "unknown", liveness: "missing" },
    ]);

    await judge(f, state.file, { apply: true });
    expect(await f.store.getAttempt(f.projectId, "T-001-A1")).toMatchObject({ status: "unknown" });
  });

  test("a brief under another thread never binds, and neither does one without a coordinator", async () => {
    const state = t3State();
    const f = await dispatchedByCoordinator(["attempt-one"]);
    dispatchedThread(
      state,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "ATTEMPT: T-001-A1",
      "thread-other",
    );
    state.db.close();
    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      thread_id: null,
      liveness: "running",
    });

    const orphanState = t3State();
    const orphan = await dispatchedByCoordinator(["attempt-one"], null);
    dispatchedThread(orphanState, "0b11452e-559e-4cc1-867f-2739d2357459", "ATTEMPT: T-001-A1");
    orphanState.db.close();
    expect(byKey(await judge(orphan, orphanState.file)).get("T-001-A1")).toMatchObject({
      thread_id: null,
      liveness: "running",
    });
  });

  test("an exact client request id prefers the thread T3 did not delete", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    const live = delegatedThreadId("repo-T-001-A1", "command:mcp:aaaa");
    const deleted = delegatedThreadId("repo-T-001-A1", "command:mcp:zzzz");
    thread(state.db, live);
    thread(state.db, deleted, { deletedAt: minutesAgo(5) });
    run(state.db, {
      id: "run-live",
      thread: live,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    turnItem(state.db, {
      id: "item-live",
      thread: live,
      run: "run-live",
      updatedAt: minutesAgo(1),
    });
    state.db.close();

    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: live,
      run_id: "run-live",
    });
  });

  test("a missing subagent projection warns when a dispatch cannot bind", async () => {
    const state = t3State();
    const f = await dispatchedByCoordinator(["attempt-one"]);
    state.db.exec("DROP TABLE orchestration_v2_projection_subagents");
    state.db.close();

    const read = await judge(f, state.file);
    expect(read.warnings).toEqual([
      "T3 subagent projection is missing; a dispatched attempt cannot bind to its delegated thread",
    ]);
    expect(byKey(read).get("T-001-A1")).toMatchObject({ thread_id: null, liveness: "running" });
  });

  test("an attempt without a client request id keeps the missing verdict", async () => {
    const state = t3State();
    const f = await dispatch(null);
    await f.sql("UPDATE attempts SET client_request_id = NULL WHERE key = 'T-001-A1'");
    thread(state.db, "thread-other");
    run(state.db, {
      id: "run-other",
      thread: "thread-other",
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({ liveness: "missing", thread_id: null });
    expect(byKey(read).get("T-001-A1")?.reason).toBe(
      "No conversation is recorded for this attempt",
    );
    expect(read.changes).toEqual([
      { attempt: "T-001-A1", from: "dispatching", to: "unknown", liveness: "missing" },
    ]);
  });

  test("only the exact decoded suffix binds, never a substring or another command", async () => {
    const state = t3State();
    const f = await dispatch("repo-T-001-A1");
    thread(state.db, delegatedThreadId("repo-T-001-A10"));
    state.db.close();
    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: null,
    });
    expect(byKey(await judge(f, state.file)).get("T-001-A1")?.evidence).toContain(
      "has not created",
    );

    const exact = t3State();
    const other = delegatedThreadId("repo-T-001-A1", "command:mcp:another-command");
    thread(exact.db, delegatedThreadId("repo-T-001-A10"));
    thread(exact.db, other);
    run(exact.db, {
      id: "run-exact",
      thread: other,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    exact.db.close();
    expect(byKey(await judge(f, exact.file)).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: other,
      run_id: "run-exact",
    });
  });

  test("a reuse attempt keeps the thread id it was given", async () => {
    const state = t3State();
    const f = await fixture();
    await f.store.addTask(f.projectId, { title: "Reused", goal: "g", acceptance: ["a"] });
    const attempt = await f.store.startAttempt(f.projectId, "T-001", {
      kind: "implementation",
      mechanism: "thread_send_reuse",
      contextMode: "reuse",
      clientRequestId: "repo-T-001-A1",
    });
    await f.store.updateAttempt(f.projectId, attempt.key, {
      status: "active",
      thread_id: "thread-reused",
    });
    thread(state.db, "thread-reused");
    run(state.db, {
      id: "run-reused",
      thread: "thread-reused",
      ordinal: 2,
      status: "running",
      requestedAt: minutesAgo(-1),
    });
    const delegated = delegatedThreadId("repo-T-001-A1");
    thread(state.db, delegated);
    run(state.db, {
      id: "run-delegated",
      thread: delegated,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    state.db.close();

    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: "thread-reused",
      run_id: "run-reused",
    });
  });

  test("binds the thread whose brief T3 recorded when no client request id was passed", async () => {
    const state = t3State();
    // T3 generated both ids, so only the brief it projected names the attempt.
    const f = await dispatchedByCoordinator(["attempt-one", "attempt-two"]);
    const child = dispatchedThread(
      state,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "Task T-001, attempt T-001-A1. Implement it.",
    );
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({
      liveness: "running",
      thread_id: child,
      run_id: "run-0b11452e-559e-4cc1-867f-2739d2357459",
    });
    expect(read.changes).toEqual([
      { attempt: "T-001-A1", from: "dispatching", to: "active", liveness: "running" },
    ]);
    expect(byKey(read).get("T-001-A2")).toMatchObject({ liveness: "running", thread_id: null });

    await judge(f, state.file, { apply: true });
    expect((await f.store.getAttempt(f.projectId, "T-001-A1")).thread_id).toBe(child);
    expect((await f.store.getAttempt(f.projectId, "T-001-A2")).thread_id).toBeNull();
  });

  test("a brief naming two dispatches binds neither, and a longer key names no attempt", async () => {
    const state = t3State();
    const f = await dispatchedByCoordinator(["attempt-one", "attempt-two"]);
    const own = dispatchedThread(
      state,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "ATTEMPT: T-001-A1. Implement it.",
    );
    dispatchedThread(
      state,
      "fe22bed2-f570-44b2-b6b8-a4543312155a",
      "Repair of T-001-A1. ATTEMPT: T-001-A2. Implement it.",
    );
    state.db.close();

    const read = await judge(f, state.file);
    // The brief naming two attempts is no evidence for either; the one naming A1 alone binds it.
    expect(byKey(read).get("T-001-A1")).toMatchObject({ thread_id: own, liveness: "running" });
    expect(byKey(read).get("T-001-A2")).toMatchObject({ thread_id: null, liveness: "running" });
    expect(byKey(read).get("T-001-A2")?.evidence).toContain("has not created the delegated thread");

    const longer = t3State();
    const bound = await dispatchedByCoordinator(["attempt-one"]);
    dispatchedThread(
      longer,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "ATTEMPT: T-001-A10. Implement it.",
    );
    longer.db.close();
    expect(byKey(await judge(bound, longer.file)).get("T-001-A1")).toMatchObject({
      thread_id: null,
      liveness: "running",
    });
  });

  test("several sends into one conversation that name the key bind it", async () => {
    const state = t3State();
    const f = await dispatchedByCoordinator(["attempt-one"]);
    const child = dispatchedThread(
      state,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "ATTEMPT: T-001-A1. Implement it.",
    );
    delegation(state.db, {
      id: "node-again",
      parent: COORDINATOR,
      child,
      prompt: "ATTEMPT: T-001-A1, continued.",
    });
    state.db.close();

    expect(byKey(await judge(f, state.file)).get("T-001-A1")).toMatchObject({
      thread_id: child,
      run_id: "run-0b11452e-559e-4cc1-867f-2739d2357459",
      liveness: "running",
    });
  });

  test("the key named in two conversations binds neither", async () => {
    const state = t3State();
    const f = await dispatchedByCoordinator(["attempt-one"]);
    dispatchedThread(
      state,
      "0b11452e-559e-4cc1-867f-2739d2357459",
      "ATTEMPT: T-001-A1. Implement it.",
    );
    dispatchedThread(
      state,
      "fe22bed2-f570-44b2-b6b8-a4543312155a",
      "ATTEMPT: T-001-A1, retried elsewhere.",
    );
    state.db.close();

    const read = await judge(f, state.file);
    expect(byKey(read).get("T-001-A1")).toMatchObject({ thread_id: null, liveness: "running" });
    expect(byKey(read).get("T-001-A1")?.evidence).toContain("has not created the delegated thread");
    expect(read.changes).toEqual([]);
  });
});

describe("failure classes of a finished run", () => {
  test("maps host errors onto the classes nf already uses", () => {
    expect(runFailureClass("cancelled", null)).toBe(ATTEMPT_FAILURE.CANCELLED);
    expect(runFailureClass("interrupted", null)).toBe(ATTEMPT_FAILURE.INTERRUPTED);
    expect(runFailureClass("rolled_back", null)).toBe(ATTEMPT_FAILURE.ROLLED_BACK);
    expect(runFailureClass("failed", "Usage limit reached for 5 hour")).toBe(ATTEMPT_FAILURE.QUOTA);
    expect(runFailureClass("failed", "429 Too Many Requests")).toBe(ATTEMPT_FAILURE.THROTTLED);
    expect(runFailureClass("failed", "401 Unauthorized")).toBe(ATTEMPT_FAILURE.AUTH);
    expect(runFailureClass("failed", "maximum context length exceeded")).toBe(
      ATTEMPT_FAILURE.CONTEXT_EXHAUSTED,
    );
    expect(runFailureClass("failed", "Request timed out.")).toBe(ATTEMPT_FAILURE.AVAILABILITY);
    expect(runFailureClass("failed", "something else")).toBe(ATTEMPT_FAILURE.FAILED);
    expect(runFailureClass("failed", null)).toBe(ATTEMPT_FAILURE.FAILED);
  });
});
