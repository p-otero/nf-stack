import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LATEST_VERSION, NfError, TASK_STATUSES, isUlid, machineId, ulid } from "../src/index.ts";
import {
  addTask,
  cleanupAll,
  fixture,
  openStore,
  passAll,
  rejection,
  startImpl,
  tempDir,
} from "./helpers.ts";

afterEach(cleanupAll);

async function rejects(fn: () => Promise<unknown>, code: string, match?: RegExp): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(NfError);
    expect((err as NfError).code).toBe(code);
    if (match) expect((err as NfError).message).toMatch(match);
    return;
  }
  throw new Error(`expected NfError(${code}), nothing thrown`);
}

describe("ids and migrations", () => {
  test("ulids are 26-char Crockford, unique and sortable", () => {
    const ids = Array.from({ length: 500 }, () => ulid());
    expect(new Set(ids).size).toBe(500);
    expect(ids.every(isUlid)).toBe(true);
    expect(ids.toSorted()).toEqual(ids);
  });

  test("machine id is created once and stable", () => {
    const home = tempDir();
    const a = machineId(home);
    expect(isUlid(a)).toBe(true);
    expect(machineId(home)).toBe(a);
  });

  test("a new store is migrated from empty to latest and reopens cleanly", async () => {
    const f = await fixture();
    const version = await f.sql<{ user_version: number }>("PRAGMA user_version");
    expect(version[0]?.user_version).toBe(LATEST_VERSION);
    const mode = await f.sql<{ journal_mode: string }>("PRAGMA journal_mode");
    expect(mode[0]?.journal_mode).toBe("wal");
    expect((await f.sql<{ foreign_keys: number }>("PRAGMA foreign_keys"))[0]?.foreign_keys).toBe(1);
    await f.close();
    const again = await openStore(f.home);
    try {
      const v = await again.sql<{ user_version: number }>("PRAGMA user_version");
      expect(v[0]?.user_version).toBe(LATEST_VERSION);
      expect((await again.store.listProjects()).length).toBe(1);
      expect(again.store.machine).toBe(f.store.machine);
    } finally {
      await again.close();
    }
  });

  test("a store written by a newer nf is refused", async () => {
    const home = tempDir();
    const raw = new DatabaseSync(join(home, "nf.db"));
    raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    raw.close();
    await rejects(async () => {
      const opened = await openStore(home);
      await opened.close();
    }, "store_too_new");
  });
});

