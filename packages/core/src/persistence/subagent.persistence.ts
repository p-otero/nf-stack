import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ContextMode, Strategy, SubagentKind, SubagentSpawnInput } from "@nf/contracts";
import { attribute } from "../domain/attribution.ts";
import type { AttributionIndex } from "../domain/attribution.ts";
import { ulid } from "../domain/ids.ts";

export interface ExistingSpawn {
  id: string;
  source_key: string;
  parent_t3_thread_id: string;
  parent_run_id: string | null;
  child_t3_thread_id: string | null;
  provider: string | null;
  model: string | null;
  kind: SubagentKind;
  started_at: string;
  ended_at: string | null;
  attempt_id: string | null;
}

type ComparedKey = Exclude<keyof ExistingSpawn, "id" | "source_key" | "attempt_id">;

const COMPARED: readonly ComparedKey[] = [
  "parent_t3_thread_id",
  "parent_run_id",
  "child_t3_thread_id",
  "provider",
  "model",
  "kind",
  "started_at",
  "ended_at",
];

function unchanged(row: ExistingSpawn, spawn: SubagentSpawnInput): boolean {
  for (const key of COMPARED) if (row[key] !== spawn[key]) return false;
  return true;
}

function measuredFields(spawn: SubagentSpawnInput) {
  return {
    parent_t3_thread_id: spawn.parent_t3_thread_id,
    parent_run_id: spawn.parent_run_id,
    child_t3_thread_id: spawn.child_t3_thread_id,
    provider: spawn.provider,
    model: spawn.model,
    kind: spawn.kind,
    started_at: spawn.started_at,
    ended_at: spawn.ended_at,
  };
}

export const loadExistingSpawns = Effect.fn("SubagentStore.loadExistingSpawns")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existing = new Map<string, ExistingSpawn>();
  for (const row of yield* sql<ExistingSpawn>`SELECT id, source_key, parent_t3_thread_id,
      parent_run_id, child_t3_thread_id, provider, model, kind, started_at, ended_at, attempt_id
    FROM subagent_spawns`) {
    existing.set(row.source_key, row);
  }
  return existing;
});

/**
 * App-owned child thread -> the attempt that spawned it. Child threads that host an NF attempt
 * are still listed; `attributeParent` keeps their events on that attempt.
 */
export const loadChildAttempts = Effect.fn("SubagentStore.loadChildAttempts")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const children = new Map<string, string>();
  for (const row of yield* sql<{
    child_t3_thread_id: string;
    attempt_id: string;
  }>`SELECT child_t3_thread_id, attempt_id FROM subagent_spawns
    WHERE kind = 'app_owned' AND child_t3_thread_id IS NOT NULL AND attempt_id IS NOT NULL`) {
    children.set(row.child_t3_thread_id, row.attempt_id);
  }
  return children;
});

/** Insert new spawns and update changed ones by `source_key`; the spawn attempt is re-derived. */
export const persistSpawns = Effect.fn("SubagentStore.persistSpawns")(function* (options: {
  readonly spawns: readonly SubagentSpawnInput[];
  readonly existing: Map<string, ExistingSpawn>;
  readonly index: AttributionIndex;
  readonly createdAt: string;
  readonly dryRun: boolean;
}) {
  const sql = yield* SqlClient.SqlClient;
  const { spawns, existing, index, createdAt, dryRun } = options;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const spawn of spawns) {
    const attemptId = attribute(index, spawn.parent_t3_thread_id, spawn.started_at).attempt_id;
    const row = existing.get(spawn.source_key);
    if (row) {
      if (unchanged(row, spawn) && row.attempt_id === attemptId) {
        skipped++;
        continue;
      }
      updated++;
      if (!dryRun) {
        yield* sql`UPDATE subagent_spawns SET ${sql.update({
          ...measuredFields(spawn),
          attempt_id: attemptId,
        })} WHERE id = ${row.id}`;
      }
      existing.set(spawn.source_key, { ...row, ...measuredFields(spawn), attempt_id: attemptId });
      continue;
    }
    inserted++;
    if (!dryRun) {
      const id = ulid();
      yield* sql`INSERT INTO subagent_spawns ${sql.insert({
        id,
        source_key: spawn.source_key,
        ...measuredFields(spawn),
        attempt_id: attemptId,
        created_at: createdAt,
      })}`;
      existing.set(spawn.source_key, {
        id,
        source_key: spawn.source_key,
        ...measuredFields(spawn),
        attempt_id: attemptId,
      });
    }
  }
  return { inserted, updated, skipped, seen: spawns.length };
});

