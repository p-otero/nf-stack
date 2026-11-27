import { afterEach, describe, expect, test } from "bun:test";
import { STRATEGIES, strategyStats } from "../src/index.ts";
import type { CostQuality, Task } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { addTask, cleanupAll, fixture, passAll, rejection, startImpl } from "./helpers.ts";

afterEach(cleanupAll);

/** The price layer `nf sync` records for an event of this quality. */
function priceSource(quality: CostQuality, source: string | null | undefined): string | null {
  if (source !== undefined) return source;
  if (quality === "reported") return "pi";
  if (quality === "estimated") return "litellm";
  return null;
}

/** A stored usage event with a known or unknown price, as `nf sync` would write it. */
async function event(
  f: Fixture,
  options: {
    key: string;
    attemptId: string;
    cost: number | null;
    quality: CostQuality;
    source?: string | null;
  },
): Promise<void> {
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
    "run-1",
    `turn-${options.key}`,
    "pi",
    "model-x",
    "2026-01-01T10:00:00Z",
    10,
    5,
    null,
    null,
    null,
    "complete",
    0,
    options.cost,
    options.quality,
    priceSource(options.quality, options.source),
    null,
    options.attemptId,
    "attempt",
    "2026-01-01T10:00:00Z",
  );
}

/** todo -> working -> review -> done with every acceptance item passing. */
async function accept(f: Fixture, key: string): Promise<Task> {
  await f.store.setStatus(f.projectId, key, "working");
  await f.store.setStatus(f.projectId, key, "review");
  await passAll(f, key);
  return f.store.acceptTask(f.projectId, key);
}

describe("task and attempt strategy", () => {
  test("an attempt inherits the task's strategy unless it records its own", async () => {
    const f = await fixture();
    const task = await addTask(f, { strategy: "cheap" });
    expect(task.strategy).toBe("cheap");

    const inherited = await startImpl(f, task.key);
    expect(inherited.strategy).toBe("cheap");

    const explicit = await startImpl(f, task.key, { kind: "research", strategy: "plan" });
    expect(explicit.strategy).toBe("plan");

    const cleared = await f.store.updateTask(f.projectId, task.key, { strategy: null });
    expect(cleared.strategy).toBeNull();
    expect((await startImpl(f, task.key, { kind: "review" })).strategy).toBeNull();
  });

  test("records a strategy on a task and rejects values outside the contract", async () => {
    const f = await fixture();
    const task = await addTask(f);
    expect(task.strategy).toBeNull();

    expect((await f.store.updateTask(f.projectId, task.key, { strategy: "direct" })).strategy).toBe(
      "direct",
    );
    expect(STRATEGIES).toEqual(["direct", "plan", "cheap", "review", "auto"]);

    const badTask = await rejection(addTask(f, { strategy: "barato" }));
    expect(badTask.message).toMatch(/invalid strategy 'barato'/);
    const badPatch = await rejection(
      f.store.updateTask(f.projectId, task.key, { strategy: "cheap review" }),
    );
    expect(badPatch.message).toMatch(/invalid strategy 'cheap review'/);
    const badAttempt = await rejection(
      startImpl(f, task.key, { kind: "research", strategy: "revisar" }),
    );
    expect(badAttempt.message).toMatch(/invalid strategy 'revisar'/);
  });
});