describe("tasks", () => {
  test("keys are sequential per project and acceptance is stored in order", async () => {
    const f = await fixture();
    const other = (await f.store.registerProject({ name: "other", rootPath: tempDir() })).project;
    const t1 = await addTask(f, { acceptance: ["one", "two"] });
    const t2 = await addTask(f);
    const o1 = await f.store.addTask(other.id, { title: "x", goal: "y", acceptance: ["z"] });
    expect([t1.key, t2.key, o1.key]).toEqual(["T-001", "T-002", "OT-001"]);
    expect(t1.acceptance.map((a) => [a.position, a.text, a.result])).toEqual([
      [1, "one", "unverified"],
      [2, "two", "unverified"],
    ]);
    expect(t1.status).toBe("todo");
    expect((await f.store.getTask(f.projectId, "t-1")).key).toBe("T-001");
  });

  test("input is validated", async () => {
    const f = await fixture();
    await rejects(() => addTask(f, { title: "  " }), "invalid_value");
    await rejects(() => addTask(f, { acceptance: [] }), "invalid_value", /acceptance/);
    await rejects(() => addTask(f, { dependsOn: ["T-009"] }), "not_found");
    await rejects(() => f.store.getTask(f.projectId, "nonsense"), "bad_key");
    await rejects(() => addTask(f, { analysisMode: "bogus" }), "invalid_value");
  });

  test("proposed tasks need approval; approval is audited", async () => {
    const f = await fixture();
    const t = await addTask(f, { status: "proposed" });
    await rejects(() => f.store.setStatus(f.projectId, t.key, "working"), "illegal_transition");
    const approved = await f.store.approveTask(f.projectId, t.key);
    expect(approved.status).toBe("todo");
    const ev = await f.store.listEvents(f.projectId, t.key);
    expect(ev.map((e) => e.kind)).toEqual(["created", "approval"]);
    expect(ev[1]).toMatchObject({ actor_role: "user", from_status: "proposed", to_status: "todo" });
  });

  test("only the transitions of the task contract are legal", async () => {
    const legal: Record<string, string[]> = {
      proposed: ["todo", "cancelled"],
      todo: ["working", "cancelled"],
      working: ["review", "blocked", "cancelled"],
      review: ["done", "working", "cancelled"],
      blocked: ["todo", "cancelled"],
      done: [],
      cancelled: [],
    };
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const f = await fixture();
        const t = await addTask(f);
        await passAll(f, t.key); // so review -> done is only gated by the transition table
        await f.sql("UPDATE tasks SET status = ? WHERE id = ?", from, t.id);
        const allowed = legal[from]?.includes(to) ?? false;
        if (allowed) {
          expect((await f.store.setStatus(f.projectId, t.key, to)).status).toBe(to);
        } else {
          await rejects(() => f.store.setStatus(f.projectId, t.key, to), "illegal_transition");
          expect((await f.store.getTask(f.projectId, t.key)).status).toBe(from);
        }
        await cleanupAll();
      }
    }
  });

  test("done and cancelled reopen to todo only on explicit request", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await f.store.setStatus(f.projectId, t.key, "cancelled");
    await rejects(
      () => f.store.setStatus(f.projectId, t.key, "todo"),
      "illegal_transition",
      /reopen/,
    );
    await rejects(
      () => f.store.setStatus(f.projectId, t.key, "working", { reopen: true }),
      "illegal_transition",
    );
    const re = await f.store.setStatus(f.projectId, t.key, "todo", {
      reopen: true,
      reason: "user asked",
    });
    expect(re.status).toBe("todo");
    expect((await f.store.listEvents(f.projectId, t.key)).at(-1)?.kind).toBe("reopen");
    await rejects(
      () => f.store.setStatus(f.projectId, t.key, "todo", { reopen: true }),
      "illegal_transition",
    );
  });

  test("done requires every acceptance item to pass", async () => {
    const f = await fixture();
    const t = await addTask(f, { acceptance: ["a", "b", "c"] });
    await f.store.setStatus(f.projectId, t.key, "working");
    await f.store.setStatus(f.projectId, t.key, "review");
    await rejects(
      () => f.store.acceptTask(f.projectId, t.key),
      "acceptance_incomplete",
      /#1 unverified, #2 unverified, #3 unverified/,
    );
    await f.store.checkItem(f.projectId, t.key, 1, "pass", "e1");
    await f.store.checkItem(f.projectId, t.key, 2, "fail", "broken");
    await f.store.checkItem(f.projectId, t.key, 3, "pass");
    await rejects(
      () => f.store.setStatus(f.projectId, t.key, "done"),
      "acceptance_incomplete",
      /#2 fail/,
    );
    await f.store.checkItem(f.projectId, t.key, 2, "pass", "fixed");
    const done = await f.store.acceptTask(f.projectId, t.key);
    expect(done.status).toBe("done");
    expect(done.acceptance.map((a) => a.evidence)).toEqual(["e1", "fixed", null]);
    await rejects(() => f.store.checkItem(f.projectId, t.key, 1, "fail"), "illegal_transition");
    await rejects(() => f.store.checkItem(f.projectId, "T-001", 9, "pass"), "illegal_transition");
  });

  test("checking an unknown item is rejected", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await rejects(() => f.store.checkItem(f.projectId, t.key, 5, "pass"), "not_found");
    await rejects(() => f.store.checkItem(f.projectId, t.key, 1, "maybe"), "invalid_value");
  });

  test("done and cancelled are refused while an attempt is still live", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await passAll(f, t.key);
    await f.store.setStatus(f.projectId, t.key, "working");
    const a = await startImpl(f, t.key);
    await f.store.setStatus(f.projectId, t.key, "review");
    await rejects(() => f.store.acceptTask(f.projectId, t.key), "live_attempt", new RegExp(a.key));
    await f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" });
    expect((await f.store.acceptTask(f.projectId, t.key)).status).toBe("done");

    const u = await addTask(f);
    const b = await startImpl(f, u.key);
    await rejects(() => f.store.setStatus(f.projectId, u.key, "cancelled"), "live_attempt");
    await f.store.finishAttempt(f.projectId, b.key, { status: "cancelled" });
    expect((await f.store.setStatus(f.projectId, u.key, "cancelled")).status).toBe("cancelled");
  });

  test("accepted_first_pass is derived from attempts", async () => {
    // first implementation attempt succeeded, no repair -> true
    const f = await fixture();
    const t = await addTask(f);
    const a1 = await startImpl(f, t.key);
    await f.store.finishAttempt(f.projectId, a1.key, { status: "succeeded" });
    await passAll(f, t.key);
    expect((await f.store.acceptTask(f.projectId, t.key)).accepted_first_pass).toBe(true);

    // a repair attempt exists -> false
    const u = await addTask(f);
    const b1 = await startImpl(f, u.key);
    await f.store.finishAttempt(f.projectId, b1.key, { status: "succeeded" });
    await f.store.setStatus(f.projectId, u.key, "working");
    const b2 = await startImpl(f, u.key, { repairOf: b1.key });
    expect(b2.repair_of).toBe(b1.key);
    await f.store.finishAttempt(f.projectId, b2.key, { status: "succeeded" });
    await passAll(f, u.key);
    expect((await f.store.acceptTask(f.projectId, u.key)).accepted_first_pass).toBe(false);

    // first implementation attempt failed, a retry succeeded -> false
    const v = await addTask(f);
    const c1 = await startImpl(f, v.key);
    await f.store.finishAttempt(f.projectId, c1.key, { status: "failed", failure_class: "quota" });
    const c2 = await startImpl(f, v.key);
    await f.store.finishAttempt(f.projectId, c2.key, { status: "succeeded" });
    await passAll(f, v.key);
    expect((await f.store.acceptTask(f.projectId, v.key)).accepted_first_pass).toBe(false);

    // no implementation attempt at all -> not applicable
    const w = await addTask(f);
    await f.store.setStatus(f.projectId, w.key, "working");
    await f.store.setStatus(f.projectId, w.key, "review");
    await passAll(f, w.key);
    expect((await f.store.acceptTask(f.projectId, w.key)).accepted_first_pass).toBeNull();
  });

  test("interventions are counted and audited", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await f.store.intervene(f.projectId, t.key, "user corrected the scope");
    const after = await f.store.intervene(f.projectId, t.key, "user chose option B");
    expect(after.human_interventions).toBe(2);
    expect(
      (await f.store.listEvents(f.projectId, t.key)).filter((e) => e.kind === "intervention")
        .length,
    ).toBe(2);
    await rejects(() => f.store.intervene(f.projectId, t.key, " "), "invalid_value");
  });

  test("metadata updates: blocker JSON, decision, supersession", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const n = await addTask(f);
    const u = await f.store.updateTask(f.projectId, t.key, {
      blocker: { identity: "x", cycles: 2 },
      decision_needed: "pick a DB",
      superseded_by: n.key,
      evidence: "bun test -> PASS",
    });
    expect(u.blocker).toEqual({ identity: "x", cycles: 2 });
    expect(u.superseded_by).toBe(n.key);
    expect(u.decision_needed).toBe("pick a DB");
    await rejects(
      () => f.store.updateTask(f.projectId, t.key, { superseded_by: t.key }),
      "invalid_value",
    );
    expect((await f.store.updateTask(f.projectId, t.key, { blocker: null })).blocker).toBeNull();
  });
});

