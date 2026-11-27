import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { NfError, SYNC_STATUS, USAGE_BUCKET, USAGE_SOURCE, USAGE_SOURCES } from "@nf/contracts";
import type {
  SourceSyncResult,
  SubagentSpawnInput,
  SyncResult,
  UsageEventInput,
  UsageSource,
} from "@nf/contracts";
import { backfillAttemptCoordinators } from "../persistence/coordinators.persistence.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import {
  childAttemptMap,
  loadChildAttempts,
  loadExistingSpawns,
  persistSpawns,
  reattributeSpawns,
} from "../persistence/subagent.persistence.ts";
import {
  loadAttributionIndex,
  loadExistingEvents,
  persistEvents,
  reattributeEvents,
  writeSyncState,
} from "../persistence/usage.persistence.ts";
import type { ExistingEvent } from "../persistence/usage.persistence.ts";
import type { AttributionIndex } from "../domain/attribution.ts";
import { errorText } from "../domain/errors.ts";
import type { PriceFile } from "../domain/prices.ts";
import { readPi } from "../sources/pi-source.ts";
import type { PiRead } from "../sources/pi-source.ts";
import { readT3 } from "../sources/t3-source.ts";
import type { PiThread, T3Read } from "../sources/t3-source.ts";

export interface SyncOptions {
  /** T3 Code state database (`~/.t3/userdata/statev2.sqlite`). */
  t3State: string;
  /** Root of Pi session JSONL files (`~/.pi/agent/sessions`). */
  piSessions: string;
  /** The machine's price chain, already built (`loadPrices`). */
  prices: PriceFile;
  source?: UsageSource | "all" | undefined;
  dryRun?: boolean | undefined;
  /** Threads to treat as coordination in addition to each project's coordinator thread. */
  coordinatorThreads?: readonly string[] | undefined;
  now?: Date | undefined;
}

/** The one line a failed source contributes to the sync result. */
function failureMessage(cause: Cause.Cause<unknown>): string {
  return errorText(Cause.squash(cause));
}

function maxTs(events: readonly UsageEventInput[]): string | null {
  let max: string | null = null;
  for (const event of events) if (max === null || event.ts > max) max = event.ts;
  return max;
}

function failed(source: UsageSource, error: string, warnings: readonly string[]): SourceSyncResult {
  return {
    source,
    status: SYNC_STATUS.FAILED,
    seen: 0,
    duplicates: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    attributed: 0,
    coordination: 0,
    unattributed: 0,
    spawns: 0,
    cursor: null,
    error,
    warnings,
  };
}

interface Planned {
  source: UsageSource;
  events: readonly UsageEventInput[];
  spawns: readonly SubagentSpawnInput[];
  duplicates: number;
  warnings: readonly string[];
  error: string | null;
}

/** Ingest per-turn usage from T3 Code and Pi, attribute it to attempts, and estimate cost. */
const unavailable = (message: string) => new NfError({ code: "source_unavailable", message });

