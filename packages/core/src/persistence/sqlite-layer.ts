import { closeSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { backupBeforeMigration } from "./backup.persistence.ts";
import { LATEST_VERSION, migrate, refuseNewerStore, userVersion } from "./migrations.ts";

/** Where a store puts the copy it takes before applying pending migrations. */
export interface MigrationBackupOptions {
  readonly home: string;
  readonly keep: number;
  /** Receives one line naming the copy; the CLI writes it to stderr. */
  readonly notice: (text: string) => void;
}

const SQLITE_MAGIC = "SQLite format 3\u0000";
const HEADER_BYTES = 64;
/** `user_version` sits at offset 60 of the database header (SQLite file format). */
const USER_VERSION_OFFSET = 60;

function readHeader(filename: string): Buffer | null {
  const fd = openSync(filename, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    return readSync(fd, header, 0, HEADER_BYTES, 0) < HEADER_BYTES ? null : header;
  } finally {
    closeSync(fd);
  }
}

/**
 * The version in the header of `filename`, read without SQLite so that a store from a newer nf
 * is refused before any connection can journal, checkpoint or switch it to WAL; null when the
 * file is missing or not a database. A version still in the write-ahead log reads as the older
 * header value and is caught by `userVersion` once the store is open.
 */
function storedVersion(filename: string): number | null {
  if (filename === ":memory:") return null;
  let header: Buffer | null;
  try {
    header = readHeader(filename);
  } catch {
    return null;
  }
  if (header === null || header.toString("latin1", 0, 16) !== SQLITE_MAGIC) return null;
  return header.readUInt32BE(USER_VERSION_OFFSET);
}

const migratedStore = (backup: MigrationBackupOptions) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const version = yield* userVersion;
      if (version > LATEST_VERSION) return yield* refuseNewerStore(version);
      if (version > 0 && version < LATEST_VERSION) {
        const file = yield* backupBeforeMigration(backup.home, version, backup.keep);
        yield* Effect.sync(() =>
          backup.notice(
            `nf: backed up store schema v${version} to ${file}; migrating to v${LATEST_VERSION}\n`,
          ),
        );
      }
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* sql`PRAGMA synchronous = NORMAL`;
      yield* migrate();
      return yield* Effect.void;
    }),
  );

/**
 * The NF store on SQLite: `@effect/sql-sqlite-node` (one serialized `node:sqlite` connection,
 * WAL, 5 s busy timeout, `BEGIN IMMEDIATE` transactions) plus the pragmas earlier nf versions
 * set, migrated to the latest schema. A Postgres store is another layer providing `SqlClient`.
 */
export const layer = (filename: string, backup: MigrationBackupOptions) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (filename !== ":memory:") {
        yield* Effect.sync(() => mkdirSync(dirname(filename), { recursive: true }));
      }
      const onDisk = storedVersion(filename);
      if (onDisk !== null && onDisk > LATEST_VERSION) return yield* refuseNewerStore(onDisk);
      return migratedStore(backup).pipe(Layer.provideMerge(SqliteClient.layer({ filename })));
    }),
  );