describe("dependencies and readiness", () => {
  test("ready = todo + deps done + no live attempt, derived and never stored", async () => {
    const f = await fixture();
    const a = await addTask(f, { title: "A" });
    const b = await addTask(f, { title: "B", dependsOn: [a.key] });
    const c = await addTask(f, { title: "C", status: "proposed" });
    const ready = async () => (await f.store.readyTasks(f.projectId)).map((t) => t.key);
    expect(await ready()).toEqual(["T-001"]); // B waits on A, C is only proposed
    const att = await startImpl(f, a.key);
    expect(await ready()).toEqual([]); // A now works on it with a live attempt
    await f.store.finishAttempt(f.projectId, att.key, { status: "succeeded" });
    expect(await ready()).toEqual([]);
    await passAll(f, a.key);
    await f.store.acceptTask(f.projectId, a.key);
    expect(await ready()).toEqual([b.key]);
    await f.store.updateTask(f.projectId, b.key, { decision_needed: "unresolved" });
    expect(await ready()).toEqual([]);
    await f.store.updateTask(f.projectId, b.key, { decision_needed: null });
    expect(await ready()).toEqual([b.key]);
    await f.store.approveTask(f.projectId, c.key);
    expect(await ready()).toEqual([b.key, c.key]);
    // a research attempt (non-writing) also owns the task while live
    await startImpl(f, b.key, { kind: "research" });
    expect(await ready()).toEqual([c.key]);
    const cols = (await f.sql<{ name: string }>("PRAGMA table_info(tasks)")).map((r) => r.name);
    expect(cols).not.toContain("ready");
  });

  test("self-reference and cycles are rejected", async () => {
    const f = await fixture();
    const a = await addTask(f);
    const b = await addTask(f, { dependsOn: [a.key] });
    const c = await addTask(f, { dependsOn: [b.key] });
    await rejects(() => f.store.addDependency(f.projectId, a.key, a.key), "cycle", /itself/);
    await rejects(() => f.store.addDependency(f.projectId, a.key, b.key), "cycle");
    await rejects(() => f.store.addDependency(f.projectId, a.key, c.key), "cycle");
    expect((await f.store.getTask(f.projectId, a.key)).depends_on).toEqual([]);
    // a valid extra edge is fine and idempotent
    await f.store.addDependency(f.projectId, c.key, a.key);
    await f.store.addDependency(f.projectId, c.key, a.key);
    expect((await f.store.getTask(f.projectId, c.key)).depends_on).toEqual(["T-001", "T-002"]);
    // the schema itself also refuses a self edge
    await rejection(f.sql("INSERT INTO task_deps VALUES (?,?)", a.id, a.id));
  });
});

