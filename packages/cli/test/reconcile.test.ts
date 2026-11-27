import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  delegation,
  delegatedThreadId,
  run,
  sentFollowUp,
  t3State,
  thread,
  turnItem,
} from "../../core/test/t3-state.ts";

// `nf attempt reconcile` runs through the real `nf` under node, against a fake T3 state database.
setDefaultTimeout(60_000);

const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0)
    rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5 });
});

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function gitProject(): string {
  const cwd = tmp("nf-reconcile-cwd-");
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd });
  return cwd;
}

const NOW = Date.now();
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

interface Run {
  code: number;
  out: string;
  err: string;
  /** Parsed stdout; each test narrows it to the shape its command writes. */
  json: () => any;
}

function runner(home: string, cwd: string, t3: string) {
  return (args: string[], t3StatePath = t3): Run => {
    const r = spawnSync(NODE, [BIN, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NF_HOME: home, NF_T3_STATE: t3StatePath },
    });
    return {
      code: r.status ?? -1,
      out: r.stdout,
      err: r.stderr,
      json: () => JSON.parse(r.stdout),
    };
  };
}

interface AttemptJson {
  key: string;
  status: string;
  thread_id: string | null;
  client_request_id: string | null;
  failure_class: string | null;
  failure_detail: string | null;
}

interface LivenessJson {
  applied: boolean;
  stall_minutes: number;
  attempts: { attempt: string; liveness: string | null; last_activity_at: string | null }[];
  changes: { attempt: string; from: string; to: string; liveness: string }[];
}

function setup(): { nf: ReturnType<typeof runner>; t3: string } {
  const home = tmp("nf-reconcile-home-");
  const cwd = gitProject();
  const data = tmp("nf-reconcile-t3-");
  const state = t3State(data);
  thread(state.db, "thread-live");
  run(state.db, {
    id: "run-live",
    thread: "thread-live",
    ordinal: 1,
    status: "running",
    requestedAt: minutesAgo(10),
  });
  turnItem(state.db, {
    id: "item-live",
    thread: "thread-live",
    run: "run-live",
    updatedAt: minutesAgo(2),
  });
  thread(state.db, "thread-failed");
  run(state.db, {
    id: "run-failed",
    thread: "thread-failed",
    ordinal: 1,
    status: "failed",
    requestedAt: minutesAgo(30),
    completedAt: minutesAgo(25),
  });
  turnItem(state.db, {
    id: "item-failed",
    thread: "thread-failed",
    run: "run-failed",
    updatedAt: minutesAgo(25),
    type: "error",
    failure: { class: "provider_error", message: "429: Usage limit reached for 5 hour." },
  });
  state.db.close();

  const nf = runner(home, cwd, state.file);
  expect(nf(["init", "--name", "demo", "--prefix", "T"]).code).toBe(0);
  for (const title of ["Running", "Failed", "Gone"]) {
    expect(nf(["task", "add", "--title", title, "--goal", "g", "--acceptance", "a"]).code).toBe(0);
  }
  for (const [task, threadId] of [
    ["T-001", "thread-live"],
    ["T-002", "thread-failed"],
    ["T-003", "thread-gone"],
  ] as const) {
    const start = nf([
      "attempt",
      "start",
      task,
      "--kind",
      "research",
      "--mechanism",
      "delegate_task",
    ]);
    expect(start.code).toBe(0);
    const key = start.out.trim().split(/\s+/)[0] ?? "";
    expect(nf(["attempt", "update", key, "--status", "active", "--thread-id", threadId]).code).toBe(
      0,
    );
  }
  expect(nf(["task", "set", "T-001", "--status", "working"]).code).toBe(0);
  return { nf, t3: state.file };
}

/** A project with one task, and T3's state with or without its delegated thread. */
function dispatched(threadExists: boolean): {
  nf: ReturnType<typeof runner>;
  threadId: string;
  clientRequestId: string;
} {
  const home = tmp("nf-reconcile-home-");
  const cwd = gitProject();
  const data = tmp("nf-reconcile-t3-");
  const state = t3State(data);
  const clientRequestId = "demo-T-001-A1";
  const threadId = delegatedThreadId(clientRequestId);
  if (threadExists) {
    thread(state.db, threadId);
    run(state.db, {
      id: "run-delegated",
      thread: threadId,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(10),
    });
    turnItem(state.db, {
      id: "item-delegated",
      thread: threadId,
      run: "run-delegated",
      updatedAt: minutesAgo(1),
    });
  }
  state.db.close();
  const nf = runner(home, cwd, state.file);
  expect(nf(["init", "--name", "demo", "--prefix", "T"]).code).toBe(0);
  expect(nf(["task", "add", "--title", "Delegated", "--goal", "g", "--acceptance", "a"]).code).toBe(
    0,
  );
  return { nf, threadId, clientRequestId };
}

