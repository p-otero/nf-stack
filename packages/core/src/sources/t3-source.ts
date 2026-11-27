import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  AGGREGATE_SOURCE_PREFIX,
  COST_QUALITY,
  NfError,
  SUBAGENT_KIND,
  USAGE_SOURCE,
  USAGE_STATUS,
} from "@nf/contracts";
import type { SubagentSpawnInput, TokenFields, UsageEventInput } from "@nf/contracts";
import { estimateCost } from "../domain/prices.ts";
import type { PriceFile } from "../domain/prices.ts";
import {
  emptyTokens,
  obj,
  parseJsonObject,
  textId,
  tokenCount,
  usageStatus,
  utcTimestamp,
} from "../domain/usage.ts";
import type { Obj } from "../domain/usage.ts";
import { readSource } from "./read-source.ts";

export interface T3Thread {
  provider_thread_id: string;
  thread_id: string;
  provider: string | null;
  native_id: string | null;
}

export interface PiThread {
  thread_id: string;
  is_subagent: boolean;
}

export interface T3Read {
  threads: Map<string, T3Thread>;
  /** Pi session file basename (lowercase) -> the T3 thread that drives it. */
  piFiles: Map<string, PiThread>;
  subagentThreads: Set<string>;
  spawns: SubagentSpawnInput[];
  events: UsageEventInput[];
  warnings: string[];
}

// Rows of T3's orchestration_v2 projections. Only the keys must be text; every other column is
// decoded field by field so an unexpected value becomes unknown instead of failing the read.
const ThreadRow = Schema.Struct({
  provider_thread_id: Schema.String,
  thread_id: Schema.Unknown,
  provider: Schema.Unknown,
  payload_json: Schema.Unknown,
});
const TurnRow = Schema.Struct({
  provider_turn_id: Schema.String,
  provider_thread_id: Schema.String,
  thread_id: Schema.Unknown,
  run_attempt_id: Schema.Unknown,
  started_at: Schema.Unknown,
  completed_at: Schema.Unknown,
  payload_json: Schema.Unknown,
});
const SubagentRow = Schema.Struct({
  subagent_id: Schema.String,
  thread_id: Schema.Unknown,
  run_id: Schema.Unknown,
  provider: Schema.Unknown,
  child_thread_id: Schema.Unknown,
  origin: Schema.Unknown,
  started_at: Schema.Unknown,
  completed_at: Schema.Unknown,
  payload_json: Schema.Unknown,
});
const decodeThreadRow = Schema.decodeUnknownOption(ThreadRow);
const decodeTurnRow = Schema.decodeUnknownOption(TurnRow);
const decodeSubagentRow = Schema.decodeUnknownOption(SubagentRow);

/**
 * T3's `turnTokenUsage`, with T3's field semantics: `inputTokens` includes cache reads
 * (`cachedInputTokens`) and writes (`cacheCreationTokens`), `outputTokens` includes reasoning.
 * Subtract the cache components so `input_tokens` means uncached input and cost never charges
 * the same token twice. Missing cache components contribute zero, as T3 built the total.
 */
export function t3Tokens(usage: Obj): { tokens: TokenFields; clamped: boolean } {
  const input = tokenCount(usage["inputTokens"]);
  const reportedRead = tokenCount(usage["cachedInputTokens"]);
  const reportedWrite = tokenCount(usage["cacheCreationTokens"]);
  let uncached: number | null = null;
  let cacheRead = reportedRead;
  let cacheWrite = reportedWrite;
  let clamped = false;
  if (input !== null) {
    cacheRead = reportedRead ?? 0;
    cacheWrite = reportedWrite ?? 0;
    const raw = input - cacheRead - cacheWrite;
    if (raw < 0) {
      uncached = 0;
      clamped = true;
    } else {
      uncached = raw;
    }
  }
  return {
    tokens: {
      input_tokens: uncached,
      output_tokens: tokenCount(usage["outputTokens"]),
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      reasoning_tokens: tokenCount(usage["reasoningTokens"]),
    },
    clamped,
  };
}

function nativeBasename(nativeId: string | null): string | null {
  if (!nativeId) return null;
  const part = nativeId.split(/[\\/]/).pop();
  return part && part.length > 0 ? part.toLowerCase() : null;
}

