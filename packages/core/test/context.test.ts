import { afterEach, describe, expect, test } from "bun:test";
import { contextStats } from "../src/index.ts";
import type { CostQuality, Task } from "../src/index.ts";
import type { Fixture } from "./helpers.ts";
import { addTask, cleanupAll, fixture, passAll, startImpl } from "./helpers.ts";

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

describe("context stats", () => {
  test("groups tasks, first-pass and acceptance cost by attempt context transfer", async () => {
    const f = await fixture();

    // Fresh first, then a reuse repair: the task counts in both contexts, first pass misses.
    const retried = await addTask(f, { title: "fresh then reuse" });
    const fresh = await startImpl(f, retried.key);
    await f.store.updateAttempt(f.projectId, fresh.key, { status: "active" });
    await event(f, { key: "fresh", attemptId: fresh.id, cost: 0.5, quality: "reported" });
    await f.store.finishAttempt(f.projectId, fresh.key, { status: "failed", outcome: "no" });
    const reuse = await startImpl(f, retried.key, {
      contextMode: "reuse",
      mechanism: "thread_send_reuse",
      sourceThread: "thread-a",
      repairOf: fresh.key,
    });
    await event(f, { key: "reuse", attemptId: reuse.id, cost: 0.002, quality: "estimated" });
    await f.store.finishAttempt(f.projectId, reuse.key, { status: "succeeded", outcome: "ok" });
    await accept(f, retried.key);

    // A fork that is still open: counted in tasks, outside the rate and the acceptance cost.
    const open = await addTask(f, { title: "fork open" });
    const fork = await startImpl(f, open.key, { contextMode: "fork", mechanism: "fork" });
    await event(f, { key: "fork", attemptId: fork.id, cost: 1, quality: "reported" });

    // Compact, accepted first pass, with an unpriced event: the cost is a floor.
    const compactTask = await addTask(f, { title: "compact" });
    const compact = await startImpl(f, compactTask.key, { contextMode: "compact" });
    await event(f, { key: "compact", attemptId: compact.id, cost: 0.25, quality: "reported" });
    await event(f, { key: "compact-free", attemptId: compact.id, cost: null, quality: "unknown" });
    await f.store.finishAttempt(f.projectId, compact.key, { status: "succeeded", outcome: "ok" });
    await accept(f, compactTask.key);

    const stats = await f.run(contextStats({ projectId: f.projectId }));
    expect(stats.by).toBe("context");
    expect(stats.project?.name).toBe("demo");
    expect(stats.rows.map((r) => r.context)).toEqual(["fresh", "fork", "reuse", "compact"]);
    // Pi's reported charge and the LiteLLM estimate; the open fork's event prices nothing yet.
    expect(stats.price_sources).toEqual(["litellm", "pi"]);

    const [freshRow, forkRow, reuseRow, compactRow] = stats.rows;
    expect(freshRow).toMatchObject({ tasks: 1, n: 1, first_pass: 0, first_pass_rate: 0 });
    expect(freshRow?.cost_to_acceptance.value).toBeCloseTo(0.5, 12);
    expect(freshRow?.cost_to_acceptance.quality).toBe("reported");
    expect(forkRow).toMatchObject({ tasks: 1, n: 0, first_pass_rate: null });
    expect(forkRow?.cost_to_acceptance).toMatchObject({ value: null, quality: "unknown" });
    expect(reuseRow).toMatchObject({ tasks: 1, n: 1, first_pass: 0 });
    expect(reuseRow?.cost_to_acceptance.value).toBeCloseTo(0.002, 12);
    expect(reuseRow?.cost_to_acceptance.quality).toBe("estimated");
    expect(compactRow).toMatchObject({ tasks: 1, n: 1, first_pass: 1, first_pass_rate: 1 });
    expect(compactRow?.cost_to_acceptance.value).toBeCloseTo(0.25, 12);
    expect(compactRow?.cost_to_acceptance.quality).toBe("estimated");
    expect(compactRow?.cost_to_acceptance.unknown_events).toBe(1);

    // The per-context costs of accepted tasks add up to the task-level acceptance cost.
    const accepted = [freshRow, reuseRow, compactRow].reduce(
      (sum, row) => sum + (row?.cost_to_acceptance.value ?? 0),
      0,
    );
    expect(accepted).toBeCloseTo(0.752, 12);

    const all = await f.run(contextStats({ allProjects: true }));
    expect(all.all_projects).toBe(true);
    expect(all.rows.map((r) => r.tasks)).toEqual([1, 1, 1, 1]);
  });

  test("names the layer behind its acceptance costs, OpenRouter or none at all", async () => {
    const litellm = await acceptedPricedBy("litellm");
    expect(await priceSourcesOf(litellm)).toEqual(["litellm"]);

    const openrouter = await acceptedPricedBy("openrouter");
    expect(await priceSourcesOf(openrouter)).toEqual(["openrouter"]);

    const unpriced = await acceptedPricedBy(null);
    expect(await priceSourcesOf(unpriced)).toEqual([]);
  });

  test("a project without attempts has no rows", async () => {
    const f = await fixture();
    const stats = await f.run(contextStats({ projectId: f.projectId }));
    expect(stats.rows).toEqual([]);
    expect(stats.price_sources).toEqual([]);
  });
});

/** An accepted task whose only attempt reused a thread, priced by `source`. */
async function acceptedPricedBy(source: string | null): Promise<Fixture> {
  const f = await fixture();
  const task = await addTask(f, { title: "priced context" });
  const attempt = await startImpl(f, task.key, {
    contextMode: "reuse",
    mechanism: "thread_send_reuse",
    sourceThread: "thread-a",
  });
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
  (await f.run(contextStats({ projectId: f.projectId }))).price_sources;