describe("nf attempt reconcile", () => {
  test("reports every live attempt's liveness, read-only by default", () => {
    const { nf } = setup();
    const text = nf(["attempt", "reconcile"]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("stall 20m  read-only");
    expect(text.out).toMatch(/T-001-A1\s+active\s+running/);
    expect(text.out).toMatch(/T-002-A1\s+active\s+finished_failed/);
    expect(text.out).toMatch(/T-003-A1\s+active\s+missing/);
    expect(text.out).toContain(`last activity ${minutesAgo(2)}`);
    expect(text.out).toContain("429: Usage limit reached for 5 hour.");
    expect(text.out).toContain("thread thread-gone is not in T3");
    expect(text.out).toContain("would apply 2 changes:");
    expect(text.out).toContain("T-002-A1  active -> failed  (finished_failed)");
    expect(text.out).toContain("T-003-A1  active -> unknown  (missing)");
    expect(text.out).toContain("rerun with --apply to record them");

    const json = nf(["attempt", "reconcile", "--json"]).json() as LivenessJson;
    expect(json).toMatchObject({ applied: false, stall_minutes: 20 });
    expect(json.attempts.map((a) => [a.attempt, a.liveness])).toEqual([
      ["T-001-A1", "running"],
      ["T-002-A1", "finished_failed"],
      ["T-003-A1", "missing"],
    ]);
    expect(json.changes.map((c) => c.attempt)).toEqual(["T-002-A1", "T-003-A1"]);

    // Read-only: nothing moved.
    const shown = nf(["attempt", "show", "T-002-A1", "--json"]).json() as AttemptJson;
    expect(shown.status).toBe("active");
    expect(nf(["status", "--json"]).json().live_attempts).toHaveLength(3);
  });

  test("--stall-minutes is validated and a missing source fails loudly", () => {
    const { nf } = setup();
    const zero = nf(["attempt", "reconcile", "--stall-minutes", "0"]);
    expect(zero.code).toBe(2);
    expect(zero.err).toContain("--stall-minutes must be positive");
    const bad = nf(["attempt", "reconcile", "--stall-minutes", "soon"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--stall-minutes must be a number");
    const missing = nf(
      ["attempt", "reconcile"],
      join(tmp("nf-reconcile-absent-"), "statev2.sqlite"),
    );
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("source database not found");
    const wide = nf(["attempt", "reconcile", "--stall-minutes", "60", "--json"]);
    expect(wide.json().stall_minutes).toBe(60);
  });

  test("--apply records missing as unknown and a finished failure as failed, never the task", () => {
    const { nf } = setup();
    const applied = nf(["attempt", "reconcile", "--apply"]);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("applied 2 changes:");
    const failed = nf(["attempt", "show", "T-002-A1", "--json"]).json() as AttemptJson;
    expect(failed).toMatchObject({
      status: "failed",
      failure_class: "quota",
      failure_detail: "429: Usage limit reached for 5 hour.",
    });
    expect(nf(["attempt", "show", "T-003-A1", "--json"]).json().status).toBe("unknown");
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json().status).toBe("active");
    // The task keeps its status; the change is an event on the task's history.
    const task = nf(["task", "show", "T-002", "--events", "--json"]).json() as {
      status: string;
      events: { kind: string }[];
    };
    expect(task.status).toBe("todo");
    expect(task.events.map((e) => e.kind)).toContain("attempt_finished");

    const again = nf(["attempt", "reconcile", "--apply"]);
    expect(again.out).toContain("no changes");
    const status = nf(["status", "--json"]).json() as {
      live_attempts: { key: string; liveness: string }[];
    };
    expect(status.live_attempts.map((a) => [a.key, a.liveness])).toEqual([
      ["T-001-A1", "running"],
      ["T-003-A1", "missing"],
    ]);
    expect(nf(["status"]).out).toContain("liveness=running");
  });

  test("a dispatch binds to the delegated thread of the client request id attempt start printed", () => {
    const { nf, threadId, clientRequestId } = dispatched(true);
    const started = nf([
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "delegate_task",
    ]);
    expect(started.code).toBe(0);
    expect(started.out.trim()).toBe(`T-001-A1  ${clientRequestId}`);

    const read = nf(["attempt", "reconcile"]);
    expect(read.code).toBe(0);
    expect(read.out).toMatch(/T-001-A1\s+dispatching\s+running/);
    expect(read.out).toContain(`thread ${threadId}`);
    expect(read.out).toContain("would apply 1 change:");
    expect(read.out).toContain("T-001-A1  dispatching -> active  (running)");
    // The read binds in memory only; the attempt is untouched.
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json() as AttemptJson).toMatchObject({
      status: "dispatching",
      thread_id: null,
    });

    const applied = nf(["attempt", "reconcile", "--apply"]);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("applied 1 change:");
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json() as AttemptJson).toMatchObject({
      status: "active",
      thread_id: threadId,
      client_request_id: clientRequestId,
    });
    expect(nf(["attempt", "reconcile", "--apply"]).out).toContain("no changes");
  });

  test("a dispatch whose delegated thread T3 has not created yet stays dispatching and running", () => {
    const { nf, clientRequestId } = dispatched(false);
    const started = nf([
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "delegate_task",
    ]);
    expect(started.out.trim()).toBe(`T-001-A1  ${clientRequestId}`);

    const read = nf(["attempt", "reconcile"]);
    expect(read.out).toMatch(/T-001-A1\s+dispatching\s+running/);
    expect(read.out).toContain(
      `T3 has not created the delegated thread for client request ${clientRequestId} yet`,
    );
    expect(read.out).not.toContain("missing");
    expect(nf(["attempt", "reconcile", "--json"]).json().changes).toEqual([]);
    expect(nf(["attempt", "reconcile", "--apply"]).out).toContain("no changes");
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json() as AttemptJson).toMatchObject({
      status: "dispatching",
      thread_id: null,
    });
  });

  test("a reuse attempt start prints its default client id and binds the run of its send", () => {
    const home = tmp("nf-reconcile-home-");
    const cwd = gitProject();
    const data = tmp("nf-reconcile-t3-");
    const state = t3State(data);
    const conversation = "thread-conversation";
    thread(state.db, conversation);
    run(state.db, {
      id: "run-before",
      thread: conversation,
      ordinal: 1,
      status: "completed",
      requestedAt: minutesAgo(120),
      completedAt: minutesAgo(100),
    });
    run(state.db, {
      id: "run-follow-up",
      thread: conversation,
      ordinal: 2,
      status: "running",
      requestedAt: minutesAgo(1),
    });
    turnItem(state.db, {
      id: "item-follow-up",
      thread: conversation,
      run: "run-follow-up",
      updatedAt: minutesAgo(0),
    });
    sentFollowUp(state.db, {
      clientRequestId: "demo-T-001-A1",
      thread: conversation,
      run: "run-follow-up",
      createdAt: minutesAgo(1),
    });
    state.db.close();

    const nf = runner(home, cwd, state.file);
    expect(nf(["init", "--name", "demo", "--prefix", "T"]).code).toBe(0);
    expect(nf(["task", "add", "--title", "Reused", "--goal", "g", "--acceptance", "a"]).code).toBe(
      0,
    );
    const started = nf([
      "attempt",
      "start",
      "T-001",
      "--kind",
      "research",
      "--mechanism",
      "thread_send_reuse",
      "--context-mode",
      "reuse",
    ]);
    expect(started.code).toBe(0);
    expect(started.out.trim()).toBe("T-001-A1  demo-T-001-A1");

    const read = nf(["attempt", "reconcile"]);
    expect(read.code).toBe(0);
    expect(read.out).toMatch(/T-001-A1\s+dispatching\s+running/);
    expect(read.out).toContain(`thread ${conversation}`);
    expect(read.out).toContain("run run-follow-up");
    expect(read.out).toContain("would apply 1 change:");

    expect(nf(["attempt", "reconcile", "--apply"]).out).toContain("applied 1 change:");
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json() as AttemptJson).toMatchObject({
      status: "active",
      thread_id: conversation,
      client_request_id: "demo-T-001-A1",
    });
  });

  test("binds the thread T3 created without the coordinator passing any client request id", () => {
    const home = tmp("nf-reconcile-home-");
    const cwd = gitProject();
    const data = tmp("nf-reconcile-t3-");
    const state = t3State(data);
    // T3 generated the id the thread embeds; only its projection of the brief names the attempt.
    const child = delegatedThreadId("fe22bed2-f570-44b2-b6b8-a4543312155a");
    thread(state.db, child);
    run(state.db, {
      id: "run-child",
      thread: child,
      ordinal: 1,
      status: "running",
      requestedAt: minutesAgo(5),
    });
    turnItem(state.db, {
      id: "item-child",
      thread: child,
      run: "run-child",
      updatedAt: minutesAgo(1),
    });
    delegation(state.db, {
      id: "node-child",
      parent: "thread-coordinator",
      child,
      prompt: "Task T-001, attempt T-001-A1. Implement it.",
    });
    state.db.close();

    const nf = runner(home, cwd, state.file);
    expect(nf(["init", "--name", "demo", "--prefix", "T"]).code).toBe(0);
    expect(nf(["coordinator", "register", "--thread", "thread-coordinator"]).code).toBe(0);
    expect(
      nf(["task", "add", "--title", "Delegated", "--goal", "g", "--acceptance", "a"]).code,
    ).toBe(0);
    const started = nf([
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "delegate_task",
    ]);
    expect(started.out.trim()).toBe("T-001-A1  demo-T-001-A1");

    const read = nf(["attempt", "reconcile"]);
    expect(read.out).toMatch(/T-001-A1\s+dispatching\s+running/);
    expect(read.out).toContain(`thread ${child}`);

    expect(nf(["attempt", "reconcile", "--apply"]).code).toBe(0);
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json() as AttemptJson).toMatchObject({
      status: "active",
      thread_id: child,
      client_request_id: "demo-T-001-A1",
    });
  });
});