describe("attempts", () => {
  test("start records the contract fields and begins as dispatching", async () => {
    const f = await fixture();
    const t = await addTask(f, { profile: "reasoning" });
    const a = await f.store.startAttempt(f.projectId, t.key, {
      kind: "implementation",
      mechanism: "t3_thread_launch",
      provider: "codex",
      model: "gpt-x",
      options: { effort: "high" },
      reason: "needs a worktree",
      contextMode: "fork",
      sourceThread: "thr-src",
      clientRequestId: "req-7",
      baseCommit: "abc123",
    });
    expect(a).toMatchObject({
      key: "T-001-A1",
      status: "dispatching",
      kind: "implementation",
      mechanism: "t3_thread_launch",
      provider_instance_id: "codex",
      model: "gpt-x",
      options: { effort: "high" },
      profile: "reasoning", // defaults to the task profile
      reason: "needs a worktree",
      context_mode: "fork",
      source_thread_id: "thr-src",
      client_request_id: "req-7",
      base_commit: "abc123",
      ended_at: null,
      commits: [],
      fallbacks: [],
    });
    expect(isUlid(a.id)).toBe(true);
    expect(a.started_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    await rejects(() => startImpl(f, t.key, { kind: "nope", mechanism: "fork" }), "invalid_value");
    await rejects(
      () => startImpl(f, t.key, { kind: "research", mechanism: "nope" }),
      "invalid_value",
    );
  });

  test("at most one live writing attempt per task; non-writing kinds may run alongside", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a1 = await startImpl(f, t.key);
    await rejects(() => startImpl(f, t.key), "live_writer", /T-001-A1/);
    await rejects(() => startImpl(f, t.key, { kind: "integration" }), "live_writer");
    await startImpl(f, t.key, { kind: "research" });
    await startImpl(f, t.key, { kind: "review" });
    // a failed dispatch does not free the slot until it is finished; 'unknown' still owns it
    await f.store.updateAttempt(f.projectId, a1.key, { status: "unknown" });
    await rejects(() => startImpl(f, t.key), "live_writer");
    await f.store.updateAttempt(f.projectId, a1.key, { status: "active" });
    await rejects(() => startImpl(f, t.key), "live_writer");
    await f.store.finishAttempt(f.projectId, a1.key, { status: "superseded" });
    const a4 = await startImpl(f, t.key, { kind: "integration" });
    expect(a4.key).toBe("T-001-A4");
    // the database also refuses a second live writer behind the store's back
    await rejection(
      f.sql(
        "INSERT INTO attempts (id, machine_id, task_id, seq, key, kind, status, mechanism, started_at, updated_at) VALUES ('X','m',?,99,'T-001-A99','implementation','active','fork','t','t')",
        t.id,
      ),
    );
  });

  test("attempts are refused for tasks that cannot be worked on", async () => {
    const f = await fixture();
    const p = await addTask(f, { status: "proposed" });
    await rejects(() => startImpl(f, p.key), "illegal_state", /proposed/);
    const t = await addTask(f);
    await f.store.setStatus(f.projectId, t.key, "cancelled");
    await rejects(() => startImpl(f, t.key, { kind: "research" }), "illegal_state");
  });

  test("client request id makes a retransmitted dispatch idempotent", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key, { clientRequestId: "req-1" });
    const again = await startImpl(f, t.key, { clientRequestId: "req-1" });
    expect(again.key).toBe(a.key);
    expect((await f.store.listAttempts(f.projectId, t.key)).length).toBe(1);
  });

  test("every attempt gets a default client request id, reuse attempts included", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const dispatched = await startImpl(f, t.key, { mechanism: "delegate_task" });
    expect(dispatched.client_request_id).toBe("demo-T-001-A1");
    const reuse = await f.store.startAttempt(f.projectId, t.key, {
      kind: "research",
      mechanism: "thread_send_reuse",
      contextMode: "reuse",
    });
    expect(reuse.client_request_id).toBe("demo-T-001-A2");
  });

  test("update records thread, worktree, commits, checks and fallbacks; finish closes it", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    const u = await f.store.updateAttempt(f.projectId, a.key, {
      status: "active",
      thread_id: "thr-1",
      thread_link: "t3://thr-1",
      t3_task_id: "task-9",
      executed_model: "gpt-x-mini",
      worktree: "/w/x",
      branch: "feat/x",
      addFallback: [{ route: "claude/sonnet", failure: "quota", reset: "18:00" }],
      addCommits: ["abc", "def", "abc"],
      addChecks: [{ command: "bun test", result: "pass" }],
    });
    expect(u).toMatchObject({
      status: "active",
      thread_id: "thr-1",
      thread_link: "t3://thr-1",
      t3_task_id: "task-9",
      executed_model: "gpt-x-mini",
      worktree: "/w/x",
      branch: "feat/x",
      commits: ["abc", "def"],
      fallbacks: [{ route: "claude/sonnet", failure: "quota", reset: "18:00" }],
    });
    expect(u.checks).toEqual([{ position: 1, command: "bun test", result: "pass", detail: null }]);
    await rejects(
      () => f.store.updateAttempt(f.projectId, a.key, { status: "succeeded" }),
      "invalid_value",
    );
    const fin = await f.store.finishAttempt(f.projectId, a.key, {
      status: "failed",
      outcome: "worker stalled",
      failure_class: "reasoning_stalled",
      failure_detail: "two cycles without progress",
      retry_at: "2026-11-16T00:00:00Z",
      last_verified: "tests 3/4",
      remaining: "fix parser",
    });
    expect(fin).toMatchObject({
      status: "failed",
      failure_class: "reasoning_stalled",
      remaining: "fix parser",
    });
    expect(fin.ended_at).not.toBeNull();
    // final is final, but bookkeeping (extra commits) is still allowed
    await rejects(
      () => f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" }),
      "illegal_transition",
    );
    await rejects(
      () => f.store.updateAttempt(f.projectId, a.key, { status: "active" }),
      "illegal_transition",
    );
    expect(
      (await f.store.updateAttempt(f.projectId, a.key, { addCommits: ["zzz"] })).commits,
    ).toEqual(["abc", "def", "zzz"]);
  });

  test("a writing attempt moves the task todo -> working -> review, audited", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    expect((await f.store.getTask(f.projectId, t.key)).status).toBe("working");
    await f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" });
    expect((await f.store.getTask(f.projectId, t.key)).status).toBe("review");
    expect(
      (await f.store.listEvents(f.projectId, t.key)).map((e) => [
        e.kind,
        e.from_status,
        e.to_status,
        e.note,
      ]),
    ).toEqual([
      ["created", null, "todo", null],
      ["attempt_started", null, null, a.key],
      ["status", "todo", "working", a.key],
      ["attempt_finished", "dispatching", "succeeded", a.key],
      ["status", "working", "review", a.key],
    ]);
    await passAll(f, t.key);
    expect((await f.store.acceptTask(f.projectId, t.key)).status).toBe("done");
  });

  test("an integration attempt moves the task too", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key, { kind: "integration" });
    expect((await f.store.getTask(f.projectId, t.key)).status).toBe("working");
    await f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" });
    expect((await f.store.getTask(f.projectId, t.key)).status).toBe("review");
  });

  test("an unfinished or unsuccessful writing attempt keeps the task working", async () => {
    const f = await fixture();
    for (const status of ["failed", "cancelled", "superseded"]) {
      const t = await addTask(f, { title: status });
      const a = await startImpl(f, t.key);
      await f.store.finishAttempt(f.projectId, a.key, { status });
      expect((await f.store.getTask(f.projectId, t.key)).status).toBe("working");
    }
  });

  test("a task moved elsewhere is never forced into the attempt's status", async () => {
    const f = await fixture();
    const statusEvents = async (key: string) =>
      (await f.store.listEvents(f.projectId, key)).filter((e) => e.kind === "status");

    const reviewed = await addTask(f);
    const a = await startImpl(f, reviewed.key);
    await f.store.setStatus(f.projectId, reviewed.key, "review");
    await f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" });
    expect((await f.store.getTask(f.projectId, reviewed.key)).status).toBe("review");
    expect(await statusEvents(reviewed.key)).toHaveLength(2);

    const blocked = await addTask(f);
    const b = await startImpl(f, blocked.key);
    await f.store.setStatus(f.projectId, blocked.key, "blocked", { reason: "needs a key" });
    await f.store.finishAttempt(f.projectId, b.key, { status: "succeeded" });
    expect((await f.store.getTask(f.projectId, blocked.key)).status).toBe("blocked");
    expect(await statusEvents(blocked.key)).toHaveLength(2);
  });

  test("research, design and review attempts do not change the task status", async () => {
    const f = await fixture();
    for (const kind of ["research", "design", "review"]) {
      const t = await addTask(f, { title: kind });
      const a = await startImpl(f, t.key, { kind });
      expect((await f.store.getTask(f.projectId, t.key)).status).toBe("todo");
      await f.store.finishAttempt(f.projectId, a.key, { status: "succeeded" });
      expect((await f.store.getTask(f.projectId, t.key)).status).toBe("todo");
      expect(
        (await f.store.listEvents(f.projectId, t.key)).filter((e) => e.kind === "status"),
      ).toEqual([]);
    }
  });

  test("attempt keys resolve per project", async () => {
    const f = await fixture();
    const other = (await f.store.registerProject({ name: "other", rootPath: tempDir() })).project;
    const t = await addTask(f);
    await startImpl(f, t.key);
    await rejects(() => f.store.getAttempt(other.id, "T-001-A1"), "not_found");
    await rejects(() => f.store.getAttempt(f.projectId, "T-001-A2"), "not_found");
    await rejects(() => f.store.getAttempt(f.projectId, "garbage"), "bad_key");
  });
});

