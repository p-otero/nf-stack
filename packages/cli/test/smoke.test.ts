import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { main } from "../src/main.ts";

// Most of these tests execute the CLI with *node* (not bun): it must run through Node's type
// stripping. The lifecycle below is the exception and says why.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const FIXTURES = join(import.meta.dir, "..", "..", "core", "test", "fixtures");
const V1 = join(FIXTURES, "tasks-v1.json");

// A call through runner() is a fresh node process, so these tests need room for a slow machine.
setDefaultTimeout(60_000);

// One lifecycle step measured on this machine: median ~0.5 s, max 1.06 s, idle and beside a full
// `bun run verify`; 20 s leaves ~19x for a slower or busier machine.
const STEP_TIMEOUT_MS = 20_000;

const dirs: string[] = [];
afterEach(() => cleanup(dirs));

function cleanup(list: string[]): void {
  while (list.length > 0)
    rmSync(list.pop() as string, { recursive: true, force: true, maxRetries: 5 });
}

function tmp(prefix: string, into: string[] = dirs): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  into.push(d);
  return d;
}

function repo(into: string[] = dirs): string {
  const dir = tmp("nf-smoke-repo-", into);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://example.test/smoke.git"], { cwd: dir });
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
  /** Parsed stdout; each test narrows it to the shape its command writes. */
  json: () => any;
}

function runner(home: string, cwd: string, extraEnv: Record<string, string> = {}) {
  return (args: string[], input?: string): Run => {
    const r = spawnSync(NODE, [BIN, ...args], {
      cwd,
      input,
      encoding: "utf8",
      // NF_OFFLINE keeps a sync from fetching OpenRouter's catalog during a test.
      env: { ...process.env, NF_HOME: home, NF_OFFLINE: "1", ...extraEnv },
    });
    return {
      code: r.status ?? -1,
      out: r.stdout,
      err: r.stderr,
      json: () => JSON.parse(r.stdout),
    };
  };
}

/**
 * Calls `main` — what the bin shim awaits — in this process: the same argv parsing, Effect programs
 * and SQLite writes, but a store open instead of a Node start. `version, help and usage errors`
 * and `golden.test.ts` keep driving the shipped bin under Node.
 */
function inProcess(home: string, cwd: string, extraEnv: Record<string, string> = {}) {
  return async (args: string[], input?: string): Promise<Run> => {
    let out = "";
    let err = "";
    const code = await main(
      args,
      {
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
        readStdin: async () => input ?? "",
      },
      { ...process.env, NF_HOME: home, NF_OFFLINE: "1", ...extraEnv },
      cwd,
    );
    return { code, out, err, json: () => JSON.parse(out) };
  };
}

