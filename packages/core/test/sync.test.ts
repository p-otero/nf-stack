import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import {
  LATEST_VERSION,
  MIGRATIONS,
  NfError,
  importTasksJson,
  loadPrices,
  migrationStatements,
  priceKeys,
  strategyStats,
  syncUsage,
  taskUsage,
  usageStats,
} from "../src/index.ts";
import type { StatsOptions, SyncOptions, UsageStats, UsageTotals } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { EMPTY_TRAITS, cleanupAll, fixture, openStore, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const A_WINDOW = ["2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"] as const;
const B_WINDOW = ["2026-01-01T11:00:00Z", "2026-01-01T12:00:00Z"] as const;

function threadPayload(nativeId: string): string {
  return JSON.stringify({
    nativeThreadRef: { driver: "claudeAgent", nativeId, strength: "strong" },
  });
}

function turnPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: "claude-test",
    nativeTurnRef: { nativeId: `native-${typeof over["id"] === "string" ? over["id"] : "turn"}` },
    turnTokenUsage: {
      usageScope: "main_agent",
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 200,
      cacheCreationTokens: 50,
      reasoningTokens: 10,
      usageStatus: "complete",
      hasSubagents: false,
      models: ["claude-test"],
      otherUsage: { inputTokens: 0, outputTokens: 0 },
    },
    ...over,
  });
}

function assistant(
  id: string,
  ts: string,
  responseId: string,
  usageJson: Record<string, unknown>,
  model: string,
) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: ts,
    message: {
      role: "assistant",
      provider: "pi-provider",
      model,
      responseId,
      usage: usageJson,
    },
  };
}

function usage(input: number, output: number, total: number, extra: Record<string, unknown> = {}) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: input + output,
    ...extra,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
  };
}

interface SourceFixture {
  dir: string;
  t3: string;
  pi: string;
  prices: string;
  piA: string;
  piFork: string;
}