describe("strategy stats", () => {
  test("groups tasks, cost to acceptance and first-pass rate by strategy, NULL apart", async () => {
    const f = await fixture();

    // cheap, accepted on the first attempt: one reported price and one estimated price.
    const cheapFirst = await addTask(f, { title: "cheap first", strategy: "cheap" });
    const first = await startImpl(f, cheapFirst.key);
    await event(f, { key: "c1", attemptId: first.id, cost: 0.5, quality: "reported" });
    await f.store.finishAttempt(f.projectId, first.key, { status: "succeeded", outcome: "ok" });
    await accept(f, cheapFirst.key);

    // cheap, accepted only after a repair: first-pass misses.
    const cheapRepair = await addTask(f, { title: "cheap repair", strategy: "cheap" });
    const broken = await startImpl(f, cheapRepair.key);
    await f.store.finishAttempt(f.projectId, broken.key, { status: "failed", outcome: "no" });
    const repair = await startImpl(f, cheapRepair.key, { repairOf: broken.key });
    await event(f, { key: "c2", attemptId: repair.id, cost: 0.002, quality: "estimated" });
    await f.store.finishAttempt(f.projectId, repair.key, { status: "succeeded", outcome: "ok" });
    await accept(f, cheapRepair.key);

    // direct, accepted first pass, but its usage has no known price.
    const direct = await addTask(f, { title: "direct", strategy: "direct" });
    const unpriced = await startImpl(f, direct.key);
    await event(f, { key: "d1", attemptId: unpriced.id, cost: null, quality: "unknown" });
    await f.store.finishAttempt(f.projectId, unpriced.key, { status: "succeeded", outcome: "ok" });
    await accept(f, direct.key);

    // two tasks recorded before strategies were tracked: one still open, one accepted.
    const legacyOpen = await addTask(f, { title: "legacy open" });
    await startImpl(f, legacyOpen.key);
    const legacyDone = await addTask(f, { title: "legacy done" });
    const legacyAttempt = await startImpl(f, legacyDone.key);
    await f.store.finishAttempt(f.projectId, legacyAttempt.key, {
      status: "succeeded",
      outcome: "ok",
    });
    await accept(f, legacyDone.key);

    const stats = await f.run(strategyStats({ projectId: f.projectId }));
    expect(stats.by).toBe("strategy");
    expect(stats.project?.name).toBe("demo");
    expect(stats.rows.map((r) => r.strategy)).toEqual(["direct", "cheap", null]);
    // Pi's reported charge and the LiteLLM estimate, never the unpriced event.
    expect(stats.price_sources).toEqual(["litellm", "pi"]);

    const cheap = stats.rows[1];
    expect(cheap).toMatchObject({ tasks: 2, n: 2, first_pass: 1, first_pass_rate: 0.5 });
    expect(cheap?.cost_to_acceptance.value).toBeCloseTo(0.502, 12);
    expect(cheap?.cost_to_acceptance.quality).toBe("estimated");
    expect(cheap?.cost_to_acceptance.reported_events).toBe(1);
    expect(cheap?.cost_to_acceptance.estimated_events).toBe(1);

    const strong = stats.rows[0];
    expect(strong).toMatchObject({ tasks: 1, n: 1, first_pass: 1, first_pass_rate: 1 });
    expect(strong?.cost_to_acceptance).toMatchObject({ value: null, quality: "unknown" });

    const unknown = stats.rows[2];
    expect(unknown).toMatchObject({ tasks: 2, n: 1, first_pass: 1 });
    expect(unknown?.cost_to_acceptance.value).toBeNull();

    const all = await f.run(strategyStats({ allProjects: true }));
    expect(all.all_projects).toBe(true);
    expect(all.rows.map((r) => r.tasks)).toEqual([1, 2, 2]);
  });

  test("names the layer behind its acceptance costs, OpenRouter or none at all", async () => {
    const litellm = await acceptedPricedBy("litellm");
    expect(await priceSourcesOf(litellm)).toEqual(["litellm"]);

    const openrouter = await acceptedPricedBy("openrouter");
    expect(await priceSourcesOf(openrouter)).toEqual(["openrouter"]);

    const unpriced = await acceptedPricedBy(null);
    expect(await priceSourcesOf(unpriced)).toEqual([]);
  });
});

/** An accepted `cheap` task whose only event was priced by `source`. */
async function acceptedPricedBy(source: string | null): Promise<Fixture> {
  const f = await fixture();
  const task = await addTask(f, { strategy: "cheap" });
  const attempt = await startImpl(f, task.key);
  await event(f, {
    key: "priced",
    attemptId: attempt.id,
    cost: source === null ? null : 0.002,
    quality: source === null ? "unknown" : "estimated",
    source,
  });
  await f.store.finishAttempt(f.projectId, attempt.key, { status: "succeeded", outcome: "ok" });
  await accept(f, task.key);
  return f;
}

const priceSourcesOf = async (f: Fixture) =>
  (await f.run(strategyStats({ projectId: f.projectId }))).price_sources;
