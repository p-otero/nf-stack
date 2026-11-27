import * as Schema from "effect/Schema";

/**
 * How T3 spawned a subagent. An app-owned child gets its own T3 thread and its own usage
 * events; a provider-native subagent runs inside the parent turn and its consumption stays in
 * that turn's `otherUsage` aggregate.
 */
export const SUBAGENT_KIND = {
  APP_OWNED: "app_owned",
  NATIVE: "native",
} as const;
export type SubagentKind = (typeof SUBAGENT_KIND)[keyof typeof SUBAGENT_KIND];
export const SUBAGENT_KINDS: readonly SubagentKind[] = Object.values(SUBAGENT_KIND);
export const SubagentKind = Schema.Literals(Object.values(SUBAGENT_KIND));

const NullableString = Schema.NullOr(Schema.String);

/** One subagent T3 spawned under a run, before attribution to an attempt. */
export const SubagentSpawnInput = Schema.Struct({
  /** Stable T3 subagent id; re-syncing updates the same row. */
  source_key: Schema.String,
  parent_t3_thread_id: Schema.String,
  parent_run_id: NullableString,
  /** The child T3 thread; null for provider-native subagents, which have no T3 thread. */
  child_t3_thread_id: NullableString,
  provider: NullableString,
  model: NullableString,
  kind: SubagentKind,
  started_at: Schema.String,
  ended_at: NullableString,
});
export type SubagentSpawnInput = typeof SubagentSpawnInput.Type;

export const SubagentSpawn = Schema.Struct({
  ...SubagentSpawnInput.fields,
  id: Schema.String,
  /** Attempt of the spawning thread whose window contains `started_at`; null otherwise. */
  attempt_id: NullableString,
  created_at: Schema.String,
});
export type SubagentSpawn = typeof SubagentSpawn.Type;
