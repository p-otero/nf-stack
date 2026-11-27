import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { uniqueProjectPrefix } from "../domain/keys.ts";
import { decodeProjectIdentity } from "./store-rows.ts";

/** Re-key a project's tasks and attempts after its prefix changed; numbers never change. */
export const rewriteProjectKeys = Effect.fn("ProjectPrefix.rewriteProjectKeys")(function* (
  sql: SqlClient.SqlClient,
  projectId: string,
  prefix: string,
) {
  yield* sql`UPDATE tasks SET key = ${prefix} || '-' || printf('%03d', seq)
    WHERE project_id = ${projectId}`;
  yield* sql`UPDATE attempts
    SET key = (SELECT t.key FROM tasks t WHERE t.id = attempts.task_id) || '-A' || seq
    WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ${projectId})`;
});

/**
 * The v6 data step: every existing project gets a unique prefix derived from its name, then its
 * tasks and attempts are re-keyed to it. The unique index enforces the per-store uniqueness that
 * `registerProject` and `setProjectPrefix` check with a clearer error.
 */
export const assignProjectPrefixes = Effect.fn("ProjectPrefix.assignProjectPrefixes")(function* (
  sql: SqlClient.SqlClient,
) {
  const projects = (yield* sql`SELECT id, name FROM projects ORDER BY created_at, id`).map((row) =>
    decodeProjectIdentity(row),
  );
  const taken = new Set<string>();
  for (const project of projects) {
    const prefix = uniqueProjectPrefix(project.name, taken);
    taken.add(prefix);
    yield* sql`UPDATE projects SET prefix = ${prefix} WHERE id = ${project.id}`;
  }
  yield* sql`UPDATE tasks SET key = (SELECT p.prefix FROM projects p
      WHERE p.id = tasks.project_id) || '-' || printf('%03d', seq)`;
  yield* sql`UPDATE attempts SET key = (SELECT t.key FROM tasks t
      WHERE t.id = attempts.task_id) || '-A' || seq`;
  yield* sql`CREATE UNIQUE INDEX projects_prefix ON projects (prefix)`;
});
