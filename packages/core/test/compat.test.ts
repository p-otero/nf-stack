import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LATEST_VERSION,
  MIGRATIONS,
  importTasksJson,
  migrationStatements,
  taskUsage,
  usageStats,
} from "../src/index.ts";
import { cleanupAll, openStore, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

// nf-v2.db was written by the plain-TypeScript nf (user_version 2) through its CLI; see
// fixtures/gen-v2.mjs. It must open with the Effect store unchanged and without data loss.
const FIXTURES = join(import.meta.dir, "fixtures");
const TABLES = [
  "projects",
  "tasks",
  "task_acceptance",
  "task_deps",
  "attempts",
  "attempt_commits",
  "attempt_checks",
  "attempt_reports",
  "task_events",
  "usage_events",
  "sync_state",
];

function v2Home(): string {
  const home = tempDir("nf-compat-");
  copyFileSync(join(FIXTURES, "nf-v2.db"), join(home, "nf.db"));
  copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));
  return home;
}

/** The v2 fixture with the v3 policy tables applied and user_version set to 3. */
function v3Home(): string {
  const home = v2Home();
  const db = new DatabaseSync(join(home, "nf.db"));
  try {
    for (const statement of migrationStatements(MIGRATIONS[2] as string)) db.exec(statement);
    db.exec("PRAGMA user_version = 3");
  } finally {
    db.close();
  }
  return home;
}

/** The v2 fixture with v3 and v4 applied and user_version set to 4. */
function v4Home(): string {
  const home = v2Home();
  const db = new DatabaseSync(join(home, "nf.db"));
  try {
    for (const migration of [MIGRATIONS[2], MIGRATIONS[3]])
      for (const statement of migrationStatements(migration as string)) db.exec(statement);
    db.exec("PRAGMA user_version = 4");
  } finally {
    db.close();
  }
  return home;
}

function snapshot(file: string): Record<string, unknown[]> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(
      TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
    );
  } finally {
    db.close();
  }
}

/**
 * Compare the v2 columns only: v4 inlines `strategy`, v5 `parent_attempt_id`, and v6 adds the
 * project prefix plus the re-keyed task and attempt keys.
 */
function withoutNewColumns(byTable: Record<string, unknown[]>): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(byTable).map(([table, rows]) => [
      table,
      rows.map((row) => {
        const rest = { ...(row as Record<string, unknown>) };
        delete rest["strategy"];
        delete rest["ui"];
        delete rest["pr_url"];
        delete rest["parent_attempt_id"];
        delete rest["coordinator_thread_id"];
        delete rest["coordinator_model"];
        delete rest["prefix"];
        delete rest["key"];
        return rest;
      }),
    ]),
  );
}

function userVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
    return row?.user_version ?? 0;
  } finally {
    db.close();
  }
}

function schema(file: string): unknown[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
      .all();
  } finally {
    db.close();
  }
}

