import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { NfError } from "@nf/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { errorText } from "../domain/errors.ts";
import { BACKUP_KEEP_DEFAULT, backupsDir, utcStamp } from "../system/home.ts";

export interface BackupOptions {
  readonly now?: Date;
  readonly keep?: number;
}

/** `nf-<stamp>.db` from `nf backup`, `nf-pre-v<nf>-<stamp>.db` from a pending migration. */
const BACKUP_NAME = /^nf-(?:pre-v\d+-)?(\d{8}T\d{6}Z)(?:-(\d+))?\.db$/;

interface Backup {
  readonly name: string;
  readonly stamp: string;
}

function backupOrder(name: string): string | null {
  const match = BACKUP_NAME.exec(name);
  if (match === null) return null;
  return `${match[1]}-${(match[2] ?? "0").padStart(6, "0")}`;
}

/**
 * The names to delete so that `keep` backups remain, newest first by the stamp in the name.
 * `written` survives even when a clock skew puts an older backup ahead of it, and names that
 * are not backups are left alone. Within one second a plain copy is newer than the
 * pre-migration copy it followed.
 */
export function outdatedBackups(
  names: readonly string[],
  keep: number,
  written: string | null = null,
): string[] {
  const found: Backup[] = [];
  for (const name of names) {
    const stamp = backupOrder(name);
    if (stamp !== null) found.push({ name, stamp });
  }
  found.sort((a, b) => {
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
  return found
    .slice(Math.max(keep, 1))
    .map((backup) => backup.name)
    .filter((name) => name !== written);
}

function prune(dir: string, keep: number, written: string): void {
  for (const name of outdatedBackups(readdirSync(dir), keep, written)) {
    rmSync(join(dir, name), { force: true });
  }
}

function uniqueBackupPath(dir: string, base: string): string {
  mkdirSync(dir, { recursive: true });
  let target = join(dir, `${base}.db`);
  for (let n = 1; existsSync(target); n++) target = join(dir, `${base}-${n}.db`);
  return target;
}

/** Consistent copy of the live store (`VACUUM INTO`), never overwriting an existing backup. */
const snapshot = Effect.fn("Backup.snapshot")(function* (dir: string, base: string) {
  const sql = yield* SqlClient.SqlClient;
  const file = yield* Effect.try({
    try: () => uniqueBackupPath(dir, base),
    catch: (error) =>
      new NfError({
        code: "backup_failed",
        message: `cannot write a backup into ${dir}: ${errorText(error)}`,
      }),
  });
  yield* sql`VACUUM INTO ${file}`.pipe(
    Effect.mapError(
      (error) =>
        new NfError({
          code: "backup_failed",
          message: `cannot copy the store to ${file}: ${errorText(error)}`,
        }),
    ),
  );
  return file;
});

const keepNewest = (dir: string, keep: number, file: string) =>
  Effect.sync(() => prune(dir, keep, basename(file)));

/** Copy of the store as it is now, before `migrate` applies pending migrations. */
export const backupBeforeMigration = Effect.fn("Backup.backupBeforeMigration")(function* (
  home: string,
  fromVersion: number,
  keep: number,
) {
  const dir = backupsDir(home);
  const file = yield* snapshot(dir, `nf-pre-v${fromVersion}-${utcStamp()}`).pipe(
    Effect.mapError(
      (error) =>
        new NfError({
          code: "backup_failed",
          message: `${errorText(error)}; the store was not migrated`,
        }),
    ),
  );
  yield* keepNewest(dir, keep, file);
  return file;
});

/** Consistent snapshot of the live store to `<home>/backups/nf-<UTC stamp>.db` (VACUUM INTO). */
export const backupStore = Effect.fn("Backup.backupStore")(function* (
  home: string,
  options: BackupOptions = {},
) {
  const dir = backupsDir(home);
  const keep = options.keep ?? BACKUP_KEEP_DEFAULT;
  const file = yield* snapshot(dir, `nf-${utcStamp(options.now ?? new Date())}`);
  yield* keepNewest(dir, keep, file);
  return file;
});
