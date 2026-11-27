import { homedir } from "node:os";
import { join } from "node:path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `$NF_HOME`, default `~/.nf`. */
export function nfHome(env: Record<string, string | undefined> = process.env): string {
  const v = env["NF_HOME"];
  return v && v.length > 0 ? v : join(homedir(), ".nf");
}

export function dbPath(home: string): string {
  return join(home, "nf.db");
}

/** `$NF_HOME/backups`: the `nf backup` snapshots and the copies taken before a migration. */
export function backupsDir(home: string): string {
  return join(home, "backups");
}

/** How many backups `<home>/backups` keeps unless `$NF_BACKUP_KEEP` says otherwise. */
export const BACKUP_KEEP_DEFAULT = 10;

const BackupKeep = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const decodeBackupKeep = Schema.decodeUnknownOption(BackupKeep);

/** `$NF_BACKUP_KEEP`, default `BACKUP_KEEP_DEFAULT`; a value that is not a positive integer
 * keeps the default rather than failing every command that opens the store. */
export function backupKeep(env: Record<string, string | undefined> = process.env): number {
  const raw = env["NF_BACKUP_KEEP"];
  if (raw === undefined) return BACKUP_KEEP_DEFAULT;
  return Option.getOrElse(decodeBackupKeep(raw), () => BACKUP_KEEP_DEFAULT);
}

/** `$NF_T3_STATE`, default `~/.t3/userdata/statev2.sqlite` (read-only; never written). */
export function t3StatePath(env: Record<string, string | undefined> = process.env): string {
  const v = env["NF_T3_STATE"];
  return v && v.length > 0 ? v : join(homedir(), ".t3", "userdata", "statev2.sqlite");
}

/** `$NF_PRICES`, default T3's cached LiteLLM rates (read-only; never written). */
export function pricesPath(env: Record<string, string | undefined> = process.env): string {
  const v = env["NF_PRICES"];
  return v && v.length > 0 ? v : join(homedir(), ".t3", "userdata", "usage-model-rates.json");
}

export function utcNow(): string {
  return new Date().toISOString();
}

/** Compact UTC stamp for file names, e.g. 20261115T213500Z. */
export function utcStamp(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}
