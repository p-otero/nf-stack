import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { Attempt, AttemptCheck } from "@nf/contracts";
import { fromJson } from "../domain/validate.ts";
import { decodeCheck, decodeCommit, decodeKey, one, type AttemptRow } from "./store-rows.ts";

export const loadAttempt = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  row: AttemptRow,
  taskKey: string,
) {
  const commits =
    (yield* sql`SELECT sha FROM attempt_commits WHERE attempt_id = ${row.id} ORDER BY position`).map(
      (commitRow) => decodeCommit(commitRow).sha,
    );
  const checks: AttemptCheck[] =
    (yield* sql`SELECT position, command, result, detail FROM attempt_checks
      WHERE attempt_id = ${row.id} ORDER BY position`).map((checkRow) => decodeCheck(checkRow));
  const repairedRow =
    row.repair_of === null
      ? undefined
      : yield* one(sql`SELECT key FROM attempts WHERE id = ${row.repair_of}`);
  const fallbacks = fromJson(row.fallbacks);
  const attempt: Attempt = {
    id: row.id,
    task_id: row.task_id,
    task_key: taskKey,
    key: row.key,
    kind: row.kind,
    status: row.status,
    mechanism: row.mechanism,
    environment_id: row.environment_id,
    thread_id: row.thread_id,
    thread_link: row.thread_link,
    t3_task_id: row.t3_task_id,
    client_request_id: row.client_request_id,
    provider_instance_id: row.provider_instance_id,
    model: row.model,
    options: fromJson(row.options),
    executed_model: row.executed_model,
    profile: row.profile,
    strategy: row.strategy,
    coordinator_thread_id: row.coordinator_thread_id,
    coordinator_model: row.coordinator_model,
    reason: row.reason,
    fallbacks: Array.isArray(fallbacks) ? fallbacks : [],
    context_mode: row.context_mode,
    source_thread_id: row.source_thread_id,
    repair_of: repairedRow === undefined ? null : decodeKey(repairedRow).key,
    started_at: row.started_at,
    ended_at: row.ended_at,
    base_commit: row.base_commit,
    worktree: row.worktree,
    branch: row.branch,
    ...(row.pr_url === null ? {} : { pr_url: row.pr_url }),
    commits,
    diff_location: row.diff_location,
    outcome: row.outcome,
    failure_class: row.failure_class,
    failure_detail: row.failure_detail,
    retry_at: row.retry_at,
    last_verified: row.last_verified,
    remaining: row.remaining,
    checks,
  };
  return attempt;
});