describe("reports", () => {
  test("reports are scoped to the named attempt and never change state", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const other = await addTask(f);
    const a1 = await startImpl(f, t.key);
    await f.store.finishAttempt(f.projectId, a1.key, { status: "failed" });
    const a2 = await startImpl(f, t.key);
    const b1 = await startImpl(f, other.key);
    const taskBefore = await f.store.getTask(f.projectId, t.key);
    const attemptBefore = await f.store.getAttempt(f.projectId, a2.key);
    const eventsBefore = (await f.store.listEvents(f.projectId, t.key)).length;

    const r = await f.store.addReport(
      f.projectId,
      a2.key,
      "checkpoint",
      "step 1 done\r\nnext: tests",
    );
    await f.store.addReport(f.projectId, a2.key, "result", "RESULT: SUCCEEDED");

    expect(r).toMatchObject({
      attempt_key: a2.key,
      kind: "checkpoint",
      body: "step 1 done\nnext: tests",
    });
    expect((await f.store.listReports(f.projectId, a2.key)).map((x) => x.kind)).toEqual([
      "checkpoint",
      "result",
    ]);
    expect(await f.store.listReports(f.projectId, a1.key)).toEqual([]);
    expect(await f.store.listReports(f.projectId, b1.key)).toEqual([]);
    // task, attempt and audit trail are untouched
    expect(await f.store.getTask(f.projectId, t.key)).toEqual(taskBefore);
    expect(await f.store.getAttempt(f.projectId, a2.key)).toEqual(attemptBefore);
    expect((await f.store.listEvents(f.projectId, t.key)).length).toBe(eventsBefore);
  });

  test("late reports still attach to a finished attempt", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    await f.store.finishAttempt(f.projectId, a.key, { status: "superseded" });
    await f.store.addReport(f.projectId, a.key, "result", "late result");
    expect((await f.store.getAttempt(f.projectId, a.key)).status).toBe("superseded");
  });

  test("unknown attempts, bad kinds and empty bodies are rejected", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    await rejects(() => f.store.addReport(f.projectId, "T-001-A7", "result", "x"), "not_found");
    await rejects(() => f.store.addReport(f.projectId, "T-009-A1", "result", "x"), "not_found");
    await rejects(() => f.store.addReport(f.projectId, a.key, "done", "x"), "invalid_value");
    await rejects(() => f.store.addReport(f.projectId, a.key, "result", "   \n"), "invalid_value");
    await rejects(
      () => f.store.addReport(f.projectId, a.key, "result", "x".repeat(600 * 1024)),
      "invalid_value",
    );
    expect(await f.store.listReports(f.projectId, a.key)).toEqual([]);
  });

  test("reports and events are append-only at the database level", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    const r = await f.store.addReport(f.projectId, a.key, "result", "body");
    expect(
      (await rejection(f.sql("UPDATE attempt_reports SET body = 'x' WHERE id = ?", r.id))).message,
    ).toMatch(/append-only/);
    expect(
      (await rejection(f.sql("DELETE FROM attempt_reports WHERE id = ?", r.id))).message,
    ).toMatch(/append-only/);
    expect((await rejection(f.sql("UPDATE task_events SET note = 'x'"))).message).toMatch(
      /append-only/,
    );
    expect((await rejection(f.sql("DELETE FROM task_events"))).message).toMatch(/append-only/);
    expect((await f.store.listReports(f.projectId, a.key))[0]?.body).toBe("body");
  });
});