/** Re-derive `attempt_id` for every spawn (attempt windows may have changed since the last sync). */
export const reattributeSpawns = Effect.fn("SubagentStore.reattributeSpawns")(function* (
  index: AttributionIndex,
  dryRun: boolean,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    id: string;
    parent_t3_thread_id: string;
    started_at: string;
    attempt_id: string | null;
  }>`SELECT id, parent_t3_thread_id, started_at, attempt_id FROM subagent_spawns`;
  for (const row of rows) {
    const want = attribute(index, row.parent_t3_thread_id, row.started_at).attempt_id;
    if (want === row.attempt_id) continue;
    if (!dryRun) {
      yield* sql`UPDATE subagent_spawns SET attempt_id = ${want} WHERE id = ${row.id}`;
    }
  }
});

/** One spawn grouping of an attempt, with the app-owned child usage it produced. */
export interface SpawnGroupRow {
  attempt_id: string;
  kind: SubagentKind;
  model: string | null;
  count: number;
}

export interface ChildSpawnRow {
  child_t3_thread_id: string;
  attempt_id: string;
  kind: SubagentKind;
  model: string | null;
}

/** App-owned child thread -> the attempt of the attempt window that spawned it. */
export function childAttemptMap(
  index: AttributionIndex,
  spawns: readonly SubagentSpawnInput[],
): Map<string, string> {
  const children = new Map<string, string>();
  for (const spawn of spawns) {
    if (spawn.kind !== "app_owned" || spawn.child_t3_thread_id === null) continue;
    const attemptId = attribute(index, spawn.parent_t3_thread_id, spawn.started_at).attempt_id;
    if (attemptId) children.set(spawn.child_t3_thread_id, attemptId);
  }
  return children;
}

export const selectSpawnGroups = Effect.fn("SubagentStore.selectSpawnGroups")(function* (
  attemptIds: readonly string[],
) {
  const sql = yield* SqlClient.SqlClient;
  if (attemptIds.length === 0) return [];
  const rows = yield* sql<{
    attempt_id: string;
    kind: SubagentKind;
    model: string | null;
    count: number;
  }>`SELECT attempt_id, kind, model, COUNT(*) AS count FROM subagent_spawns
    WHERE attempt_id IN ${sql.in(attemptIds)}
    GROUP BY attempt_id, kind, model ORDER BY attempt_id, kind, model`;
  return rows.map((row): SpawnGroupRow => ({
    attempt_id: row.attempt_id,
    kind: row.kind,
    model: row.model,
    count: row.count,
  }));
});

/** App-owned child threads of these attempts, to group their usage into the spawning spawn. */
export const selectChildSpawns = Effect.fn("SubagentStore.selectChildSpawns")(function* (
  attemptIds: readonly string[],
) {
  const sql = yield* SqlClient.SqlClient;
  if (attemptIds.length === 0) return [];
  return [
    ...(yield* sql<ChildSpawnRow>`SELECT child_t3_thread_id, attempt_id, kind, model
      FROM subagent_spawns
      WHERE attempt_id IN ${sql.in(attemptIds)} AND kind = 'app_owned'
        AND child_t3_thread_id IS NOT NULL`),
  ];
});

export type SpawnScope =
  | { readonly kind: "all" }
  | {
      readonly kind: "project";
      readonly projectId: string;
      readonly coordinatorThreads: readonly string[];
    };