function sources(): SourceFixture {
  const dir = tempDir("nf-usage-");
  const t3 = join(dir, "statev2.sqlite");
  const pi = join(dir, "sessions");
  const prices = join(dir, "usage-model-rates.json");
  const piDir = join(pi, "proj");
  mkdirSync(piDir, { recursive: true });
  const piA = join(piDir, "a.jsonl");
  const piFork = join(piDir, "b.jsonl");

  const db = new DatabaseSync(t3);
  db.exec(`
    CREATE TABLE orchestration_v2_projection_provider_threads (
      provider_thread_id TEXT PRIMARY KEY,
      thread_id TEXT,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE TABLE orchestration_v2_projection_provider_turns (
      provider_turn_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      run_attempt_id TEXT,
      ordinal INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'completed',
      started_at TEXT,
      completed_at TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE orchestration_v2_projection_subagents (
      subagent_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      parent_node_id TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL,
      provider_thread_id TEXT,
      child_thread_id TEXT,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE orchestration_v2_projection_run_attempts (
      attempt_id TEXT PRIMARY KEY,
      run_id TEXT
    );
  `);
  const thread = db.prepare(
    `INSERT INTO orchestration_v2_projection_provider_threads
       (provider_thread_id, thread_id, provider, provider_instance_id, payload_json)
     VALUES (?,?,?,?,?)`,
  );
  thread.run("pt-main", "thread-coord", "claudeAgent", "claudeAgent", threadPayload("uuid-main"));
  thread.run("pt-a", "thread-a", "claudeAgent", "claudeAgent", threadPayload("uuid-a"));
  thread.run("pt-child", "thread-child", "claudeAgent", "claudeAgent", threadPayload("uuid-c"));
  thread.run(
    "pt-pi",
    "thread-pi",
    "pi",
    "pi",
    JSON.stringify({ nativeThreadRef: { driver: "pi", nativeId: piA, strength: "strong" } }),
  );
  db.prepare(
    `INSERT INTO orchestration_v2_projection_subagents
       (subagent_id, thread_id, run_id, parent_node_id, provider, provider_thread_id,
        child_thread_id, origin, status, started_at, completed_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "sub-1",
    "thread-a",
    "run-1",
    "node-1",
    "claudeAgent",
    "pt-child",
    "thread-child",
    "app_owned",
    "completed",
    "2026-01-01T10:40:00Z",
    "2026-01-01T10:50:00Z",
    JSON.stringify({ model: "claude-test", title: "child work" }),
  );
  db.prepare(
    `INSERT INTO orchestration_v2_projection_subagents
       (subagent_id, thread_id, run_id, parent_node_id, provider, provider_thread_id,
        child_thread_id, origin, status, started_at, completed_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "sub-2",
    "thread-coord",
    "run-1",
    "node-1",
    "claudeAgent",
    null,
    "thread:subagent:native1",
    "provider_native",
    "completed",
    "2026-01-01T10:12:00Z",
    "2026-01-01T10:14:00Z",
    JSON.stringify({ model: "claude-opus-x", title: "native research" }),
  );
  db.prepare(
    "INSERT INTO orchestration_v2_projection_run_attempts (attempt_id, run_id) VALUES (?,?)",
  ).run("ra-1", "run-1");

  const turn = db.prepare(
    `INSERT INTO orchestration_v2_projection_provider_turns
       (provider_turn_id, thread_id, provider_thread_id, run_attempt_id, ordinal, status,
        started_at, completed_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  turn.run(
    "turn-a1",
    "thread-a",
    "pt-a",
    "ra-1",
    1,
    "completed",
    "2026-01-01T10:20:00Z",
    "2026-01-01T10:30:00Z",
    turnPayload({
      id: "a1",
      turnTokenUsage: {
        usageScope: "main_agent",
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 200,
        cacheCreationTokens: 50,
        reasoningTokens: 10,
        usageStatus: "complete",
        hasSubagents: false,
        models: ["claude-test"],
        otherUsage: { inputTokens: 500, outputTokens: 20 },
      },
    }),
  );
  turn.run(
    "turn-a2",
    "thread-a",
    "pt-a",
    null,
    2,
    "completed",
    "2026-01-01T11:20:00Z",
    "2026-01-01T11:30:00Z",
    JSON.stringify({
      model: "mystery-model",
      turnTokenUsage: {
        inputTokens: 100,
        outputTokens: 10,
        usageStatus: "complete",
        models: ["mystery-model"],
      },
    }),
  );
  turn.run(
    "turn-a3",
    "thread-a",
    "pt-a",
    null,
    3,
    "completed",
    "2026-01-01T12:20:00Z",
    "2026-01-01T12:30:00Z",
    turnPayload({ id: "a3" }),
  );
  turn.run(
    "turn-c1",
    "thread-coord",
    "pt-main",
    null,
    1,
    "completed",
    "2026-01-01T10:10:00Z",
    "2026-01-01T10:15:00Z",
    turnPayload({ id: "c1" }),
  );
  turn.run(
    "turn-child",
    "thread-child",
    "pt-child",
    null,
    1,
    "completed",
    "2026-01-01T10:40:00Z",
    "2026-01-01T10:45:00Z",
    turnPayload({ id: "child" }),
  );
  turn.run(
    "turn-pi",
    "thread-pi",
    "pt-pi",
    null,
    1,
    "completed",
    "2026-01-01T10:45:00Z",
    "2026-01-01T10:50:00Z",
    JSON.stringify({
      model: "pi-model",
      turnTokenUsage: {
        inputTokens: 9999,
        outputTokens: 999,
        usageStatus: "complete",
        models: ["pi-model"],
      },
    }),
  );
  turn.run(
    "turn-unavail",
    "thread-a",
    "pt-a",
    null,
    4,
    "running",
    "2026-01-01T10:50:00Z",
    "2026-01-01T10:55:00Z",
    JSON.stringify({ model: "claude-test" }),
  );
  db.close();

  const headerA = {
    type: "session",
    version: 3,
    id: "pi-a",
    timestamp: "2026-01-01T10:00:00Z",
  };
  const e1 = assistant("e1", "2026-01-01T10:05:00Z", "resp-1", usage(1000, 100, 0.002), "pi-model");
  writeFileSync(
    piA,
    [
      headerA,
      e1,
      assistant("e2", "2026-01-01T11:05:00Z", "resp-2", usage(200, 20, 0), "pi-unpriced"),
      assistant("e3", "2026-01-01T12:05:00Z", "resp-3", usage(300, 30, 0.001), "pi-model"),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
  writeFileSync(
    piFork,
    [
      {
        type: "session",
        version: 3,
        id: "pi-b",
        timestamp: "2026-01-01T10:30:00Z",
        parentSession: piA,
      },
      e1,
      assistant("e4", "2026-01-01T11:10:00Z", "resp-4", usage(400, 40, 0.003), "pi-model"),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
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
        "provider/claude-test": {
          input_cost_per_token: 0.5,
          output_cost_per_token: 0.5,
        },
        "claude-sonnet-5-5": {
          input_cost_per_token: 0.000002,
          output_cost_per_token: 0.00001,
          cache_read_input_token_cost: 0.0000001,
          cache_creation_input_token_cost: 0.0000025,
        },
      },
    }),
  );
  return { dir, t3, pi, prices, piA, piFork };
}

function importPlan(f: Fixture, extraAttempts: unknown[] = []) {
  return f.run(
    importTasksJson(f.projectId, {
      schema_version: 2,
      coordinator: { thread_id: "thread-coord" },
      tasks: [
        {
          id: "T-001",
          title: "Usage attribution",
          goal: "attribute tokens",
          status: "done",
          acceptance: [{ text: "works", result: "pass" }],
          attempts: [
            {
              id: "T-001-A1",
              kind: "implementation",
              status: "succeeded",
              mechanism: "delegate_task",
              thread_id: "thread-a",
              started_at: A_WINDOW[0],
              ended_at: A_WINDOW[1],
            },
            {
              id: "T-001-A2",
              kind: "review",
              status: "failed",
              mechanism: "delegate_task",
              thread_id: "thread-a",
              started_at: B_WINDOW[0],
              ended_at: B_WINDOW[1],
            },
            {
              id: "T-001-A3",
              kind: "review",
              status: "succeeded",
              mechanism: "delegate_task",
              thread_id: "thread-pi",
              started_at: A_WINDOW[0],
              ended_at: A_WINDOW[1],
            },
            ...extraAttempts,
          ],
        },
      ],
    }),
  );
}

function sync(f: Fixture, s: SourceFixture, over: Partial<SyncOptions> = {}) {
  return f.run(
    Effect.gen(function* () {
      const prices = yield* loadPrices({
        home: s.dir,
        litellmFile: s.prices,
        manual: {},
        traits: EMPTY_TRAITS,
        now: new Date("2026-01-02T00:00:00Z"),
        offline: true,
      });
      return yield* syncUsage({
        t3State: s.t3,
        piSessions: s.pi,
        prices,
        now: new Date("2026-01-02T00:00:00Z"),
        ...over,
      });
    }),
  );
}

interface EventRow {
  id: string;
  source_key: string;
  source: string;
  bucket: string;
  attempt_id: string | null;
  parent_attempt_id: string | null;
  is_subagent: number;
  cost_usd: number | null;
  cost_quality: string;
  price_source: string | null;
  price_date: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  usage_status: string;
}

interface SpawnRow {
  id: string;
  source_key: string;
  parent_t3_thread_id: string;
  parent_run_id: string | null;
  child_t3_thread_id: string | null;
  provider: string | null;
  model: string | null;
  kind: string;
  started_at: string;
  ended_at: string | null;
  attempt_id: string | null;
}

function eventRows(f: Fixture) {
  return f.sql<EventRow>("SELECT * FROM usage_events ORDER BY source_key");
}

async function byKey(f: Fixture, key: string) {
  return (await eventRows(f)).find((r) => r.source_key === key);
}

function hash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("usage sync", () => {
  test("ingests T3 and Pi once, keeps the sources read-only and dedupes fork replays", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const before = [s.t3, s.piA, s.piFork].map(hash);

    const first = await sync(f, s);
    expect(first.dry_run).toBe(false);
    const t3 = first.sources.find((r) => r.source === "t3");
    const pi = first.sources.find((r) => r.source === "pi");
    expect(t3).toMatchObject({
      status: "ok",
      seen: 7,
      inserted: 7,
      updated: 0,
      skipped: 0,
      attributed: 4,
      coordination: 1,
      unattributed: 2,
      duplicates: 0,
    });
    expect(pi).toMatchObject({
      status: "ok",
      seen: 4,
      inserted: 4,
      updated: 0,
      skipped: 0,
      attributed: 1,
      duplicates: 1,
    });
    expect(await eventRows(f)).toHaveLength(11);
    expect(
      await f.sql("SELECT source, last_status, inserted, skipped FROM sync_state ORDER BY source"),
    ).toEqual([
      { source: "pi", last_status: "ok", inserted: 4, skipped: 0 },
      { source: "t3", last_status: "ok", inserted: 7, skipped: 0 },
    ]);

    // The Pi thread's T3 turn is not counted; Pi JSONL is its only source.
    expect(await byKey(f, "t3:turn:turn-pi")).toBeUndefined();
    expect((await eventRows(f)).some((r) => r.input_tokens === 9999)).toBe(false);

    // Fork replay of resp-1 is one event, read from the parent session.
    expect((await eventRows(f)).filter((r) => r.source_key === "pi:r:resp-1")).toHaveLength(1);
    expect((await byKey(f, "pi:r:resp-1"))?.cost_quality).toBe("reported");
    expect((await byKey(f, "pi:r:resp-1"))?.price_source).toBe("pi");

    expect([s.t3, s.piA, s.piFork].map(hash)).toEqual(before);

    const second = await sync(f, s);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(11);
    expect(await eventRows(f)).toHaveLength(11);
  });

  test("attributes by attempt window, including a reused thread, and buckets coordination", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    await sync(f, s);
    const a1 = (await f.store.getAttempt(f.projectId, "T-001-A1")).id;
    const a2 = (await f.store.getAttempt(f.projectId, "T-001-A2")).id;
    const a3 = (await f.store.getAttempt(f.projectId, "T-001-A3")).id;

    expect(await byKey(f, "t3:turn:turn-a1")).toMatchObject({ bucket: "attempt", attempt_id: a1 });
    expect(await byKey(f, "t3:sub:turn-a1")).toMatchObject({ bucket: "attempt", attempt_id: a1 });
    expect(await byKey(f, "t3:turn:turn-unavail")).toMatchObject({
      bucket: "attempt",
      attempt_id: a1,
    });
    expect(await byKey(f, "t3:turn:turn-a2")).toMatchObject({ bucket: "attempt", attempt_id: a2 });
    expect(await byKey(f, "t3:turn:turn-a3")).toMatchObject({
      bucket: "unattributed",
      attempt_id: null,
    });
    expect(await byKey(f, "t3:turn:turn-c1")).toMatchObject({
      bucket: "coordination",
      attempt_id: null,
    });
    expect(await byKey(f, "pi:r:resp-1")).toMatchObject({ bucket: "attempt", attempt_id: a3 });
    expect(await byKey(f, "pi:r:resp-2")).toMatchObject({
      bucket: "unattributed",
      attempt_id: null,
    });
  });

  test("price lookup lowercases, drops a bracket suffix and prefers the prefix-free id", () => {
    expect(priceKeys("Provider/Claude-Test[1m]")).toEqual(["claude-test", "provider/claude-test"]);
    expect(priceKeys("claude-test")).toEqual(["claude-test"]);
    expect(priceKeys("  ")).toEqual([]);
  });

  test("estimates cost, marks unknown prices NULL and splits subagent aggregates", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const result = await sync(f, s);
    expect(result.price_date).toBe("2026-01-01");

    const main = await byKey(f, "t3:turn:turn-a1");
    expect(main?.cost_quality).toBe("estimated");
    expect(main?.price_source).toBe("litellm");
    expect(main?.cost_usd).toBeCloseTo(0.000995, 12);
    expect(main?.is_subagent).toBe(0);

    const sub = await byKey(f, "t3:sub:turn-a1");
    expect(sub).toMatchObject({
      is_subagent: 1,
      input_tokens: 500,
      output_tokens: 20,
      cache_read_tokens: null,
      cache_write_tokens: null,
      cost_usd: null,
      cost_quality: "unknown",
      price_source: null,
      price_date: null,
    });

    const unknown = await byKey(f, "t3:turn:turn-a2");
    expect(unknown).toMatchObject({
      cost_usd: null,
      cost_quality: "unknown",
      price_source: null,
    });
    expect(await byKey(f, "t3:turn:turn-unavail")).toMatchObject({
      usage_status: "unavailable",
      input_tokens: null,
      cost_usd: null,
      cost_quality: "unknown",
    });
    expect(await byKey(f, "pi:r:resp-2")).toMatchObject({
      cost_usd: null,
      cost_quality: "unknown",
    });

    // A child thread's own T3 turn is flagged as subagent usage.
    expect((await byKey(f, "t3:turn:turn-child"))?.is_subagent).toBe(1);
  });

  test("normalizes T-001-A1: uncached input only, reasoning never priced twice", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const db = new DatabaseSync(s.t3);
    db.prepare(
      "UPDATE orchestration_v2_projection_provider_turns SET payload_json = ? WHERE provider_turn_id = ?",
    ).run(
      JSON.stringify({
        model: "claude-sonnet-5-5",
        turnTokenUsage: {
          inputTokens: 8_604_273,
          cachedInputTokens: 8_416_866,
          cacheCreationTokens: 187_293,
          outputTokens: 132_771,
          reasoningTokens: 37_155,
          usageStatus: "complete",
          hasSubagents: false,
          models: ["claude-sonnet-5-5"],
          otherUsage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
      "turn-a1",
    );
    db.close();
    await sync(f, s);
    const event = await byKey(f, "t3:turn:turn-a1");
    expect(event).toMatchObject({
      input_tokens: 114,
      output_tokens: 132_771,
      cache_read_tokens: 8_416_866,
      cache_write_tokens: 187_293,
      reasoning_tokens: 37_155,
      usage_status: "complete",
      cost_quality: "estimated",
    });
    expect(event?.cost_usd).toBeCloseTo(2.6378571, 6);
    expect(event?.cost_usd).toBeLessThanOrEqual(2.64 + 0.01);
    // Upper bound: charging every token, including output, at the input rate.
    const inputRate = 0.000002;
    const upperBound = (114 + 8_416_866 + 187_293 + 132_771) * inputRate;
    expect(event?.cost_usd ?? Infinity).toBeLessThan(upperBound);
  });

  test("clamps negative uncached input to zero and marks the event partial", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const db = new DatabaseSync(s.t3);
    db.prepare(
      "UPDATE orchestration_v2_projection_provider_turns SET payload_json = ? WHERE provider_turn_id = ?",
    ).run(
      JSON.stringify({
        model: "claude-test",
        turnTokenUsage: {
          inputTokens: 100,
          cachedInputTokens: 80,
          cacheCreationTokens: 50,
          outputTokens: 10,
          reasoningTokens: 5,
          usageStatus: "complete",
          models: ["claude-test"],
          otherUsage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
      "turn-a1",
    );
    db.close();
    await sync(f, s);
    const event = await byKey(f, "t3:turn:turn-a1");
    expect(event).toMatchObject({
      input_tokens: 0,
      cache_read_tokens: 80,
      cache_write_tokens: 50,
      output_tokens: 10,
      usage_status: "partial",
    });
    expect(event?.cost_usd).toBeCloseTo(0.000053, 12);
  });

  test("skips T3 local-command turns instead of counting their counters", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const db = new DatabaseSync(s.t3);
    db.prepare(
      "UPDATE orchestration_v2_projection_provider_turns SET payload_json = ? WHERE provider_turn_id = ?",
    ).run(
      JSON.stringify({
        model: "claude-test",
        turnTokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 100,
          reasoningTokens: 0,
          usageStatus: "complete",
          localCommand: true,
          models: ["claude-test"],
          otherUsage: { inputTokens: 500, outputTokens: 20 },
        },
      }),
      "turn-a1",
    );
    db.close();
    const result = await sync(f, s);
    expect(await byKey(f, "t3:turn:turn-a1")).toBeUndefined();
    expect(await byKey(f, "t3:sub:turn-a1")).toBeUndefined();
    expect(result.sources.find((r) => r.source === "t3")?.seen).toBe(5);
  });

  test("Pi input is already uncached and output already includes reasoning", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    // Pi reports totalTokens = input + output + cacheRead + cacheWrite; each
    // assistant entry below satisfies that identity.
    const normalized = {
      type: "message",
      id: "e-norm",
      timestamp: "2026-01-01T10:06:00Z",
      message: {
        role: "assistant",
        provider: "pi-provider",
        model: "claude-test",
        responseId: "resp-pi-norm",
        usage: usage(2129, 230, 0, {
          cacheRead: 25088,
          cacheWrite: 100,
          reasoning: 7,
          totalTokens: 27547,
        }),
      },
    };
    const noReasoning = {
      type: "message",
      id: "e-noreason",
      timestamp: "2026-01-01T10:07:00Z",
      message: {
        role: "assistant",
        provider: "pi-provider",
        model: "claude-test",
        responseId: "resp-pi-noreason",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    };
    expect(2129 + 230 + 25088 + 100).toBe(27547);
    appendFileSync(s.piA, JSON.stringify(normalized) + "\n" + JSON.stringify(noReasoning) + "\n");
    await sync(f, s);

    const event = await byKey(f, "pi:r:resp-pi-norm");
    expect(event).toMatchObject({
      input_tokens: 2129,
      output_tokens: 230,
      cache_read_tokens: 25088,
      cache_write_tokens: 100,
      reasoning_tokens: 7,
      usage_status: "complete",
      cost_quality: "estimated",
    });
    expect(event?.cost_usd).toBeCloseTo(0.0051478, 12);
    expect((await byKey(f, "pi:r:resp-pi-noreason"))?.usage_status).toBe("complete");
  });

  test("source selection and extra coordinator threads steer ingestion and attribution", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();

    const piOnly = await sync(f, s, { source: "pi" });
    expect(piOnly.sources.map((r) => r.source)).toEqual(["pi"]);
    expect(await byKey(f, "t3:turn:turn-a1")).toBeUndefined();
    expect(await byKey(f, "pi:r:resp-1")).toBeDefined();

    const t3Only = await sync(f, s, { source: "t3" });
    expect(t3Only.sources.map((r) => r.source)).toEqual(["t3"]);
    expect((await byKey(f, "t3:turn:turn-a1"))?.bucket).toBe("attempt");

    const coordination = await sync(f, s, { source: "t3", coordinatorThreads: ["thread-a"] });
    expect(await byKey(f, "t3:turn:turn-a1")).toMatchObject({
      bucket: "coordination",
      attempt_id: null,
    });
    expect(coordination.sources[0]?.attributed).toBe(0);
    expect(coordination.sources[0]?.coordination).toBe(6);
  });

  test("re-sync replaces a stored otherUsage row in place with unknown cost", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const a1 = (await f.store.getAttempt(f.projectId, "T-001-A1")).id;
    // Shape written by the first E2 sync before aggregates were made unpriced.
    await f.sql(
      `INSERT INTO usage_events (id, source, source_key, machine_id, t3_thread_id,
         native_session_id, run_id, turn_id, provider, model, ts, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, usage_status, is_subagent,
         cost_usd, cost_quality, price_source, price_date, attempt_id, bucket, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "01OLDA1ROW000000000000000",
      "t3",
      "t3:sub:turn-a1",
      f.store.machine,
      "thread-a",
      "uuid-a",
      "run-1",
      "native-a1",
      "claudeAgent",
      "claude-test",
      "2026-01-01T10:30:00.000Z",
      500,
      20,
      null,
      null,
      null,
      "complete",
      1,
      0.00054,
      "estimated",
      "litellm",
      "2026-01-01",
      a1,
      "attempt",
      "2026-01-01T00:00:00.000Z",
    );
    const result = await sync(f, s);
    const rows = (await eventRows(f)).filter((r) => r.source_key === "t3:sub:turn-a1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "01OLDA1ROW000000000000000",
      input_tokens: 500,
      output_tokens: 20,
      is_subagent: 1,
      cost_usd: null,
      cost_quality: "unknown",
      price_source: null,
      price_date: null,
    });
    const t3 = result.sources.find((r) => r.source === "t3");
    expect(t3?.updated).toBe(1);
    expect(t3?.inserted).toBe(6);
  });

  test("dry run plans inserts without writing events or sync state", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const result = await sync(f, s, { dryRun: true });
    expect(result.dry_run).toBe(true);
    expect(result.inserted).toBe(11);
    expect(await eventRows(f)).toHaveLength(0);
    expect(await f.sql("SELECT * FROM sync_state")).toHaveLength(0);
  });

  test("a dry run after a real sync reports no inserts", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    await sync(f, s);
    const again = await sync(f, s, { dryRun: true });
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(11);
    expect(again.attributed).toBe(5);
  });

  test("malformed source records are skipped and counted, never turned into numbers", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const db = new DatabaseSync(s.t3);
    db.prepare(
      "UPDATE orchestration_v2_projection_provider_turns SET payload_json = ? WHERE provider_turn_id = ?",
    ).run("{not json", "turn-a2");
    db.prepare(
      "UPDATE orchestration_v2_projection_provider_turns SET payload_json = ? WHERE provider_turn_id = ?",
    ).run(
      JSON.stringify({
        model: "claude-test",
        turnTokenUsage: {
          inputTokens: "1000",
          outputTokens: -5,
          cachedInputTokens: 200,
          cacheCreationTokens: 50,
          usageStatus: "bogus",
          otherUsage: [1, 2],
        },
      }),
      "turn-a3",
    );
    db.close();
    appendFileSync(s.piA, "{broken\n" + JSON.stringify({ type: "message", message: "x" }) + "\n");
    const result = await sync(f, s);

    const t3 = result.sources.find((r) => r.source === "t3");
    expect(t3?.status).toBe("partial");
    expect(t3?.warnings).toEqual(["T3: 1 unparseable turn payloads"]);
    expect(await byKey(f, "t3:turn:turn-a2")).toMatchObject({
      usage_status: "unavailable",
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      cost_quality: "unknown",
    });
    // String and negative counters are unknown, not coerced; usage is partial and unpriced.
    expect(await byKey(f, "t3:turn:turn-a3")).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      usage_status: "partial",
      cost_usd: null,
      cost_quality: "unknown",
    });
    expect(await byKey(f, "t3:sub:turn-a3")).toBeUndefined();

    const pi = result.sources.find((r) => r.source === "pi");
    expect(pi?.status).toBe("partial");
    expect(pi?.warnings).toEqual(["Pi: 1 malformed entries were skipped"]);
    expect(pi?.seen).toBe(4);
  });

  test("a missing source fails that source only, with a typed error when it is the only one", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const both = await sync(f, s, { piSessions: `${s.pi}-missing` });
    expect(both.sources.find((r) => r.source === "pi")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Pi sessions directory not found"),
    });
    expect(both.sources.find((r) => r.source === "t3")?.status).toBe("ok");
    const err = await sync(f, s, { source: "t3", t3State: `${s.t3}.missing` }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NfError);
    expect((err as NfError).code).toBe("source_unavailable");
    expect((err as NfError).message).toContain("source database not found");
  });
});