const schemaError = (file: string, table: string) =>
  new NfError({ code: "source_schema", message: `${file} has no ${table} table` });

/** Read T3 threads (always) and per-turn usage (when `withTurns`) from `statev2.sqlite`. */
export const readT3 = (file: string, withTurns: boolean, prices: PriceFile) =>
  readSource(
    file,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const hasTable = (name: string) =>
        Effect.map(
          sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
          (rows) => rows.length > 0,
        );
      const warnings: string[] = [];
      if (!(yield* hasTable("orchestration_v2_projection_provider_threads"))) {
        return yield* schemaError(file, "orchestration_v2_projection_provider_threads");
      }
      const threads = new Map<string, T3Thread>();
      const piFiles = new Map<string, PiThread>();
      let malformedRows = 0;
      for (const raw of yield* sql`SELECT provider_thread_id, thread_id, provider, provider_instance_id, payload_json
          FROM orchestration_v2_projection_provider_threads ORDER BY provider_thread_id`) {
        const row = decodeThreadRow(raw);
        if (Option.isNone(row)) {
          malformedRows++;
          continue;
        }
        const payload = parseJsonObject(row.value.payload_json);
        const nativeId = textId(obj(payload?.["nativeThreadRef"])?.["nativeId"]);
        const threadId = textId(row.value.thread_id);
        if (!threadId) continue;
        const provider = textId(row.value.provider);
        threads.set(row.value.provider_thread_id, {
          provider_thread_id: row.value.provider_thread_id,
          thread_id: threadId,
          provider,
          native_id: nativeId,
        });
        if (provider?.toLowerCase() === "pi") {
          const key = nativeBasename(nativeId);
          if (key && !piFiles.has(key))
            piFiles.set(key, { thread_id: threadId, is_subagent: false });
        }
      }

      const subagentThreads = new Set<string>();
      const spawns: SubagentSpawnInput[] = [];
      let malformedSpawns = 0;
      if (yield* hasTable("orchestration_v2_projection_subagents")) {
        for (const raw of yield* sql`SELECT subagent_id, thread_id, run_id, provider,
              child_thread_id, origin, started_at, completed_at, payload_json
            FROM orchestration_v2_projection_subagents ORDER BY subagent_id`) {
          const decoded = decodeSubagentRow(raw);
          if (Option.isNone(decoded)) {
            malformedSpawns++;
            continue;
          }
          const row = decoded.value;
          const child = textId(row.child_thread_id);
          if (child) subagentThreads.add(child);
          const origin = textId(row.origin);
          const kind =
            origin === "app_owned"
              ? SUBAGENT_KIND.APP_OWNED
              : origin === "provider_native"
                ? SUBAGENT_KIND.NATIVE
                : null;
          const parent = textId(row.thread_id);
          const started = utcTimestamp(row.started_at);
          // An app-owned child always has a thread of its own; a native one has none.
          if (!kind || !parent || !started || (kind === SUBAGENT_KIND.APP_OWNED && !child)) {
            malformedSpawns++;
            continue;
          }
          const payload = parseJsonObject(row.payload_json);
          spawns.push({
            source_key: `t3:subagent:${row.subagent_id}`,
            parent_t3_thread_id: parent,
            parent_run_id: textId(row.run_id),
            child_t3_thread_id: kind === SUBAGENT_KIND.APP_OWNED ? child : null,
            provider: textId(row.provider),
            model: textId(payload?.["model"]),
            kind,
            started_at: started,
            ended_at: utcTimestamp(row.completed_at),
          });
        }
        if (malformedSpawns > 0)
          warnings.push(`T3: ${malformedSpawns} malformed subagent rows were skipped`);
      } else {
        warnings.push("T3 subagent projection is missing; subagent flags may be incomplete");
      }
      for (const [key, meta] of piFiles) {
        piFiles.set(key, { ...meta, is_subagent: subagentThreads.has(meta.thread_id) });
      }

      const events: UsageEventInput[] = [];
      const done = (): T3Read => {
        if (malformedRows > 0) warnings.push(`T3: ${malformedRows} malformed rows were skipped`);
        return { threads, piFiles, subagentThreads, spawns, events, warnings };
      };
      if (!withTurns) return done();
      if (!(yield* hasTable("orchestration_v2_projection_provider_turns"))) {
        return yield* schemaError(file, "orchestration_v2_projection_provider_turns");
      }

      const runByAttempt = new Map<string, string>();
      if (yield* hasTable("orchestration_v2_projection_run_attempts")) {
        for (const row of yield* sql`SELECT attempt_id, run_id FROM orchestration_v2_projection_run_attempts
            WHERE attempt_id IS NOT NULL AND run_id IS NOT NULL`) {
          const attempt = textId(row["attempt_id"]);
          const run = textId(row["run_id"]);
          if (attempt && run) runByAttempt.set(attempt, run);
        }
      }

      let unparseable = 0;
      let undated = 0;
      for (const raw of yield* sql`SELECT provider_turn_id, thread_id, provider_thread_id, run_attempt_id, status,
            started_at, completed_at, payload_json
          FROM orchestration_v2_projection_provider_turns ORDER BY provider_turn_id`) {
        const decoded = decodeTurnRow(raw);
        if (Option.isNone(decoded)) {
          malformedRows++;
          continue;
        }
        const row = decoded.value;
        const thread = threads.get(row.provider_thread_id);
        const threadId = textId(row.thread_id) ?? thread?.thread_id ?? null;
        const provider = thread?.provider ?? null;
        // Pi consumption is read from Pi's own JSONL, never from T3's context snapshots.
        if (provider?.toLowerCase() === "pi") continue;
        const payload = parseJsonObject(row.payload_json);
        if (!payload) unparseable++;
        const usage = obj(payload?.["turnTokenUsage"]);
        // A local-command result's counters describe that command, not model work.
        if (usage?.["localCommand"] === true) continue;
        const normalized = usage ? t3Tokens(usage) : null;
        const tokens = normalized?.tokens ?? emptyTokens();
        let status = usage ? usageStatus(tokens, usage["usageStatus"]) : USAGE_STATUS.UNAVAILABLE;
        if (normalized?.clamped === true) status = USAGE_STATUS.PARTIAL;
        const ts = utcTimestamp(row.completed_at) ?? utcTimestamp(row.started_at);
        if (!ts) {
          undated++;
          continue;
        }
        const models = Array.isArray(usage?.["models"]) ? (usage["models"] as unknown[]) : [];
        const model = textId(payload?.["model"]) ?? textId(models[0]);
        const cost = estimateCost(prices, model, tokens);
        const nativeTurn = obj(payload?.["nativeTurnRef"]);
        const runAttempt = textId(row.run_attempt_id);
        const base = {
          source: USAGE_SOURCE.T3,
          t3_thread_id: threadId,
          native_session_id: thread?.native_id ?? null,
          run_id: runAttempt ? (runByAttempt.get(runAttempt) ?? null) : null,
          turn_id: textId(nativeTurn?.["nativeId"]) ?? row.provider_turn_id,
          provider,
          model,
          ts,
          usage_status: status,
          is_subagent: threadId !== null && subagentThreads.has(threadId),
          cost_usd: cost.cost_usd,
          cost_quality: cost.cost_quality,
          price_source: cost.price_source,
          price_date: cost.price_date,
          ...tokens,
        };
        events.push({ ...base, source_key: `t3:turn:${row.provider_turn_id}` });

        // otherUsage carries provider-native subagent consumption even when hasSubagents is
        // false, so the numbers decide inclusion. It has no cache split, so its cost stays unknown
        // and stats report these tokens outside the priced totals.
        const sub = usage ? obj(usage["otherUsage"]) : null;
        if (sub) {
          const input = tokenCount(sub["inputTokens"]);
          const output = tokenCount(sub["outputTokens"]);
          if ((input ?? 0) > 0 || (output ?? 0) > 0) {
            events.push({
              ...base,
              input_tokens: input,
              output_tokens: output,
              cache_read_tokens: null,
              cache_write_tokens: null,
              reasoning_tokens: null,
              source_key: `${AGGREGATE_SOURCE_PREFIX}${row.provider_turn_id}`,
              is_subagent: true,
              cost_usd: null,
              cost_quality: COST_QUALITY.UNKNOWN,
              price_source: null,
              price_date: null,
            });
          }
        }
      }
      if (unparseable > 0) warnings.push(`T3: ${unparseable} unparseable turn payloads`);
      if (undated > 0) warnings.push(`T3: ${undated} turns without a timestamp were skipped`);
      return done();
    }),
  );
