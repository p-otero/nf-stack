import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { NfError } from "@nf/contracts";
import { backfillAttemptCoordinatorsIn } from "./coordinators.persistence.ts";
import { LATEST_VERSION, MIGRATIONS } from "./migration-sql.ts";
import { assignProjectPrefixes } from "./project-prefix.persistence.ts";

export { LATEST_VERSION, MIGRATIONS };

const PREFIX_VERSION = 6;
const COORDINATOR_VERSION = 9;

/**
 * Split a migration into single statements: `node:sqlite` prepares one statement at a time.
 * A statement ends with `;` at the end of a line; the `;` inside a one-line trigger body
 * (`BEGIN SELECT RAISE(...); END;`) is mid-line and stays in its statement.
 */
export function migrationStatements(migration: string): string[] {
  return migration
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const UserVersionRow = Schema.Struct({ user_version: Schema.Finite });
const decodeUserVersion = Schema.decodeUnknownSync(UserVersionRow);

export const userVersion = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const row = (yield* sql`PRAGMA user_version`)[0];
  return row === undefined ? 0 : decodeUserVersion(row).user_version;
});

/** A store written by a newer nf: refuse it instead of reading or writing it. */
export const refuseNewerStore = (current: number) =>
  Effect.fail(
    new NfError({
      code: "store_too_new",
      message:
        `store schema v${current} is newer than this nf (v${LATEST_VERSION}); ` +
        `update nf with 'git pull && bun install' in its checkout`,
    }),
  );

/** Apply pending migrations, each in its own write transaction, tracked with `PRAGMA
 * user_version` exactly as earlier versions of nf did; a newer store is refused. Foreign keys are
 * off for the duration because SQLite cannot rebuild a referenced table (v5 rebuilds `attempts`)
 * under enforcement, so `foreign_key_check` runs before each commit instead. */
export const migrate = Effect.fn("Migrations.migrate")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const apply = Effect.gen(function* () {
    for (;;) {
      const current = yield* userVersion;
      if (current > LATEST_VERSION) return yield* refuseNewerStore(current);
      if (current === LATEST_VERSION) return current;
      const migration = MIGRATIONS[current];
      if (migration === undefined) {
        return yield* new NfError({
          code: "store_corrupt",
          message: `no migration brings the store from v${current} to v${current + 1}`,
        });
      }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          // Another process may have migrated while this one waited for the write lock.
          if ((yield* userVersion) === current) {
            for (const statement of migrationStatements(migration)) {
              yield* sql.unsafe(statement);
            }
            const orphans = yield* sql`PRAGMA foreign_key_check`;
            if (orphans.length > 0) {
              return yield* new NfError({
                code: "store_corrupt",
                message: `migration to v${current + 1} would leave foreign key violations`,
              });
            }
            // PRAGMA takes no bound parameters; `current + 1` is an integer we computed.
            yield* sql.unsafe(`PRAGMA user_version = ${current + 1}`);
            if (current + 1 === PREFIX_VERSION) yield* assignProjectPrefixes(sql);
            if (current + 1 === COORDINATOR_VERSION) yield* backfillAttemptCoordinatorsIn(sql);
          }
          return yield* Effect.void;
        }),
      );
    }
  });
  yield* sql`PRAGMA foreign_keys = OFF`;
  return yield* Effect.ensuring(apply, Effect.orDie(Effect.asVoid(sql`PRAGMA foreign_keys = ON`)));
});