describe("summary and events", () => {
  test("status counts, live attempts, ready tasks and proposals", async () => {
    const f = await fixture();
    const a = await addTask(f, { title: "A" });
    await addTask(f, { title: "B", dependsOn: [a.key] });
    await addTask(f, { title: "P", status: "proposed" });
    const att = await startImpl(f, a.key);
    const s = await f.store.summary(f.projectId);
    expect(s.counts).toMatchObject({ todo: 1, working: 1, proposed: 1, done: 0 });
    expect(s.total).toBe(3);
    expect(s.live_attempts.map((x) => x.key)).toEqual([att.key]);
    expect(s.ready).toEqual([]);
    expect(s.proposals).toEqual([{ key: "T-003", title: "P" }]);
  });

  test("status transitions are audited with actor and endpoints", async () => {
    const f = await fixture();
    const t = await addTask(f);
    await f.store.setStatus(f.projectId, t.key, "working", {
      reason: "dispatched",
      actor: "coordinator",
    });
    await f.store.setStatus(f.projectId, t.key, "blocked", { reason: "needs key", actor: "user" });
    const ev = await f.store.listEvents(f.projectId, t.key);
    expect(ev.map((e) => [e.kind, e.from_status, e.to_status, e.actor_role, e.note])).toEqual([
      ["created", null, "todo", "coordinator", null],
      ["status", "todo", "working", "coordinator", "dispatched"],
      ["status", "working", "blocked", "user", "needs key"],
    ]);
  });

  test("failed transitions leave no partial writes", async () => {
    const f = await fixture();
    const t = await addTask(f);
    const before = (await f.store.listEvents(f.projectId, t.key)).length;
    await rejects(() => f.store.setStatus(f.projectId, t.key, "done"), "illegal_transition");
    expect((await f.store.listEvents(f.projectId, t.key)).length).toBe(before);
    expect((await f.store.getTask(f.projectId, t.key)).status).toBe("todo");
  });
});

describe("projects", () => {
  test("registration is idempotent by root path and resolvable by id, name or path", async () => {
    const f = await fixture("demo");
    const again = await f.store.registerProject({
      rootPath: f.root,
      remoteUrl: "https://example.test/new.git",
    });
    expect(again.created).toBe(false);
    expect(again.project.id).toBe(f.projectId);
    expect(again.project.remote_url).toBe("https://example.test/new.git");
    expect((await f.store.resolveProject("demo")).id).toBe(f.projectId);
    expect((await f.store.resolveProject(f.projectId)).id).toBe(f.projectId);
    expect((await f.store.resolveProject(f.root)).id).toBe(f.projectId);
    await rejects(() => f.store.resolveProject("nope"), "not_found");
    await rejects(() => f.store.registerProject({ name: "demo", rootPath: tempDir() }), "conflict");
  });
});