export const syncUsage = Effect.fn("UsageSync.syncUsage")(function* (opts: SyncOptions) {
  const store = yield* TaskStore;
  const source = opts.source ?? "all";
  const dryRun = opts.dryRun === true;
  const at = (opts.now ?? new Date()).toISOString();
  const warnings: string[] = [];
  const prices = opts.prices;
  warnings.push(...prices.warnings);

  const wanted: readonly UsageSource[] = source === "all" ? USAGE_SOURCES : [source];
  // T3 is read even for a Pi-only sync: it maps Pi session files to T3 threads.
  const t3Exit = yield* Effect.exit(readT3(opts.t3State, wanted.includes(USAGE_SOURCE.T3), prices));
  const t3: T3Read | null = Exit.isSuccess(t3Exit) ? t3Exit.value : null;
  const t3Error = Exit.isFailure(t3Exit) ? failureMessage(t3Exit.cause) : null;
  const threads = new Map<string, PiThread>(t3 ? t3.piFiles : []);

  let pi: PiRead | null = null;
  let piError: string | null = null;
  if (wanted.includes(USAGE_SOURCE.PI)) {
    const piExit = yield* Effect.exit(readPi(opts.piSessions, prices, threads));
    if (Exit.isSuccess(piExit)) pi = piExit.value;
    else piError = failureMessage(piExit.cause);
  }

  const index: AttributionIndex = yield* loadAttributionIndex(opts.coordinatorThreads ?? []);
  const existing: Map<string, ExistingEvent> = yield* loadExistingEvents();
  const existingSpawns = yield* loadExistingSpawns();
  // Planned from the source, not from the store, so a dry run sees the same child attribution.
  const plannedChildren = childAttemptMap(index, t3?.spawns ?? []);
  const storedChildren = yield* loadChildAttempts();
  const childAttempts = new Map([...storedChildren, ...plannedChildren]);

  const plan = Effect.fnUntraced(function* (entry: Planned) {
    if (entry.error !== null) return failed(entry.source, entry.error, entry.warnings);
    const spawnResult =
      entry.spawns.length > 0
        ? yield* persistSpawns({
            spawns: entry.spawns,
            existing: existingSpawns,
            index,
            createdAt: at,
            dryRun,
          })
        : { seen: 0 };
    const out = yield* persistEvents({
      machine: store.machine,
      events: entry.events,
      existing,
      index,
      childAttempts,
      createdAt: at,
      dryRun,
    });
    let attributed = 0;
    let coordination = 0;
    let unattributed = 0;
    for (const a of out.results) {
      if (a.bucket === USAGE_BUCKET.ATTEMPT) attributed++;
      else if (a.bucket === USAGE_BUCKET.COORDINATION) coordination++;
      else unattributed++;
    }
    const result: SourceSyncResult = {
      source: entry.source,
      status: entry.warnings.length > 0 ? SYNC_STATUS.PARTIAL : SYNC_STATUS.OK,
      seen: entry.events.length,
      duplicates: entry.duplicates,
      inserted: out.inserted,
      updated: out.updated,
      skipped: out.skipped,
      attributed,
      coordination,
      unattributed,
      spawns: spawnResult.seen,
      cursor: maxTs(entry.events),
      error: null,
      warnings: entry.warnings,
    };
    return result;
  });

  const apply = Effect.gen(function* () {
    const results: SourceSyncResult[] = [];
    if (wanted.includes(USAGE_SOURCE.T3)) {
      results.push(
        yield* plan({
          source: USAGE_SOURCE.T3,
          events: t3?.events ?? [],
          spawns: t3?.spawns ?? [],
          duplicates: 0,
          warnings: t3Error ? [] : (t3?.warnings ?? []),
          error: t3Error,
        }),
      );
    } else if (t3Error) {
      warnings.push(`T3 thread mapping unavailable: ${t3Error}`);
    }
    if (wanted.includes(USAGE_SOURCE.PI)) {
      results.push(
        yield* plan({
          source: USAGE_SOURCE.PI,
          events: pi?.events ?? [],
          spawns: [],
          duplicates: pi?.duplicates ?? 0,
          warnings: piError ? [] : (pi?.warnings ?? []),
          error: piError,
        }),
      );
    }
    yield* reattributeSpawns(index, dryRun);
    yield* reattributeEvents(index, childAttempts, dryRun);
    if (!dryRun) yield* backfillAttemptCoordinators();
    if (!dryRun) for (const result of results) yield* writeSyncState(result, at);
    return results;
  });

  const results = yield* dryRun ? apply : store.transaction(apply);

  const total = (pick: (r: SourceSyncResult) => number): number =>
    results.reduce((sum, r) => sum + pick(r), 0);
  const syncResult: SyncResult = {
    dry_run: dryRun,
    price_date: prices.date,
    price_sources: [...prices.sources],
    sources: results,
    seen: total((r) => r.seen),
    inserted: total((r) => r.inserted),
    updated: total((r) => r.updated),
    skipped: total((r) => r.skipped),
    attributed: total((r) => r.attributed),
    coordination: total((r) => r.coordination),
    unattributed: total((r) => r.unattributed),
    spawns: total((r) => r.spawns),
    warnings,
  };
  if (wanted.includes(USAGE_SOURCE.T3) && t3Error && !wanted.includes(USAGE_SOURCE.PI)) {
    return yield* unavailable(t3Error);
  }
  if (wanted.includes(USAGE_SOURCE.PI) && piError && !wanted.includes(USAGE_SOURCE.T3)) {
    return yield* unavailable(piError);
  }
  if (wanted.length > 1 && results.every((r) => r.status === SYNC_STATUS.FAILED)) {
    return yield* unavailable(t3Error ?? piError ?? "no usage source available");
  }
  return syncResult;
});