describe("nf CLI under node", () => {
  test("version, help and usage errors", () => {
    const nf = runner(tmp("nf-home-"), tmp("nf-cwd-"));
    const v = nf(["--version"]);
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^nf \d+\.\d+\.\d+\n$/);
    expect(v.err).toBe(""); // no node:sqlite ExperimentalWarning leaks
    expect(nf(["help"]).out).toContain("attempt report");
    const bad = nf(["frobnicate"]);
    expect(bad.code).toBe(2);
    expect(bad.err.trim().split("\n").length).toBe(1);
    const outside = nf(["status"]);
    expect(outside.code).toBe(1);
    expect(outside.err).toMatch(/^nf: /);
  });

  test("project prefixes: derived keys, legacy lookup and nf project set", () => {
    const home = tmp("nf-home-");
    const cwd = repo();
    const nf = runner(home, cwd);
    const init = nf(["init", "--json"]);
    expect(init.code).toBe(0);
    expect(init.json().project.prefix).toBe("NF");
    expect(
      nf(["task", "add", "--title", "P", "--goal", "g", "--acceptance", "a", "--json"]).json().key,
    ).toBe("NF-001");
    expect(nf(["task", "show", "T-001", "--json"]).json().key).toBe("NF-001");
    expect(
      nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "implementation",
        "--mechanism",
        "direct",
      ]).out.trim(),
    ).toMatch(/^NF-001-A1\s+\S+$/);
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json().task_key).toBe("NF-001");

    const set = nf(["project", "set", "--prefix", "smoke", "--json"]);
    expect(set.code).toBe(0);
    expect(set.json().prefix).toBe("SMOKE");
    expect(nf(["task", "show", "T-001", "--json"]).json().key).toBe("SMOKE-001");
    expect(nf(["status"]).out).toContain("SMOKE-001-A1");
    expect(nf(["task", "show", "NF-001"]).code).toBe(1);

    const otherCwd = repo();
    const other = runner(home, otherCwd);
    const duplicate = other(["init", "--json", "--prefix", "SMOKE"]);
    expect(duplicate.code).toBe(1);
    expect(duplicate.err).toMatch(/prefix SMOKE is already used by project/);
    expect(other(["init", "--json", "--prefix", "oxr"]).json().project.prefix).toBe("OXR");
    expect(
      other(["task", "add", "--title", "x", "--goal", "g", "--acceptance", "a", "--json"]).json()
        .key,
    ).toBe("OXR-001");
  });

  test("a linked git worktree finds the project of its primary checkout", () => {
    const home = tmp("nf-home-");
    const cwd = repo();
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "i"], { cwd });
    const wt = join(tmp("nf-wt-"), "wt");
    execFileSync("git", ["worktree", "add", "-q", wt, "-b", "side"], { cwd });
    expect(runner(home, cwd)(["init", "--prefix", "T"]).code).toBe(0);
    expect(
      runner(home, cwd)(["task", "add", "--title", "t", "--goal", "g", "--acceptance", "a"]).code,
    ).toBe(0);
    const fromWt = runner(home, wt)(["status", "--json"]);
    expect(fromWt.code).toBe(0);
    expect(fromWt.json().total).toBe(1);
  });

  test("import of a v1 file is idempotent and leaves the source untouched", () => {
    const home = tmp("nf-home-");
    const cwd = repo();
    const nf = runner(home, cwd);
    nf(["init", "--prefix", "T"]);
    const src = join(cwd, ".nf");
    mkdirSync(src, { recursive: true });
    const file = join(src, "tasks.json");
    writeFileSync(file, readFileSync(V1));
    const before = readFileSync(file, "utf8");

    const first = nf(["import", "--json"]); // default path: .nf/tasks.json
    expect(first.code).toBe(0);
    expect(first.json()).toMatchObject({
      schema_version: 1,
      tasks_created: 3,
      tasks_skipped: 0,
      attempts_created: 3,
      attempts_skipped: 0,
    });
    const again = nf(["import", file]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("tasks: 0 created, 3 skipped");
    expect(again.out).toContain("attempts: 0 created, 3 skipped");
    expect(readFileSync(file, "utf8")).toBe(before);

    const status = nf(["status", "--json"]).json();
    expect(status.counts).toMatchObject({ done: 1, working: 1, todo: 1 });
    expect(status.live_attempts.map((a: { key: string }) => a.key)).toEqual(["T-002-A2"]);
    expect(nf(["task", "show", "T-003", "--json"]).json().depends_on).toEqual(["T-001", "T-002"]);
    // numbering continues after the imported tasks
    expect(
      nf(["task", "add", "--title", "n", "--goal", "g", "--acceptance", "a", "--json"]).json().key,
    ).toBe("T-004");
    expect(nf(["import", join(src, "missing.json")]).code).toBe(1);
  });

  test("sync ingests T3 and Pi usage and stats reports it", () => {
    const home = tmp("nf-home-");
    const cwd = repo();
    const data = tmp("nf-usage-");
    const t3 = join(data, "statev2.sqlite");
    const pi = join(data, "sessions");
    const piDir = join(pi, "proj");
    const prices = join(data, "usage-model-rates.json");
    mkdirSync(piDir, { recursive: true });

    const db = new DatabaseSync(t3);
    db.exec(`
      CREATE TABLE orchestration_v2_projection_provider_threads (
        provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT NOT NULL,
        provider_instance_id TEXT, updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL
      );
      CREATE TABLE orchestration_v2_projection_provider_turns (
        provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
        provider_thread_id TEXT NOT NULL, run_attempt_id TEXT, ordinal INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE orchestration_v2_projection_subagents (
        subagent_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT,
        parent_node_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL,
        provider_thread_id TEXT, child_thread_id TEXT, origin TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE orchestration_v2_projection_run_attempts (
        attempt_id TEXT PRIMARY KEY, run_id TEXT
      );
    `);
    db.prepare(
      `INSERT INTO orchestration_v2_projection_subagents
         (subagent_id, thread_id, run_id, parent_node_id, provider, provider_thread_id,
          child_thread_id, origin, status, started_at, completed_at, payload_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "sub-smoke",
      "thread-smoke",
      "run-smoke",
      "node-smoke",
      "claudeAgent",
      "pt-child",
      "thread-smoke-child",
      "app_owned",
      "completed",
      "2026-01-01T10:21:00Z",
      "2026-01-01T10:25:00Z",
      JSON.stringify({ model: "claude-test", title: "smoke child" }),
    );
    db.prepare(
      `INSERT INTO orchestration_v2_projection_provider_threads
         (provider_thread_id, thread_id, provider, payload_json) VALUES (?,?,?,?)`,
    ).run(
      "pt-smoke",
      "thread-smoke",
      "claudeAgent",
      JSON.stringify({ nativeThreadRef: { nativeId: "uuid-smoke" } }),
    );
    db.prepare(
      `INSERT INTO orchestration_v2_projection_provider_turns
         (provider_turn_id, thread_id, provider_thread_id, ordinal, status, started_at,
          completed_at, payload_json) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      "turn-smoke",
      "thread-smoke",
      "pt-smoke",
      1,
      "completed",
      "2026-01-01T10:20:00Z",
      "2026-01-01T10:30:00Z",
      JSON.stringify({
        model: "claude-test",
        turnTokenUsage: {
          inputTokens: 1000,
          outputTokens: 100,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          usageStatus: "complete",
          hasSubagents: false,
          models: ["claude-test"],
          otherUsage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
    );
    db.close();

    writeFileSync(
      join(piDir, "a.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "pi-smoke",
          timestamp: "2026-01-01T10:00:00Z",
        }),
        JSON.stringify({
          type: "message",
          id: "e1",
          timestamp: "2026-01-01T10:05:00Z",
          message: {
            role: "assistant",
            provider: "pi-provider",
            model: "pi-model",
            responseId: "resp-smoke",
            usage: {
              input: 10,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: 0,
              totalTokens: 15,
              cost: { total: 0.0002 },
            },
          },
        }),
      ].join("\n") + "\n",
    );
    writeFileSync(
      prices,
      JSON.stringify({
        fetchedAtMs: 1767225600000,
        document: {
          "claude-test": {
            input_cost_per_token: 0.000001,
            output_cost_per_token: 0.000002,
            cache_read_input_token_cost: 0.0000001,
            cache_creation_input_token_cost: 0.0000005,
          },
        },
      }),
    );

    const nf = runner(home, cwd, {
      NF_T3_STATE: t3,
      NF_PI_SESSIONS: pi,
      NF_PRICES: prices,
    });
    expect(nf(["init", "--prefix", "T"]).code).toBe(0);
    writeFileSync(
      join(data, "tasks.json"),
      JSON.stringify({
        schema_version: 2,
        tasks: [
          {
            id: "T-001",
            title: "Usage",
            goal: "attribute",
            status: "done",
            acceptance: [{ text: "works", result: "pass" }],
            attempts: [
              {
                id: "T-001-A1",
                kind: "implementation",
                status: "succeeded",
                mechanism: "delegate_task",
                thread_id: "thread-smoke",
                started_at: "2026-01-01T10:00:00Z",
                ended_at: "2026-01-01T11:00:00Z",
              },
            ],
          },
        ],
      }),
    );
    expect(nf(["import", join(data, "tasks.json")]).code).toBe(0);

    const dry = nf(["sync", "--dry-run", "--json"]);
    expect(dry.code).toBe(0);
    expect(dry.json().inserted).toBe(2);

    const synced = nf(["sync", "--json"]);
    expect(synced.code).toBe(0);
    expect(synced.err).toBe("");
    expect(synced.json()).toMatchObject({
      inserted: 2,
      updated: 0,
      skipped: 0,
      attributed: 1,
      spawns: 1,
      price_date: "2026-01-01",
    });
    const again = nf(["sync", "--json"]);
    expect(again.json()).toMatchObject({ inserted: 0, skipped: 2 });
    expect(again.json().price_sources).toEqual([{ source: "litellm", date: "2026-01-01" }]);
    expect(nf(["sync"]).out).toContain("prices: litellm 2026-01-01");

    const stats = nf(["stats", "--json"]).json();
    expect(stats.totals.events).toBe(1);
    expect(stats.totals.cost.value).toBeCloseTo(0.0012, 10);
    expect(stats.totals.cost.quality).toBe("estimated");
    expect(nf(["stats"]).out).toContain("~$0.001200");
    expect(nf(["stats", "--by", "model"]).out).toContain("SPAWNS");
    expect(nf(["stats", "--by", "model"]).out).toContain("claude-test");
    expect(nf(["stats", "--by", "model"]).out).toContain("prices: litellm");
    expect(nf(["stats", "--by", "strategy"]).out).toContain("prices: litellm");
    expect(nf(["stats", "--by", "strategy", "--json"]).json().price_sources).toEqual(["litellm"]);
    expect(nf(["stats", "--by", "context"]).out).toContain("prices: litellm");
    expect(nf(["stats", "--by", "context", "--json"]).json().price_sources).toEqual(["litellm"]);
    expect(nf(["stats", "--all-projects", "--json"]).json().totals.events).toBe(2);
    expect(nf(["stats", "--project"]).code).toBe(0);

    const task = nf(["stats", "task", "T-001", "--json"]).json();
    expect(task.done).toBe(true);
    expect(task.attempts.map((a: { key: string }) => a.key)).toEqual(["T-001-A1"]);
    expect(task.attempts[0].subagents.count).toBe(1);
    expect(task.cost_to_acceptance.value).toBeCloseTo(0.0012, 10);
    expect(task.cost_to_acceptance.quality).toBe("estimated");
    expect(nf(["stats", "task", "T-001"]).out).toContain("cost to acceptance: ~$0.001200");
    expect(nf(["stats", "task", "T-001"]).out).toContain("SUBAGENTS");
    expect(nf(["stats", "task", "T-001"]).out).toContain("app_owned");
  });

  test("coordinator register records threads and attempt start carries the coordinator", () => {
    const nf = runner(tmp("nf-home-"), repo());
    expect(nf(["init", "--prefix", "T", "--json"]).json().created).toBe(true);

    const missing = nf(["coordinator", "register"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("--thread");

    const registered = nf(["coordinator", "register", "--thread", "thread-meta", "--json"]);
    expect(registered.code).toBe(0);
    expect(registered.json()).toMatchObject({
      thread: "thread-meta",
      created: true,
      threads: ["thread-meta"],
    });
    expect(nf(["coordinator", "register", "--thread", "thread-meta"]).out).toContain(
      "already registered thread-meta",
    );
    expect(
      nf(["coordinator", "register", "--thread", "thread-meta", "--json"]).json(),
    ).toMatchObject({ created: false });

    nf(["task", "add", "--title", "Coordinated", "--goal", "g", "--acceptance", "a"]);
    expect(
      nf(["attempt", "start", "T-001", "--kind", "implementation", "--mechanism", "delegate_task"])
        .code,
    ).toBe(0);
    expect(nf(["attempt", "show", "T-001-A1", "--json"]).json()).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: null,
    });

    nf(["attempt", "finish", "T-001-A1", "--status", "succeeded", "--outcome", "ok"]);
    expect(
      nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "research",
        "--mechanism",
        "delegate_task",
        "--coordinator-model",
        "model-chosen",
      ]).code,
    ).toBe(0);
    expect(nf(["attempt", "show", "T-001-A2", "--json"]).json()).toMatchObject({
      coordinator_thread_id: "thread-meta",
      coordinator_model: "model-chosen",
    });

    const stats = nf(["stats", "--by", "coordinator", "--profile-breakdown", "--json"]).json();
    expect(stats).toMatchObject({ by: "coordinator", profile_breakdown: true });
    // Nothing synced usage yet, so the view has no price layer to name.
    expect(stats.price_sources).toEqual([]);
    expect(
      stats.rows
        .filter((row: { profile?: string | null }) => row.profile === undefined)
        .map((row: { coordinator: string | null; tasks: number }) => [row.coordinator, row.tasks]),
    ).toEqual([
      ["model-chosen", 1],
      [null, 1],
    ]);
    expect(nf(["stats", "--by", "coordinator"]).out).toContain("TOTAL/ACCEPTED");
    expect(nf(["stats", "--by", "coordinator", "--profile-breakdown"]).out).toContain("PROFILE");
    expect(nf(["stats", "--profile-breakdown"]).code).toBe(2);
  });

  test("opening an older store backs it up before migrating and names the copy on stderr", () => {
    const home = tmp("nf-home-");
    copyFileSync(join(FIXTURES, "nf-v2.db"), join(home, "nf.db"));
    copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));
    const nf = runner(home, tmp("nf-cwd-"));
    const opened = nf(["status", "--project", "demo"]);
    expect(opened.code).toBe(0);
    const copies = readdirSync(join(home, "backups"));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^nf-pre-v2-\d{8}T\d{6}Z\.db$/);
    expect(opened.err).toContain(join(home, "backups", copies[0] as string));
    expect(opened.err.trim().split("\n")).toHaveLength(1);

    const again = nf(["status", "--project", "demo"]);
    expect(again.code).toBe(0);
    expect(again.err).toBe("");
    expect(readdirSync(join(home, "backups"))).toHaveLength(1);
  });

  test("NF_BACKUP_KEEP bounds the backups directory", () => {
    const home = tmp("nf-home-");
    const cwd = repo();
    const nf = runner(home, cwd);
    nf(["init", "--prefix", "T"]);
    for (let i = 0; i < 4; i++) expect(nf(["backup"]).code).toBe(0);
    expect(readdirSync(join(home, "backups"))).toHaveLength(4);

    const small = runner(home, cwd, { NF_BACKUP_KEEP: "2" });
    expect(small(["backup"]).code).toBe(0);
    expect(readdirSync(join(home, "backups"))).toHaveLength(2);

    // a value that is not a positive integer keeps the documented default of 10
    const invalid = runner(home, cwd, { NF_BACKUP_KEEP: "0" });
    expect(invalid(["backup"]).code).toBe(0);
    expect(readdirSync(join(home, "backups"))).toHaveLength(3);
  });

  test("skills link uses a temp home and is idempotent", () => {
    const nf = runner(tmp("nf-home-"), tmp("nf-cwd-"));
    const home = tmp("nf-fake-home-");
    const dry = nf(["skills", "link", "--dry-run", "--home", home]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would-create");
    expect(existsSync(join(home, ".claude"))).toBe(false);
    const real = nf(["skills", "link", "--home", home, "--json"]);
    expect(real.code).toBe(0);
    const results = real.json() as { action: string; name: string }[];
    expect(results.every((r) => r.action === "created")).toBe(true);
    expect(results.map((r) => r.name)).toContain("nf-worker");
    expect(results.map((r) => r.name)).toContain("nf-direct");
    expect(results.map((r) => r.name)).toContain("nf-autoconfigure");
    expect(existsSync(join(home, ".agents", "skills", "nf-meta", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".agents", "skills", "nf-direct", "SKILL.md"))).toBe(true);
    expect(nf(["skills", "link", "--home", home]).out).toContain("already linked");
  });
});

