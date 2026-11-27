import { existsSync } from "node:fs";
import { SqliteClient } from "@effect/sql-sqlite-node";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import { NfError } from "@nf/contracts";
import { isRecord } from "../domain/validate.ts";

const BUSY_RETRIES = 3;

/** SQLITE_BUSY that outlived the busy timeout: another process holds the write lock. */
export function isBusy(error: unknown): boolean {
  return (
    isRecord(error) &&
    error["_tag"] === "SqlError" &&
    isRecord(error["reason"]) &&
    error["reason"]["_tag"] === "LockTimeoutError"
  );
}

/**
 * Read a live application database read-only inside one short snapshot. The source is
 * opened with a read-only client scoped to this read (closed on exit), never written,
 * copied or checkpointed; a busy writer is retried with backoff instead.
 */
export const readSource = Effect.fn("ReadSource.read")(function* <A, E>(
  file: string,
  program: Effect.Effect<A, E, SqlClient.SqlClient>,
) {
  if (!existsSync(file)) {
    return yield* new NfError({
      code: "source_missing",
      message: `source database not found: ${file}`,
    });
  }
  const snapshot = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA query_only = ON`;
    return yield* sql.withTransaction(program);
  }).pipe(
    // A read-only client scoped to this read: opened here, closed when the snapshot ends.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    Effect.provide(SqliteClient.layer({ filename: file, readonly: true })),
  );
  return yield* snapshot.pipe(
    Effect.retry({
      schedule: Schedule.exponential("100 millis"),
      times: BUSY_RETRIES,
      while: isBusy,
    }),
  );
});
