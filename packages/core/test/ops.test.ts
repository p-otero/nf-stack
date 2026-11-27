import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  NfError,
  backupStore,
  gitInfo,
  importTasksJson,
  linkSkills,
  normalizePath,
} from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import {
  addTask,
  cleanupAll,
  fixture,
  openStore,
  rejection,
  startImpl,
  tempDir,
} from "./helpers.ts";

afterEach(cleanupAll);

const v1 = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "tasks-v1.json"), "utf8"),
) as unknown;

async function counts(f: Fixture) {
  const n = async (t: string) =>
    Number((await f.sql<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))[0]?.c);
  const out: number[] = [];
  for (const t of [
    "tasks",
    "task_acceptance",
    "task_deps",
    "attempts",
    "attempt_commits",
    "task_events",
  ]) {
    out.push(await n(t));
  }
  return out;
}

describe("import", () => {
  test("a v1 file is imported with tasks, acceptance, dependencies and attempts", async () => {
    const f = await fixture();
    const r = await f.run(importTasksJson(f.projectId, v1));
    expect(r).toMatchObject({
      schema_version: 1,
      tasks_created: 3,
      tasks_skipped: 0,
      attempts_created: 3,
      attempts_skipped: 0,
    });
    const t1 = await f.store.getTask(f.projectId, "T-001");
    expect(t1.status).toBe("done");
    expect(t1.acceptance.map((a) => a.result)).toEqual(["pass", "pass"]); // done stays consistent
    expect(t1.evidence).toContain("def5678");
    expect(t1.authorization).toContain("No push");
    const t2 = await f.store.getTask(f.projectId, "T-002");
    expect(t2.depends_on).toEqual(["T-001"]);
    expect(t2.blocker).toEqual({ identity: "quota", no_progress_cycles: 0 });
    expect((await f.store.getTask(f.projectId, "T-003")).depends_on).toEqual(["T-001", "T-002"]);
    expect((await f.store.getTask(f.projectId, "T-003")).design_ref).toBe("docs/login.md");

    const a1 = await f.store.getAttempt(f.projectId, "T-001-A1");
    expect(a1).toMatchObject({
      kind: "implementation",
      status: "succeeded",
      mechanism: "delegate_task",
      provider_instance_id: "codex",
      model: "gpt-x",
      thread_id: "thread-w1",
      t3_task_id: "t3-task-1",
      client_request_id: "req-1",
      base_commit: "abc1234",
      branch: "feat/login",
      commits: ["def5678"],
      profile: "bounded",
      reason: "small, well specified change",
      last_verified: "bun test passes",
    });
    const a21 = await f.store.getAttempt(f.projectId, "T-002-A1");
    expect(a21).toMatchObject({
      mechanism: "fork",
      failure_detail: "quota exhausted until 18:00",
      retry_at: "2026-11-15T18:00:00Z",
    });
    expect((await f.store.getAttempt(f.projectId, "T-002-A2")).repair_of).toBe("T-002-A1");
    expect((await f.store.summary(f.projectId)).live_attempts.map((a) => a.key)).toEqual([
      "T-002-A2",
    ]);
    expect((await f.store.getProject(f.projectId)).coordinator_thread_id).toBe(
      "thread-coordinator-1",
    );
  });

  test("importing twice is idempotent and does not clobber local changes", async () => {
    const f = await fixture();
    await f.run(importTasksJson(f.projectId, v1));
    await f.store.setStatus(f.projectId, "T-003", "working"); // local progress after the first import
    const before = await counts(f);
    const again = await f.run(importTasksJson(f.projectId, v1));
    expect(again).toMatchObject({
      tasks_created: 0,
      tasks_skipped: 3,
      attempts_created: 0,
      attempts_skipped: 3,
    });
    expect(await counts(f)).toEqual(before);
    expect((await f.store.getTask(f.projectId, "T-003")).status).toBe("working");
  });

  test("new attempts on an already imported task are added by attempt key", async () => {
    const f = await fixture();
    await f.run(importTasksJson(f.projectId, v1));
    const doc = structuredClone(v1) as { tasks: { id: string; attempts: unknown[] }[] };
    doc.tasks[0]?.attempts.push({
      id: "T-001-A2",
      kind: "review",
      status: "succeeded",
      mechanism: "delegate_task",
    });
    const r = await f.run(importTasksJson(f.projectId, doc));
    expect(r).toMatchObject({ tasks_created: 0, attempts_created: 1, attempts_skipped: 3 });
    expect((await f.store.getAttempt(f.projectId, "T-001-A2")).kind).toBe("review");
  });

  test("v2 fields round-trip", async () => {
    const f = await fixture();
    const doc = {
      schema_version: 2,
      coordinator: { environment_id: "env-1", thread_id: null, thread_link: null },
      tasks: [
        {
          id: "T-010",
          title: "Proposed one",
          goal: "g",
          acceptance: ["a"],
          status: "proposed",
          analysis_mode: "review",
          profile: "reasoning",
          source: "discussion",
          decision_needed: "which db",
          accepted_first_pass: null,
          human_interventions: 2,
          attempts: [
            {
              id: "T-010-A1",
              kind: "design",
              status: "succeeded",
              mechanism: "t3_thread_launch",
              context_mode: "compact",
              options: { effort: "high" },
              fallbacks: [{ route: "x" }],
              executed_model: "m2",
              retry_at: null,
              failure: { class: "quota", evidence: "429" },
            },
          ],
        },
      ],
    };
    const r = await f.run(importTasksJson(f.projectId, doc));
    expect(r.schema_version).toBe(2);
    const t = await f.store.getTask(f.projectId, "T-010");
    expect(t).toMatchObject({
      status: "proposed",
      analysis_mode: "review",
      human_interventions: 2,
      source: "discussion",
      decision_needed: "which db",
    });
    expect(t.acceptance[0]?.result).toBe("unverified");
    expect(await f.store.getAttempt(f.projectId, "T-010-A1")).toMatchObject({
      context_mode: "compact",
      options: { effort: "high" },
      fallbacks: [{ route: "x" }],
      executed_model: "m2",
      failure_class: "quota",
      failure_detail: "429",
    });
    expect((await f.store.getProject(f.projectId)).coordinator_environment_id).toBe("env-1");
    // the next native task continues after the imported numbering
    expect((await addTask(f)).key).toBe("T-011");
  });

  test("bad input is rejected as a whole and leaves nothing behind", async () => {
    const f = await fixture();
    const reject = async (doc: unknown) =>
      expect(await rejection(f.run(importTasksJson(f.projectId, doc)))).toBeInstanceOf(NfError);
    await reject(null);
    await reject({ schema_version: 3, tasks: [] });
    await reject({ schema_version: 2 });
    const cyc = {
      schema_version: 2,
      tasks: [
        {
          id: "T-001",
          title: "a",
          goal: "a",
          acceptance: ["x"],
          status: "todo",
          depends_on: ["T-002"],
        },
        {
          id: "T-002",
          title: "b",
          goal: "b",
          acceptance: ["x"],
          status: "todo",
          depends_on: ["T-001"],
        },
      ],
    };
    await reject(cyc);
    await reject({
      schema_version: 2,
      tasks: [
        {
          id: "T-001",
          title: "a",
          goal: "a",
          acceptance: ["x"],
          status: "todo",
          depends_on: ["T-404"],
        },
      ],
    });
    await reject({
      schema_version: 2,
      tasks: [{ id: "T-001", title: "a", goal: "a", acceptance: ["x"], status: "weird" }],
    });
    expect(await counts(f)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("backup", () => {
  test("VACUUM INTO produces a standalone, readable copy", async () => {
    const f = await fixture();
    await f.run(importTasksJson(f.projectId, v1));
    const t = await addTask(f);
    const a = await startImpl(f, t.key);
    await f.store.addReport(f.projectId, a.key, "result", "all good");
    const file = await f.run(backupStore(f.home, { now: new Date("2026-11-15T21:35:00Z") }));
    expect(file).toBe(join(f.home, "backups", "nf-20261115T213500Z.db"));
    expect(existsSync(file)).toBe(true);
    // a second backup in the same second does not overwrite
    const second = await f.run(backupStore(f.home, { now: new Date("2026-11-15T21:35:00Z") }));
    expect(basename(second)).toBe("nf-20261115T213500Z-1.db");

    // mutate the live store afterwards; the backup must not see it
    await f.store.finishAttempt(f.projectId, a.key, { status: "cancelled" });
    await f.store.setStatus(f.projectId, t.key, "cancelled", { reason: "x" });

    const restoreHome = tempDir("nf-restore-");
    mkdirSync(restoreHome, { recursive: true });
    writeFileSync(join(restoreHome, "nf.db"), readFileSync(file));
    writeFileSync(join(restoreHome, "machine-id"), readFileSync(join(f.home, "machine-id")));
    const restored = await openStore(restoreHome);
    try {
      const project = (await restored.store.listProjects())[0];
      expect(project?.id).toBe(f.projectId);
      expect((await restored.store.listTasks({ projectId: f.projectId })).length).toBe(4);
      expect((await restored.store.getTask(f.projectId, t.key)).status).toBe("working");
      expect((await restored.store.listReports(f.projectId, a.key)).map((r) => r.body)).toEqual([
        "all good",
      ]);
      expect((await restored.store.getAttempt(f.projectId, "T-001-A1")).commits).toEqual([
        "def5678",
      ]);
    } finally {
      await restored.close();
    }
    expect(readdirSync(join(f.home, "backups")).toSorted()).toEqual([
      "nf-20261115T213500Z-1.db",
      "nf-20261115T213500Z.db",
    ]);
  });
});

function skillsSource() {
  const dir = tempDir("nf-skills-src-");
  for (const n of ["nf-meta", "nf-worker"]) {
    mkdirSync(join(dir, n), { recursive: true });
    writeFileSync(
      join(dir, n, "SKILL.md"),
      `---
name: ${n}
---
`,
    );
  }
  mkdirSync(join(dir, "other"), { recursive: true }); // not an nf skill
  return dir;
}

const targets = (home: string) =>
  [".agents", ".claude"].flatMap((d) =>
    ["nf-meta", "nf-worker"].map((n) => join(home, d, "skills", n)),
  );

describe("skills link", () => {
  test("creates links, is idempotent, and links resolve to the source", () => {
    const skillsDir = skillsSource();
    const home = tempDir("nf-home-fake-");
    const first = linkSkills({ home, skillsDir });
    expect(first.map((r) => r.action)).toEqual(["created", "created", "created", "created"]);
    for (const t of targets(home)) {
      expect(lstatSync(t).isSymbolicLink()).toBe(true);
      expect(existsSync(join(t, "SKILL.md"))).toBe(true);
      expect(realpathSync(t).toLowerCase()).toBe(
        realpathSync(join(skillsDir, basename(t))).toLowerCase(),
      );
    }
    expect(existsSync(join(home, ".claude", "skills", "other"))).toBe(false);
    const second = linkSkills({ home, skillsDir });
    expect(second.map((r) => r.action)).toEqual(["linked", "linked", "linked", "linked"]);
  });

  test("dry run changes nothing", () => {
    const skillsDir = skillsSource();
    const home = tempDir("nf-home-fake-");
    const r = linkSkills({ home, skillsDir, dryRun: true });
    expect(r.every((x) => x.action === "would-create")).toBe(true);
    expect(existsSync(join(home, ".agents"))).toBe(false);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  test("a real folder or a link pointing elsewhere is skipped unless forced", () => {
    const skillsDir = skillsSource();
    const elsewhere = tempDir("nf-skills-other-");
    mkdirSync(join(elsewhere, "nf-worker"), { recursive: true });
    writeFileSync(join(elsewhere, "nf-worker", "SKILL.md"), "---\nname: nf-worker\n---\n");
    const home = tempDir("nf-home-fake-");
    // real folder at one target, link to another checkout at another
    mkdirSync(join(home, ".agents", "skills", "nf-meta"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "nf-meta", "keep.txt"), "mine");
    linkSkills({ home, skillsDir: elsewhere }); // nf-worker -> elsewhere in both dirs

    const r = linkSkills({ home, skillsDir });
    const by = (dir: string, name: string) =>
      r.find((x) => x.target === join(home, dir, "skills", name));
    expect(by(".agents", "nf-meta")?.action).toBe("skipped");
    expect(by(".agents", "nf-worker")?.action).toBe("skipped");
    expect(by(".agents", "nf-worker")?.note).toContain("points elsewhere");
    expect(by(".claude", "nf-meta")?.action).toBe("created");
    expect(readFileSync(join(home, ".agents", "skills", "nf-meta", "keep.txt"), "utf8")).toBe(
      "mine",
    );

    const dry = linkSkills({ home, skillsDir, force: true, dryRun: true });
    expect(dry.filter((x) => x.action === "would-replace").length).toBe(3);
    expect(existsSync(join(home, ".agents", "skills", "nf-meta", "keep.txt"))).toBe(true);

    const forced = linkSkills({ home, skillsDir, force: true });
    expect(forced.filter((x) => x.action === "replaced").length).toBe(3);
    const moved = readdirSync(join(home, ".agents", "skills")).find((n) =>
      n.startsWith("nf-meta.bak-"),
    );
    expect(moved).toBeDefined();
    expect(readFileSync(join(home, ".agents", "skills", moved as string, "keep.txt"), "utf8")).toBe(
      "mine",
    );
    expect(realpathSync(join(home, ".agents", "skills", "nf-worker")).toLowerCase()).toBe(
      realpathSync(join(skillsDir, "nf-worker")).toLowerCase(),
    );
    expect(existsSync(join(elsewhere, "nf-worker"))).toBe(true); // the old target was never touched
  });
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("git project discovery", () => {
  test("a linked worktree maps to the primary checkout", () => {
    const repo = tempDir("nf-repo-");
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.test");
    git(repo, "config", "user.name", "t");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "remote", "add", "origin", "https://example.test/x.git");
    const wt = join(tempDir("nf-wt-parent-"), "wt");
    git(repo, "worktree", "add", "-q", wt, "-b", "side");

    const main = gitInfo(repo);
    const side = gitInfo(wt);
    expect(main?.root).toBe(normalizePath(realpathSync(repo)).replace(/\\/g, "/"));
    expect(side?.root).toBe(main?.root as string);
    expect(main?.remoteUrl).toBe("https://example.test/x.git");
    expect(gitInfo(tempDir("nf-nogit-"))).toBeNull();
  });
});