describe("task and attempt lifecycle", () => {
  const shared: string[] = [];
  const home = tmp("nf-home-", shared);
  const cwd = repo(shared);
  const nf = inProcess(home, cwd);
  // The steps run in order against this one store; a failure names the step it broke.
  let key: string;

  afterAll(() => cleanup(shared));

  test(
    "registers the project and adds tasks with dependencies",
    async () => {
      const init = await nf(["init", "--json", "--prefix", "T"]);
      expect(init.code).toBe(0);
      expect(init.err).toBe("");
      expect(init.json().created).toBe(true);
      expect(init.json().project.remote_url).toBe("https://example.test/smoke.git");
      expect((await nf(["init"])).out).toContain("already registered");

      const t1 = await nf([
        "task",
        "add",
        "--title",
        "First",
        "--goal",
        "do first",
        "--acceptance",
        "a one",
        "--acceptance",
        "a two",
        "--strategy",
        "cheap",
        "--json",
      ]);
      expect(t1.code).toBe(0);
      expect(t1.json().key).toBe("T-001");
      expect(t1.json().acceptance.length).toBe(2);
      expect(t1.json().strategy).toBe("cheap");
      const badStrategy = await nf([
        "task",
        "add",
        "--title",
        "x",
        "--goal",
        "y",
        "--acceptance",
        "z",
        "--strategy",
        "barato",
      ]);
      expect(badStrategy.code).toBe(1);
      expect(badStrategy.err).toMatch(/invalid strategy 'barato'/);
      const t2 = await nf([
        "task",
        "add",
        "--title",
        "Second",
        "--goal",
        "do second",
        "--acceptance",
        "b",
        "--depends-on",
        "T-001",
        "--json",
      ]);
      expect(t2.json().depends_on).toEqual(["T-001"]);
      const unknownDependency = await nf([
        "task",
        "add",
        "--title",
        "x",
        "--goal",
        "y",
        "--acceptance",
        "z",
        "--depends-on",
        "T-099",
      ]);
      expect(unknownDependency.code).toBe(1);

      // readiness: only T-001 is ready, T-002 waits on it
      expect((await nf(["task", "next", "--json"])).json().key).toBe("T-001");
      expect((await nf(["task", "list"])).out).toContain("T-002  todo      Second  (after T-001)");
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "starts attempts and refuses a second writer",
    async () => {
      const started = await nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "implementation",
        "--mechanism",
        "delegate_task",
        "--provider",
        "codex",
        "--model",
        "gpt-x",
        "--profile",
        "bounded",
        "--reason",
        "smoke",
        "--options",
        '{"effort":"high"}',
        "--client-request-id",
        "req-1",
        "--base-commit",
        "abc123",
      ]);
      expect(started.code).toBe(0);
      const [startedKey, clientRequestId] = started.out.trim().split(/\s+/);
      key = startedKey ?? "";
      expect(key).toBe("T-001-A1");
      expect(clientRequestId).toBe("req-1");
      // the attempt inherits the task's strategy unless it names one
      expect((await nf(["attempt", "show", key, "--json"])).json().strategy).toBe("cheap");
      const research = await nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "research",
        "--mechanism",
        "fork",
        "--strategy",
        "plan",
      ]);
      expect(research.code).toBe(0);
      const researchKey = research.out.trim().split(/\s+/)[0] ?? "";
      const researched = await nf(["attempt", "show", researchKey, "--json"]);
      expect(researched.json().strategy).toBe("plan");
      expect((await nf(["attempt", "finish", researchKey, "--status", "cancelled"])).code).toBe(0);
      const invalidStrategy = await nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "design",
        "--mechanism",
        "fork",
        "--strategy",
        "x",
      ]);
      expect(invalidStrategy.err).toMatch(/invalid strategy 'x'/);
      // a second writer is refused, a retransmitted dispatch is not duplicated
      const second = await nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "implementation",
        "--mechanism",
        "fork",
      ]);
      expect(second.code).toBe(1);
      expect(second.err).toMatch(/already has a writing attempt T-001-A1/);
      const retransmitted = await nf([
        "attempt",
        "start",
        "T-001",
        "--kind",
        "implementation",
        "--mechanism",
        "delegate_task",
        "--client-request-id",
        "req-1",
      ]);
      expect(retransmitted.out.trim()).toBe(`${key}  req-1`);
      expect((await nf(["task", "next", "--json"])).json()).toBeNull(); // T-001 is owned by a live attempt

      // the writing attempt already moved the task to working
      expect((await nf(["task", "show", "T-001", "--json"])).json().status).toBe("working");
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "records attempt updates, reports and the task status",
    async () => {
      const upd = await nf([
        "attempt",
        "update",
        key,
        "--status",
        "active",
        "--thread-id",
        "thread-1",
        "--thread-link",
        "t3://thread-1",
        "--t3-task-id",
        "task-1",
        "--executed-model",
        "gpt-x",
        "--worktree",
        "/w/1",
        "--branch",
        "feat/x",
        "--add-commit",
        "abc",
        "--add-fallback",
        '{"route":"claude","failure":"quota"}',
        "--add-check",
        '{"command":"bun test","result":"pass"}',
        "--json",
      ]);
      expect(upd.code).toBe(0);
      expect(upd.json()).toMatchObject({
        status: "active",
        thread_id: "thread-1",
        commits: ["abc"],
        branch: "feat/x",
      });

      // worker-facing report: stdin and --file, append-only, no state change
      const checkpoint = await nf(
        ["attempt", "report", key, "--kind", "checkpoint"],
        "step 1 done\nnext: tests\n",
      );
      expect(checkpoint.out).toContain("reported checkpoint");
      const file = join(tmp("nf-rep-"), "result.txt");
      writeFileSync(file, "RESULT: SUCCEEDED\n");
      expect((await nf(["attempt", "report", key, "--kind", "result", "--file", file])).code).toBe(
        0,
      );
      const unknownAttempt = await nf(["attempt", "report", "T-001-A9", "--kind", "result"], "x");
      expect(unknownAttempt.code).toBe(1);
      const unknownKind = await nf(["attempt", "report", key, "--kind", "oops"], "x");
      expect(unknownKind.code).toBe(1);
      const shown = (await nf(["attempt", "show", key, "--json"])).json();
      expect(shown.status).toBe("active");
      expect(shown.reports.map((r: { kind: string }) => r.kind)).toEqual(["checkpoint", "result"]);
      expect((await nf(["task", "show", "T-001", "--json"])).json().status).toBe("working");
      expect((await nf(["attempt", "show", key, "--reports"])).out).toContain("step 1 done");
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "finishes the attempt and accepts the task through its checks",
    async () => {
      const finished = await nf([
        "attempt",
        "finish",
        key,
        "--status",
        "succeeded",
        "--outcome",
        "implemented",
        "--last-verified",
        "bun test",
      ]);
      expect(finished.out.trim()).toBe(`${key}  succeeded`);
      expect((await nf(["attempt", "finish", key, "--status", "failed"])).code).toBe(1);

      // done needs review, passing acceptance; the succeeded attempt already moved it there
      expect((await nf(["task", "accept", "T-001"])).code).toBe(1);
      expect((await nf(["task", "show", "T-001", "--json"])).json().status).toBe("review");
      const early = await nf(["task", "accept", "T-001"]);
      expect(early.code).toBe(1);
      expect(early.err).toMatch(/acceptance not passing/);
      const checked = await nf([
        "task",
        "check",
        "T-001",
        "--item",
        "1",
        "--result",
        "pass",
        "--evidence",
        "bun test -> PASS",
      ]);
      expect(checked.code).toBe(0);
      expect((await nf(["task", "check", "T-001", "--item", "2", "--result", "pass"])).code).toBe(
        0,
      );
      expect(
        (await nf(["task", "intervene", "T-001", "--note", "user clarified scope"])).code,
      ).toBe(0);
      const accepted = await nf(["task", "accept", "T-001", "--json"]);
      expect(accepted.code).toBe(0);
      expect(accepted.json()).toMatchObject({
        status: "done",
        accepted_first_pass: true,
        human_interventions: 1,
      });
    },
    STEP_TIMEOUT_MS,
  );

  test(
    "reports readiness, strategy stats, status and a backup",
    async () => {
      // the dependent task is ready now; cycles are rejected
      expect((await nf(["task", "next", "--json"])).json().key).toBe("T-002");
      expect((await nf(["task", "depend", "T-001", "--on", "T-002"])).err).toMatch(/cycle/);

      const stats = (await nf(["stats", "--by", "strategy", "--json"])).json();
      expect(stats.by).toBe("strategy");
      expect(stats.rows.map((r: { strategy: string | null }) => r.strategy)).toEqual([
        "cheap",
        null,
      ]);
      expect(stats.rows[0]).toMatchObject({
        tasks: 1,
        n: 1,
        first_pass: 1,
        first_pass_rate: 1,
        cost_to_acceptance: { value: null, quality: "unknown" },
      });
      expect(stats.rows[1]).toMatchObject({ tasks: 1, n: 0, first_pass: 0, first_pass_rate: null });
      const strategyTable = (await nf(["stats", "--by", "strategy"])).out;
      expect(strategyTable).toContain("STRATEGY");
      expect(strategyTable).toContain("SPAWNS");
      expect(strategyTable).toContain("cheap");
      expect(strategyTable).toContain("—");
      expect(strategyTable).toContain("n < 10: indicative");
      expect((await nf(["stats", "--by", "nonsense"])).err).toMatch(/invalid --by 'nonsense'/);

      // a task can record a new strategy later
      const restrategised = await nf(["task", "set", "T-001", "--strategy", "direct", "--json"]);
      expect(restrategised.json().strategy).toBe("direct");
      expect((await nf(["task", "show", "T-001"])).out).toContain("strategy: direct");

      const status = (await nf(["status", "--json"])).json();
      expect(status.counts).toMatchObject({ todo: 1, done: 1, working: 0 });
      expect(status.total).toBe(2);
      expect(status.live_attempts).toEqual([]);
      expect(status.ready.map((t: { key: string }) => t.key)).toEqual(["T-002"]);
      expect((await nf(["status"])).out).toContain("tasks 2: todo 1, done 1");

      const bk = await nf(["backup", "--json"]);
      expect(bk.code).toBe(0);
      expect(existsSync(bk.json().file)).toBe(true);
      expect(readdirSync(join(home, "backups")).length).toBe(1);

      // the shipped bin under Node reads the store the in-process calls wrote
      expect(runner(home, cwd)(["status", "--json"]).json().total).toBe(2);
    },
    STEP_TIMEOUT_MS,
  );
});
