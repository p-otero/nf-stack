import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { readSource } from "./read-source.ts";

const ProjectRow = Schema.Struct({
  workspace_root: Schema.String,
  deleted_at: Schema.NullOr(Schema.String),
});
const decodeProjectRow = Schema.decodeUnknownOption(ProjectRow);

/**
 * The workspace roots of T3 Code's live projects (`projection_projects`), read-only. A missing or
 * unreadable source yields none, so callers fall back to the NF project's own checkout.
 */
export const t3WorkspaceRoots = Effect.fn("T3Projects.workspaceRoots")(function* (file: string) {
  return yield* readSource(
    file,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const table =
        yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_projects'`;
      if (table.length === 0) return [];
      const rows = yield* sql`SELECT workspace_root, deleted_at FROM projection_projects`;
      return rows.flatMap((row) => {
        const decoded = decodeProjectRow(row);
        return Option.isSome(decoded) && decoded.value.deleted_at === null
          ? [decoded.value.workspace_root]
          : [];
      });
    }),
  ).pipe(Effect.orElseSucceed((): string[] => []));
});