describe("v2 store compatibility", () => {
  test("a v2 store written by the previous nf opens unchanged, with no data loss", async () => {
    const home = v2Home();
    const file = join(home, "nf.db");
    const before = snapshot(file);
    expect(before["usage_events"]?.length).toBeGreaterThan(0);
    expect(before["attempt_reports"]?.length).toBeGreaterThan(0);

    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({ user_version: 10 });
      expect(LATEST_VERSION).toBe(10);
      const project = await opened.store.resolveProject("demo");
      expect(project.prefix).toBe("DE");
      expect(opened.store.machine).toBe(project.machine_id);
      const tasks = await opened.store.listTasks({ projectId: project.id });
      expect(tasks.map((t) => t.key)).toEqual(["DE-001", "DE-002", "DE-003", "DE-004", "DE-005"]);
      // The legacy form still resolves; the result carries the prefixed key.
      const attempt = await opened.store.getAttempt(project.id, "T-004-A1");
      expect(attempt).toMatchObject({
        key: "DE-004-A1",
        task_key: "DE-004",
        status: "succeeded",
        options: { effort: "high" },
        commits: ["abc"],
        fallbacks: [{ route: "x", failure: "quota" }],
      });
      expect((await opened.store.getAttempt(project.id, "DE-004-A1")).id).toBe(attempt.id);
      expect(attempt.checks).toEqual([
        { position: 1, command: "bun test", result: "pass", detail: null },
      ]);
      const reports = await opened.store.listReports(project.id, "T-004-A1");
      expect(reports[0]).toMatchObject({ attempt_key: "DE-004-A1", body: "step 1\nnext" });
      const usage = await opened.run(taskUsage(project.id, "T-004"));
      expect(usage.task.key).toBe("DE-004");
      expect(usage.attempts[0]?.key).toBe("DE-004-A1");
      expect(usage.attempts[0]?.events).toBe(3);
      expect(usage.cost_to_acceptance.value).toBeCloseTo(0.000995, 12);
      const all = await opened.run(usageStats({ by: "task", allProjects: true }));
      expect(all.totals.events).toBe(6);
      expect(all.rows.map((row) => row.key)).toContain("DE-004");
    } finally {
      await opened.close();
    }
    const after = snapshot(file);
    expect(withoutNewColumns(after)).toEqual(withoutNewColumns(before));
    expect(after["tasks"]?.map((row) => (row as { key: string }).key)).toEqual([
      "DE-001",
      "DE-002",
      "DE-003",
      "DE-004",
      "DE-005",
    ]);
    expect(after["attempts"]?.map((row) => (row as { key: string }).key)).toEqual([
      "DE-001-A1",
      "DE-002-A1",
      "DE-002-A2",
      "DE-004-A1",
    ]);
    expect(after["tasks"]?.map((row) => (row as { strategy: unknown }).strategy)).toEqual(
      before["tasks"]?.map(() => null),
    );
  });

  test("a fresh store has the v2 physical schema plus the v3-v10 tables and columns", async () => {
    const home = tempDir("nf-fresh-");
    const opened = await openStore(home);
    await opened.close();
    const before = schema(join(FIXTURES, "nf-v2.db"));
    const after = schema(join(home, "nf.db"));
    const names = new Set(before.map((o) => (o as { name: string }).name));
    const added = after.filter((o) => !names.has((o as { name: string }).name));
    expect(added.filter((o) => (o as { type: string }).type === "table")).toEqual([
      {
        type: "table",
        name: "attempt_attachments",
        tbl_name: "attempt_attachments",
        sql: expect.stringContaining("CREATE TABLE attempt_attachments"),
      },
      {
        type: "table",
        name: "catalog_snapshots",
        tbl_name: "catalog_snapshots",
        sql: expect.stringContaining("CREATE TABLE catalog_snapshots"),
      },
      {
        type: "table",
        name: "coordinator_threads",
        tbl_name: "coordinator_threads",
        sql: expect.stringContaining("CREATE TABLE coordinator_threads"),
      },
      {
        type: "table",
        name: "route_blocks",
        tbl_name: "route_blocks",
        sql: expect.stringContaining("CREATE TABLE route_blocks"),
      },
      {
        type: "table",
        name: "subagent_spawns",
        tbl_name: "subagent_spawns",
        sql: expect.stringContaining("CREATE TABLE subagent_spawns"),
      },
    ]);
    // v4 and v5 are additive strategy and subagent columns; v6 the project prefix, v7 the UI
    // flag, v8 the attempt pull request, v9 its coordinator and the coordinator thread registry,
    // v10 the removal of the indexes no query reads.
    expect(added).toContainEqual({
      type: "index",
      name: "projects_prefix",
      tbl_name: "projects",
      sql: expect.stringContaining("CREATE UNIQUE INDEX projects_prefix"),
    });
    const dropped = [
      "coordinator_threads_thread",
      "subagent_spawns_child",
      "task_deps_reverse",
      "usage_events_ts",
    ];
    const afterNames = new Set(after.map((o) => (o as { name: string }).name));
    expect(dropped.filter((name) => afterNames.has(name))).toEqual([]);
    const changed = after.filter((o) => {
      const old = before.find((b) => (b as { name: string }).name === (o as { name: string }).name);
      return old !== undefined && JSON.stringify(old) !== JSON.stringify(o);
    }) as { name: string; sql: string }[];
    expect(changed.map((o) => o.name)).toEqual(["attempts", "projects", "tasks", "usage_events"]);
    expect(changed.map((o) => o.sql)).toEqual([
      expect.stringContaining("strategy TEXT"),
      expect.stringContaining("prefix TEXT"),
      expect.stringContaining("ui INTEGER NOT NULL DEFAULT 0"),
      expect.stringContaining("parent_attempt_id TEXT"),
    ]);
    // v10 drops the two v1/v2 indexes the fixture carries; the two it drops from v9 never
    // existed in the fixture, so they cancel out of the count.
    expect(after.length).toBe(before.length - 2 + added.length);
  });

  test("migrates a v3 store to the latest schema, leaving existing strategies NULL", async () => {
    const home = v3Home();
    expect(userVersion(join(home, "nf.db"))).toBe(3);
    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({ user_version: 10 });
      const project = await opened.store.resolveProject("demo");
      expect(project.prefix).toBe("DE");
      const tasks = await opened.store.listTasks({ projectId: project.id });
      expect(tasks.map((t) => t.key)).toEqual(["DE-001", "DE-002", "DE-003", "DE-004", "DE-005"]);
      expect(tasks.map((t) => t.strategy)).toEqual(tasks.map(() => null));
      const attempt = await opened.store.getAttempt(project.id, "T-004-A1");
      expect(attempt.task_key).toBe("DE-004");
      expect(attempt.strategy).toBeNull();
      // the columns are writable straight after the upgrade
      expect(
        (await opened.store.updateTask(project.id, "T-001", { strategy: "plan" })).strategy,
      ).toBe("plan");
    } finally {
      await opened.close();
    }
  });

  test("migrates a v4 store to the latest schema, preserving attempts and enabling direct attempts", async () => {
    const home = v4Home();
    const file = join(home, "nf.db");
    expect(userVersion(file)).toBe(4);
    const before = snapshot(file);

    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({ user_version: 10 });
      expect(await opened.sql("SELECT COUNT(*) AS n FROM subagent_spawns")).toEqual([{ n: 0 }]);
      expect(
        await opened.sql(
          "SELECT COUNT(*) AS n FROM usage_events WHERE parent_attempt_id IS NOT NULL",
        ),
      ).toEqual([{ n: 0 }]);
      const project = await opened.store.resolveProject("demo");
      expect(await opened.store.getAttempt(project.id, "T-004-A1")).toMatchObject({
        status: "succeeded",
        mechanism: "delegate_task",
        strategy: null,
      });
      // repair_of survives the attempts table rebuild.
      expect((await opened.store.getAttempt(project.id, "T-002-A2")).repair_of).toBe("DE-002-A1");
    } finally {
      await opened.close();
    }
    expect(withoutNewColumns(snapshot(file))).toEqual(withoutNewColumns(before));

    const writer = await openStore(home);
    try {
      const project = await writer.store.resolveProject("demo");
      const direct = await writer.store.startAttempt(project.id, "T-003", {
        kind: "implementation",
        mechanism: "direct",
        strategy: "direct",
      });
      expect(direct).toMatchObject({
        key: "DE-003-A1",
        task_key: "DE-003",
        mechanism: "direct",
        strategy: "direct",
        status: "dispatching",
      });
      const bad = await writer.store
        .startAttempt(project.id, "T-003", { kind: "research", mechanism: "teleport" })
        .catch((error: unknown) => error);
      expect((bad as Error).message).toMatch(/invalid mechanism 'teleport'/);
    } finally {
      await writer.close();
    }
  });

  test("the migrated store keeps accepting writes and re-imports idempotently", async () => {
    const opened = await openStore(v2Home());
    try {
      const project = await opened.store.resolveProject("demo");
      const t = await opened.store.addTask(project.id, {
        title: "after upgrade",
        goal: "g",
        acceptance: ["a"],
      });
      expect(t.key).toBe("DE-006");
      const doc = {
        schema_version: 2,
        tasks: [{ id: "T-001", title: "x", goal: "x", acceptance: ["x"], status: "todo" }],
      };
      expect(await opened.run(importTasksJson(project.id, doc))).toMatchObject({
        tasks_created: 0,
        tasks_skipped: 1,
      });
      const events = await opened.store.listEvents(project.id, "DE-006");
      expect(events.map((e) => e.kind)).toEqual(["created"]);
    } finally {
      await opened.close();
    }
  });
});