describe("subagent spawns", () => {
  test("records app-owned and native spawns once and attributes them by parent window", async () => {
    const f = await fixture();
    await importPlan(f);
    const s = sources();
    const db = new DatabaseSync(s.t3);
    db.prepare(
      `INSERT INTO orchestration_v2_projection_subagents
         (subagent_id, thread_id, run_id, parent_node_id, provider, provider_thread_id,
          child_thread_id, origin, status, started_at, completed_at, payload_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "sub-3",
      "thread-a",
      "run-1",
      "node-1",
      "claudeAgent",
      "pt-child2",
      "thread-child2",
      "app_owned",
      "completed",
      "2026-01-01T11:40:00Z",
      "2026-01-01T11:50:00Z",
      JSON.stringify({ model: "claude-test" }),
    );
    db.close();

    const first = await sync(f, s);
    expect(first.sources.find((r) => r.source === "t3")?.spawns).toBe(3);
    const a1 = (await f.store.getAttempt(f.projectId, "T-001-A1")).id;
    const a2 = (await f.store.getAttempt(f.projectId, "T-001-A2")).id;
    const rows = await f.sql<SpawnRow>("SELECT * FROM subagent_spawns ORDER BY source_key");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      source_key: "t3:subagent:sub-1",
      parent_t3_thread_id: "thread-a",
      parent_run_id: "run-1",
      child_t3_thread_id: "thread-child",
      provider: "claudeAgent",
      model: "claude-test",
      kind: "app_owned",
      started_at: "2026-01-01T10:40:00.000Z",
      ended_at: "2026-01-01T10:50:00.000Z",
      attempt_id: a1,
    });
    // A provider-native subagent has no T3 thread of its own, and coordination has no attempt.
    expect(rows[1]).toMatchObject({
      source_key: "t3:subagent:sub-2",
      kind: "native",
      child_t3_thread_id: null,
      model: "claude-opus-x",
      attempt_id: null,
    });
    // The same parent thread at a later time belongs to the next attempt.
    expect(rows[2]).toMatchObject({ source_key: "t3:subagent:sub-3", attempt_id: a2 });

    const again = await sync(f, s);
    expect(again.sources.find((r) => r.source === "t3")?.spawns).toBe(3);
    const replayed = await f.sql<{ id: string; attempt_id: string | null }>(
      "SELECT id, attempt_id FROM subagent_spawns ORDER BY source_key",
    );
    expect(replayed.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(replayed.map((r) => r.attempt_id)).toEqual([a1, null, a2]);
  });

  test("keeps child usage on an attempt that owns the child thread", async () => {
    const f = await fixture();
    await importPlan(f, [
      {
        id: "T-001-A4",
        kind: "review",
        status: "succeeded",
        mechanism: "delegate_task",
        thread_id: "thread-child",
        started_at: "2026-01-01T10:40:00Z",
        ended_at: "2026-01-01T10:50:00Z",
      },
    ]);
    await sync(f, sources());
    const a1 = (await f.store.getAttempt(f.projectId, "T-001-A1")).id;
    const a4 = (await f.store.getAttempt(f.projectId, "T-001-A4")).id;
    expect(await byKey(f, "t3:turn:turn-child")).toMatchObject({
      attempt_id: a4,
      parent_attempt_id: null,
      bucket: "attempt",
    });
    const spawn = (
      await f.sql<{ attempt_id: string | null }>(
        "SELECT attempt_id FROM subagent_spawns WHERE source_key = 't3:subagent:sub-1'",
      )
    )[0];
    expect(spawn?.attempt_id).toBe(a1);

    const report = await f.run(taskUsage(f.projectId, "T-001"));
    const attemptsByKey = new Map(report.attempts.map((a) => [a.key, a]));
    expect(attemptsByKey.get("T-001-A1")?.subagents.groups[0]?.usage.events).toBe(0);
    expect(attemptsByKey.get("T-001-A4")?.events).toBe(1);
    expect(report.totals.events).toBe(6);
  });

  test("stats report spawns per model, strategy and attempt", async () => {
    const f = await fixture();
    await importPlan(f);
    await f.store.updateTask(f.projectId, "T-001", { strategy: "direct" });
    await sync(f, sources());

    const byModel = await f.run(usageStats({ by: "model", projectId: f.projectId }));
    expect(byModel.spawns).toBe(2);
    expect(byModel.rows.find((r) => r.key === "claude-test")?.spawns).toBe(1);
    expect(byModel.rows.find((r) => r.key === "claude-opus-x")).toMatchObject({
      spawns: 1,
      events: 0,
    });

    const byAttempt = await f.run(usageStats({ by: "attempt", projectId: f.projectId }));
    expect(byAttempt.rows.find((r) => r.key === "T-001-A1")?.spawns).toBe(1);
    expect(byAttempt.spawns).toBe(1);

    const strategy = await f.run(strategyStats({ projectId: f.projectId }));
    expect(strategy.rows.find((r) => r.strategy === "direct")?.spawns).toBe(1);
  });
});

function requireRow(stats: UsageStats, key: string): UsageTotals {
  const row = stats.rows.find((r) => r.key === key);
  if (!row) throw new Error(`missing stats row ${key}`);
  return row;
}

describe("usage stats", () => {
  test("groups project usage by task, model, profile and month with cost quality", async () => {
    const f = await fixture();
    await importPlan(f);
    await sync(f, sources());
    const stats = (opts: StatsOptions) => f.run(usageStats(opts));

    const byTask = await stats({ by: "task", projectId: f.projectId });
    expect(byTask.rows.map((r) => r.key)).toEqual(["T-001", "coordination"]);
    const t1 = requireRow(byTask, "T-001");
    expect(t1.events).toBe(6);
    expect(t1.input_tokens).toBe(750 + 100 + 1000 + 750);
    expect(t1.output_tokens).toBe(100 + 10 + 100 + 100);
    expect(t1.aggregate).toEqual({ events: 1, input_tokens: 500, output_tokens: 20 });
    expect(t1.cost).toMatchObject({ quality: "estimated", unknown_events: 3 });
    expect(t1.cost.value).toBeCloseTo(0.000995 + 0.002 + 0.000995, 12);
    expect(requireRow(byTask, "coordination").events).toBe(1);
    expect(requireRow(byTask, "coordination").aggregate.events).toBe(0);
    expect(byTask.totals.events).toBe(7);
    expect(byTask.totals.aggregate).toEqual({ events: 1, input_tokens: 500, output_tokens: 20 });

    const all = await stats({ by: "task", allProjects: true });
    expect(all.rows.map((r) => r.key)).toEqual(["T-001", "coordination", "unattributed"]);
    expect(requireRow(all, "unattributed").events).toBe(4);
    expect(all.totals.events).toBe(11);
    expect(all.totals.aggregate).toEqual({ events: 1, input_tokens: 500, output_tokens: 20 });

    const byModel = await stats({ by: "model", projectId: f.projectId });
    expect(byModel.rows.some((r) => r.key === "claude-test")).toBe(true);
    expect(byModel.rows.some((r) => r.key === "pi-model")).toBe(true);
    expect(byModel.rows.some((r) => r.key === "mystery-model")).toBe(true);

    const byProfile = await stats({ by: "profile", projectId: f.projectId });
    expect(byProfile.rows.map((r) => r.key)).toEqual(["(no profile)", "coordination"]);

    await f.store.updateTask(f.projectId, "T-001", { profile: "frontier" });
    const frontier = await stats({ by: "profile", projectId: f.projectId });
    expect(frontier.rows.map((r) => r.key)).toEqual(["frontier", "coordination"]);

    const byMonth = await stats({ by: "month", projectId: f.projectId });
    expect(byMonth.rows.map((r) => r.key)).toEqual(["2026-01"]);

    const byAttempt = await stats({ by: "attempt", projectId: f.projectId });
    expect(byAttempt.rows.map((r) => r.key)).toEqual([
      "T-001-A1",
      "T-001-A2",
      "T-001-A3",
      "coordination",
    ]);
  });

  test("task detail reports every attempt and cost to acceptance", async () => {
    const f = await fixture();
    await importPlan(f);
    await sync(f, sources());
    const task = await f.run(taskUsage(f.projectId, "T-001"));
    expect(task.done).toBe(true);
    expect(task.attempts.map((a) => a.key)).toEqual(["T-001-A1", "T-001-A2", "T-001-A3"]);
    const a1 = task.attempts[0];
    const a2 = task.attempts[1];
    const a3 = task.attempts[2];
    expect(a1?.events).toBe(3);
    expect(a2?.events).toBe(1);
    expect(a3?.events).toBe(1);
    expect(a1?.aggregate).toEqual({ events: 1, input_tokens: 500, output_tokens: 20 });
    expect(a1?.cost.value).toBeCloseTo(0.000995, 12);
    expect(a1?.cost.unknown_events).toBe(2);
    expect(a1?.subagents.count).toBe(1);
    expect(a1?.subagents.groups).toMatchObject([
      {
        kind: "app_owned",
        model: "claude-test",
        count: 1,
        usage: { events: 1, input_tokens: 750, output_tokens: 100 },
      },
    ]);
    expect(a2?.subagents.count).toBe(0);
    expect(a3?.subagents.count).toBe(0);
    expect(task.cost_to_acceptance.quality).toBe("estimated");
    expect(task.cost_to_acceptance.value).toBeCloseTo(0.000995 + 0.002 + 0.000995, 12);
    expect(task.cost_to_acceptance.unknown_events).toBe(3);
    expect(task.totals.aggregate).toEqual({ events: 1, input_tokens: 500, output_tokens: 20 });
    expect(task.cost_to_acceptance).toHaveProperty("value");
    expect(task.cost_to_acceptance).toHaveProperty("quality");
  });
});

describe("migrations over v1 data", () => {
  test("adds usage, catalog and route tables over existing v1 data", async () => {
    const home = tempDir("nf-v1-");
    const raw = new DatabaseSync(join(home, "nf.db"));
    for (const statement of migrationStatements(MIGRATIONS[0] as string)) raw.exec(statement);
    raw.exec("PRAGMA user_version = 1");
    raw
      .prepare(
        `INSERT INTO projects (id, machine_id, name, root_path, created_at)
         VALUES ('p1','m1','legacy','C:/legacy','2026-01-01T00:00:00.000Z')`,
      )
      .run();
    raw.close();

    const db = await openStore(home);
    try {
      expect((await db.sql("PRAGMA user_version"))[0]).toEqual({ user_version: LATEST_VERSION });
      expect(LATEST_VERSION).toBeGreaterThanOrEqual(3);
      expect(await db.sql("SELECT name FROM projects WHERE id = 'p1'")).toEqual([
        { name: "legacy" },
      ]);
      expect(await db.sql("SELECT COUNT(*) AS n FROM usage_events")).toEqual([{ n: 0 }]);
      expect(await db.sql("SELECT COUNT(*) AS n FROM sync_state")).toEqual([{ n: 0 }]);
      expect(await db.sql("SELECT COUNT(*) AS n FROM catalog_snapshots")).toEqual([{ n: 0 }]);
      expect(await db.sql("SELECT COUNT(*) AS n FROM route_blocks")).toEqual([{ n: 0 }]);
    } finally {
      await db.close();
    }
  });
});
