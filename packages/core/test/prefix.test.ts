import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LATEST_VERSION,
  MIGRATIONS,
  deriveProjectPrefix,
  migrationStatements,
  uniqueProjectPrefix,
} from "../src/index.ts";
import { cleanupAll, fixture, openStore, rejection, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await rejection(promise);
  return (error as { code?: string }).code;
}

describe("project prefixes", () => {
  test("derives a documented prefix from the name's words", () => {
    expect(deriveProjectPrefix("nf-stack")).toBe("NF");
    expect(deriveProjectPrefix("oxlint-rules")).toBe("OXR");
    expect(deriveProjectPrefix("demo")).toBe("DE");
    expect(deriveProjectPrefix("t3-code")).toBe("T3");
    expect(deriveProjectPrefix("oxlintRules")).toBe("OXR");
    expect(deriveProjectPrefix("eskais")).toBe("ES");
  });

  test("extends a colliding prefix with the following letters, then a number", () => {
    expect(uniqueProjectPrefix("nf-stack", new Set())).toBe("NF");
    expect(uniqueProjectPrefix("nf-stack", new Set(["NF"]))).toBe("NFS");
    expect(uniqueProjectPrefix("nf-stack", new Set(["NF", "NFS"]))).toBe("NFST");
    const exhausted = new Set(["NF", "NFS", "NFST", "NFSTA", "NFSTAC", "NFSTACK"]);
    expect(uniqueProjectPrefix("nf-stack", exhausted)).toBe("NFSTACK2");
    expect(uniqueProjectPrefix("---", new Set())).toBe("NF");
    expect(uniqueProjectPrefix("---", new Set(["NF"]))).toBe("NF2");
  });

  test("registration derives a unique prefix and re-keys with it; the legacy form keeps working", async () => {
    const f = await fixture();
    const project = (await f.store.registerProject({ name: "nf-stack", rootPath: tempDir() }))
      .project;
    expect(project.prefix).toBe("NF");
    const task = await f.store.addTask(project.id, {
      title: "prefixed",
      goal: "keys carry the prefix",
      acceptance: ["NF-001"],
    });
    expect(task.key).toBe("NF-001");
    const attempt = await f.store.startAttempt(project.id, "T-001", {
      kind: "implementation",
      mechanism: "direct",
    });
    expect(attempt).toMatchObject({ key: "NF-001-A1", task_key: "NF-001" });
    expect((await f.store.getTask(project.id, "T-001")).key).toBe("NF-001");
    expect((await f.store.getAttempt(project.id, "T-001-A1")).id).toBe(attempt.id);
    expect((await f.store.addReport(project.id, "T-001-A1", "checkpoint", "x")).attempt_key).toBe(
      "NF-001-A1",
    );

    const tools = (await f.store.registerProject({ name: "nf-stack-tools", rootPath: tempDir() }))
      .project;
    expect(tools.prefix).toBe("NFS");
    expect(
      await codeOf(f.store.registerProject({ name: "other", rootPath: tempDir(), prefix: "NF" })),
    ).toBe("conflict");
    expect(
      await codeOf(
        f.store.registerProject({ name: "another", rootPath: tempDir(), prefix: "not a prefix" }),
      ),
    ).toBe("bad_prefix");
  });

  test("changing the prefix re-keys its tasks and attempts and rejects duplicates", async () => {
    const f = await fixture();
    const project = (await f.store.registerProject({ name: "nf-stack", rootPath: tempDir() }))
      .project;
    const task = await f.store.addTask(project.id, {
      title: "t",
      goal: "g",
      acceptance: ["a"],
    });
    await f.store.startAttempt(project.id, task.key, {
      kind: "implementation",
      mechanism: "direct",
    });

    const changed = await f.store.setProjectPrefix(project.id, "stack");
    expect(changed.prefix).toBe("STACK");
    expect((await f.store.getTask(project.id, "T-001")).key).toBe("STACK-001");
    expect((await f.store.listAttempts(project.id, "T-001"))[0]?.key).toBe("STACK-001-A1");
    expect((await f.store.getAttempt(project.id, "STACK-001-A1")).task_key).toBe("STACK-001");
    expect((await f.store.getAttempt(project.id, "T-001-A1")).key).toBe("STACK-001-A1");
    expect((await f.store.setProjectPrefix(project.id, "STACK")).prefix).toBe("STACK");

    const other = (await f.store.registerProject({ name: "oxlint-rules", rootPath: tempDir() }))
      .project;
    expect(await codeOf(f.store.setProjectPrefix(other.id, "stack"))).toBe("conflict");
    expect(await codeOf(f.store.setProjectPrefix(other.id, ""))).toBe("bad_prefix");
  });

  test("the v6 migration assigns prefixes to existing projects and keeps numbers unchanged", async () => {
    const home = tempDir("nf-prefix-v5-");
    const db = new DatabaseSync(join(home, "nf.db"));
    try {
      for (const migration of MIGRATIONS.slice(0, 5))
        for (const statement of migrationStatements(migration)) db.exec(statement);
      db.exec("PRAGMA user_version = 5");
      const project = db.prepare(
        `INSERT INTO projects (id, machine_id, name, root_path, created_at)
         VALUES (?, 'm', ?, ?, '2026-01-01T00:00:00.000Z')`,
      );
      project.run("p1", "nf-stack", "C:/nf-stack");
      project.run("p2", "nf-stack-tools", "C:/tools");
      const task = db.prepare(
        `INSERT INTO tasks (id, machine_id, project_id, seq, key, title, goal, status,
           created_at, updated_at) VALUES (?, 'm', ?, ?, ?, ?, 'g', 'todo', 't', 't')`,
      );
      task.run("t1", "p1", 18, "T-018", "first");
      task.run("t2", "p2", 2, "T-002", "second");
      db.prepare(
        `INSERT INTO attempts (id, machine_id, task_id, seq, key, kind, status, mechanism,
           started_at, updated_at) VALUES ('a1', 'm', 't1', 1, 'T-018-A1', 'implementation',
           'active', 'fork', 't', 't')`,
      ).run();
    } finally {
      db.close();
    }

    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({
        user_version: LATEST_VERSION,
      });
      expect(LATEST_VERSION).toBe(10);
      expect(await opened.sql("SELECT COUNT(*) AS n FROM tasks")).toEqual([{ n: 2 }]);
      expect(await opened.sql("SELECT COUNT(*) AS n FROM attempts")).toEqual([{ n: 1 }]);
      expect((await opened.store.resolveProject("nf-stack")).prefix).toBe("NF");
      expect((await opened.store.resolveProject("nf-stack-tools")).prefix).toBe("NFS");
      expect((await opened.store.getTask("p1", "T-018")).key).toBe("NF-018");
      expect((await opened.store.getTask("p2", "T-002")).key).toBe("NFS-002");
      const attempt = await opened.store.getAttempt("p1", "T-018-A1");
      expect(attempt).toMatchObject({ key: "NF-018-A1", task_key: "NF-018" });
      expect((await opened.store.getTask("p1", "NF-018")).key).toBe("NF-018");
      expect(await opened.sql("SELECT seq, key FROM tasks ORDER BY seq")).toEqual([
        { seq: 2, key: "NFS-002" },
        { seq: 18, key: "NF-018" },
      ]);
    } finally {
      await opened.close();
    }
  });
});
