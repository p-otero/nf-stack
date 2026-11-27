import { describe, expect, test } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import {
  NfError,
  Quantity,
  SyncResult,
  TASK_STATUS,
  TASK_STATUSES,
  Task,
  TaskView,
  TELEMETRY_ENTITY_KINDS,
  TELEMETRY_GROUP_BYS,
  TelemetryView,
  isNfError,
} from "../src/index.ts";

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownExit(schema)(input);

const q = (value: number | null, quality = "measured") => ({ value, quality });

describe("contracts", () => {
  test("semantic constants and their schema agree", () => {
    expect(TASK_STATUSES).toEqual([
      "proposed",
      "todo",
      "working",
      "review",
      "blocked",
      "done",
      "cancelled",
    ]);
    expect(TASK_STATUS.DONE).toBe("done");
  });

  test("a stored task decodes and a bad status is rejected", () => {
    const task = {
      id: "01J",
      project_id: "01P",
      key: "T-001",
      title: "t",
      goal: "g",
      status: "todo",
      profile: null,
      analysis_mode: null,
      strategy: null,
      ui: false,
      authorization: null,
      decision_needed: null,
      blocker: { identity: "quota" },
      evidence: null,
      accepted_first_pass: null,
      human_interventions: 0,
      source: null,
      design_ref: null,
      superseded_by: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      acceptance: [{ position: 1, text: "a", result: "unverified", evidence: null }],
      depends_on: [],
    };
    expect(Exit.isSuccess(decode(Task, task))).toBe(true);
    expect(Exit.isFailure(decode(Task, { ...task, status: "ready" }))).toBe(true);
  });

  test("an unknown quantity has a null value, never zero", () => {
    expect(Exit.isSuccess(decode(Quantity, { value: null, quality: "unknown" }))).toBe(true);
    expect(Exit.isFailure(decode(Quantity, { value: 1, quality: "guess" }))).toBe(true);
  });

  test("a board task view with attempts and usage decodes", () => {
    const view = {
      id: "T-015",
      title: "Store module",
      status: "review",
      dependsOn: [{ id: "T-014", status: "done" }],
      acceptance: [{ text: "suite green", result: "pass" }],
      attempts: [
        {
          id: "T-015-A2",
          kind: "implementation",
          status: "succeeded",
          configured: {
            provider: "pi",
            model: "zai/glm-5.3",
            effort: { name: "thinking", value: "high" },
          },
          contextMode: "fresh",
          thread: { id: "th-1", href: "t3-thread://v2/env/th-1" },
          startedAt: "2026-11-15T15:43:00Z",
          usage: {
            inputTokens: q(1260000),
            outputTokens: q(52000),
            cacheReadTokens: q(null, "unknown"),
            cacheWriteTokens: q(null, "unknown"),
            reasoningTokens: q(24000),
            costUsd: { value: 0.58, quality: "estimated", source: "litellm 2026-11-15" },
          },
          checks: [{ name: "bun test", result: "pass" }],
        },
      ],
      counts: { attempts: 1, repairs: 0, reviews: 0, humanInterventions: 1 },
      updatedAt: "2026-11-15T17:20:00Z",
    };
    expect(Exit.isSuccess(decode(TaskView, view))).toBe(true);
  });

  test("a telemetry view carries rows, shares and unpriced usage", () => {
    const cost = (value: number | null) => ({
      ...q(value, "estimated"),
      base: q(value, "estimated"),
      repair: q(null, "unknown"),
      median: q(value, "derived"),
    });
    const metrics = {
      tasks: 2,
      n: 2,
      firstPass: { accepted: 1, total: 2 },
      costToAcceptance: cost(0.5),
      costPerAcceptedTask: q(0.25, "derived"),
      tokens: q(110),
      cacheRead: q(40),
      cacheShare: 40 / 110,
      repairs: 1,
      spawns: 0,
    };
    const view = {
      range: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
      groupBy: "strategy",
      rows: [
        {
          entity: { id: "cheap", label: "cheap", kind: "strategy", color: 3 },
          ...metrics,
          share: { cost: 1, tokens: 1 },
        },
        {
          entity: { id: "coordination", label: "coordination", kind: "coordination", color: null },
          ...metrics,
          tasks: 0,
          n: 0,
          firstPass: { accepted: 0, total: 0 },
          share: { cost: null, tokens: null },
        },
      ],
      // The task totals carry the coordinator's usage apart, never inside them.
      totals: { ...metrics, coordination: { cost: q(0.25), tokens: q(40), spawns: 1 } },
      unpriced: { events: 1, tokens: null },
      cache: {
        contexts: [],
        models: [],
        totals: {
          tokens: q(110),
          cacheRead: q(40),
          cacheShare: 40 / 110,
          savings: q(0.1, "derived"),
          unpriced: null,
        },
      },
      daily: [{ date: "2026-01-01", workers: q(0.5), coordination: q(0.25) }],
      price_sources: ["litellm", "pi"],
    };
    expect(Exit.isSuccess(decode(TelemetryView, view))).toBe(true);
    expect(TELEMETRY_GROUP_BYS).toEqual(["strategy", "model", "profile", "task", "coordinator"]);
    expect(TELEMETRY_ENTITY_KINDS).toContain("coordination");
    const colorOffPalette = structuredClone(view);
    // @ts-expect-error narrowed literal for the mutation below
    colorOffPalette.rows[0].entity.color = 6;
    expect(Exit.isFailure(decode(TelemetryView, colorOffPalette))).toBe(true);
    const totalsWithoutCoordination = structuredClone(view);
    // @ts-expect-error the totals must say what the coordinator cost
    delete totalsWithoutCoordination.totals.coordination;
    expect(Exit.isFailure(decode(TelemetryView, totalsWithoutCoordination))).toBe(true);
    const noThresholds = JSON.stringify(view);
    expect(noThresholds).not.toContain("indicative");
    expect(noThresholds).not.toContain("sample");
  });

  test("sync results decode and NfError is a tagged, recognizable error", () => {
    const result = {
      dry_run: false,
      price_date: null,
      price_sources: [{ source: "litellm", date: "2026-01-01" }],
      sources: [],
      seen: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      attributed: 0,
      coordination: 0,
      unattributed: 0,
      spawns: 0,
      warnings: [],
    };
    expect(Exit.isSuccess(decode(SyncResult, result))).toBe(true);
    const err = new NfError({ code: "not_found", message: "task T-009 not found" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("task T-009 not found");
    expect(isNfError(err)).toBe(true);
  });
});