export const selectSpawnCountsByAttempt = Effect.fn("SubagentStore.selectSpawnCountsByAttempt")(
  function* (scope: SpawnScope) {
    const sql = yield* SqlClient.SqlClient;
    const rows =
      scope.kind === "all"
        ? yield* sql<{ attempt_id: string; n: number }>`SELECT attempt_id, COUNT(*) AS n
            FROM subagent_spawns WHERE attempt_id IS NOT NULL GROUP BY attempt_id`
        : yield* sql<{ attempt_id: string; n: number }>`SELECT s.attempt_id, COUNT(*) AS n
            FROM subagent_spawns s
            JOIN attempts a ON a.id = s.attempt_id
            JOIN tasks t ON t.id = a.task_id
            WHERE s.attempt_id IS NOT NULL AND t.project_id = ${scope.projectId}
            GROUP BY s.attempt_id`;
    return new Map(rows.map((row) => [row.attempt_id, row.n]));
  },
);

export const selectSpawnCountsByModel = Effect.fn("SubagentStore.selectSpawnCountsByModel")(
  function* (scope: SpawnScope) {
    const sql = yield* SqlClient.SqlClient;
    const rows =
      scope.kind === "all"
        ? yield* sql<{ model: string | null; n: number }>`SELECT model, COUNT(*) AS n
            FROM subagent_spawns GROUP BY model`
        : yield* sql<{ model: string | null; n: number }>`SELECT s.model, COUNT(*) AS n
            FROM subagent_spawns s
            LEFT JOIN attempts a ON a.id = s.attempt_id
            LEFT JOIN tasks t ON t.id = a.task_id
            WHERE t.project_id = ${scope.projectId}
              ${scope.coordinatorThreads.length > 0 ? sql`OR s.parent_t3_thread_id IN ${sql.in(scope.coordinatorThreads)}` : sql.literal("")}
            GROUP BY s.model`;
    return new Map(rows.map((row) => [row.model ?? "(unknown)", row.n]));
  },
);

export type SpawnStrategyScope =
  { readonly kind: "all" } | { readonly kind: "project"; readonly projectId: string };

export const selectSpawnCountsByStrategy = Effect.fn("SubagentStore.selectSpawnCountsByStrategy")(
  function* (scope: SpawnStrategyScope) {
    const sql = yield* SqlClient.SqlClient;
    const where =
      scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
    const rows = yield* sql<{ strategy: Strategy | null; n: number }>`SELECT t.strategy AS strategy,
      COUNT(*) AS n
    FROM subagent_spawns s
    JOIN attempts a ON a.id = s.attempt_id
    JOIN tasks t ON t.id = a.task_id
    ${where}
    GROUP BY t.strategy`;
    return new Map(rows.map((row) => [row.strategy, row.n]));
  },
);

export const selectSpawnCountsByContext = Effect.fn("SubagentStore.selectSpawnCountsByContext")(
  function* (scope: SpawnStrategyScope) {
    const sql = yield* SqlClient.SqlClient;
    const where =
      scope.kind === "project" ? sql`WHERE t.project_id = ${scope.projectId}` : sql.literal("");
    const rows = yield* sql<{ context: ContextMode; n: number }>`SELECT a.context_mode AS context,
      COUNT(*) AS n
    FROM subagent_spawns s
    JOIN attempts a ON a.id = s.attempt_id
    JOIN tasks t ON t.id = a.task_id
    ${where}
    GROUP BY a.context_mode`;
    return new Map(rows.map((row) => [row.context, row.n]));
  },
);

/** Spawns the coordinator threads made themselves: they belong to no attempt, so no task counts
 * them. */
export const selectCoordinatorSpawnCount = Effect.fn("SubagentStore.selectCoordinatorSpawnCount")(
  function* (coordinatorThreads: readonly string[]) {
    const sql = yield* SqlClient.SqlClient;
    if (coordinatorThreads.length === 0) return 0;
    const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM subagent_spawns
      WHERE parent_t3_thread_id IN ${sql.in(coordinatorThreads)}`;
    return rows[0]?.n ?? 0;
  },
);
