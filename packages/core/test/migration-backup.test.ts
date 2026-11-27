import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  LATEST_VERSION,
  MIGRATIONS,
  NfError,
  backupStore,
  migrationStatements,
  outdatedBackups,
} from "../src/index.ts";
import { cleanupAll, fixture, openStore, rejection, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const FIXTURES = join(import.meta.dir, "fixtures");

/** A copy of the recorded v2 store with the migrations after v2 applied up to `version`. */
function storeAt(home: string, version: number): string {
  const file = join(home, "nf.db");
  copyFileSync(join(FIXTURES, "nf-v2.db"), file);
  copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  try {
    for (const migration of MIGRATIONS.slice(2, version)) {
      for (const statement of migrationStatements(migration)) db.exec(statement);
    }
    db.exec(`PRAGMA user_version = ${version}`);
  } finally {
    db.close();
  }
  return file;
}

function userVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
  } finally {
    db.close();
  }
}

function backups(home: string): string[] {
  return readdirSync(join(home, "backups")).toSorted();
}

function columns(file: string, table: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

describe("backups before a migration", () => {
  test("the copy holds the schema the store had before the migration ran", async () => {
    const home = tempDir("nf-migrate-home-");
    storeAt(home, 6);
    const noticed: string[] = [];
    const opened = await openStore(home, { notice: (text) => noticed.push(text) });
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({
        user_version: LATEST_VERSION,
      });
    } finally {
      await opened.close();
    }
    expect(backups(home)).toHaveLength(1);
    const [name] = backups(home);
    expect(name).toMatch(/^nf-pre-v6-\d{8}T\d{6}Z\.db$/);
    expect(noticed).toHaveLength(1);
    expect(noticed[0]).toContain("store schema v6");
    expect(noticed[0]).toContain(`migrating to v${LATEST_VERSION}`);
    expect(noticed[0]).toContain(join(home, "backups", name as string));
    // v9 adds the coordinator columns: the copy predates them, so it was taken first.
    expect(userVersion(join(home, "backups", name as string))).toBe(6);
    expect(columns(join(home, "backups", name as string), "attempts")).not.toContain(
      "coordinator_model",
    );
    expect(columns(join(home, "nf.db"), "attempts")).toContain("coordinator_model");
  });

  test("a fresh store is migrated without a backup", async () => {
    const home = tempDir("nf-fresh-home-");
    const noticed: string[] = [];
    const opened = await openStore(home, { notice: (text) => noticed.push(text) });
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({
        user_version: LATEST_VERSION,
      });
    } finally {
      await opened.close();
    }
    expect(noticed).toEqual([]);
    expect(existsSync(join(home, "backups"))).toBe(false);
  });

  test("a store that cannot be backed up is not migrated", async () => {
    const home = tempDir("nf-nobackup-home-");
    const file = storeAt(home, 6);
    writeFileSync(join(home, "backups"), "a file where the backups directory belongs");
    const error = await rejection(openStore(home));
    expect(error).toBeInstanceOf(NfError);
    expect((error as NfError).code).toBe("backup_failed");
    expect(error.message).toContain(join(home, "backups"));
    expect(error.message).toContain("not migrated");
    expect(userVersion(file)).toBe(6);
  });

  test("a store from a newer nf is refused without reading or writing it", async () => {
    const home = tempDir("nf-newer-home-");
    const file = storeAt(home, 6);
    const raw = new DatabaseSync(file, { enableForeignKeyConstraints: false });
    try {
      raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    } finally {
      raw.close();
    }
    const untouched = readFileSync(file);
    const error = await rejection(openStore(home));
    expect(error).toBeInstanceOf(NfError);
    expect((error as NfError).code).toBe("store_too_new");
    expect(error.message).toContain(`v${LATEST_VERSION + 1}`);
    expect(error.message).toContain(`v${LATEST_VERSION}`);
    expect(error.message).toContain("git pull && bun install");
    expect(readFileSync(file).equals(untouched)).toBe(true);
    // no connection was opened: no journal, no WAL, no backup
    expect(readdirSync(home).toSorted()).toEqual(["machine-id", "nf.db"]);
  });
});

describe("pruning backups", () => {
  test("names are ordered by the stamp, whichever naming scheme wrote them", () => {
    const names = [
      "nf-20260101T000000Z.db",
      "nf-pre-v3-20260102T000000Z.db",
      "nf-20260103T000000Z-1.db",
      "nf-20260103T000000Z.db",
      "restore.db",
    ];
    expect(outdatedBackups(names, 3)).toEqual(["nf-20260101T000000Z.db"]);
    // a clock skew must not drop the copy that was just written
    expect(outdatedBackups(names, 1, "nf-20260101T000000Z.db")).toEqual([
      "nf-20260103T000000Z.db",
      "nf-pre-v3-20260102T000000Z.db",
    ]);
  });

  test("nf backup keeps the newest backups", async () => {
    const f = await fixture();
    const keep = 3;
    for (let hour = 1; hour <= 5; hour++) {
      await f.run(backupStore(f.home, { now: new Date(`2026-11-15T0${hour}:00:00Z`), keep }));
    }
    expect(backups(f.home)).toEqual([
      "nf-20261115T030000Z.db",
      "nf-20261115T040000Z.db",
      "nf-20261115T050000Z.db",
    ]);
  });

  test("the pre-migration copy counts toward the kept backups", async () => {
    const home = tempDir("nf-prune-home-");
    storeAt(home, 6);
    const opened = await openStore(home, { backupKeep: 2 });
    try {
      expect(backups(home)).toHaveLength(1);
      expect(backups(home)[0]).toMatch(/^nf-pre-v6-/);
      const later = new Date(Date.now() + 3_600_000);
      for (const minutes of [0, 60]) {
        await opened.run(
          backupStore(home, { now: new Date(later.getTime() + minutes * 60_000), keep: 2 }),
        );
      }
    } finally {
      await opened.close();
    }
    const kept = backups(home);
    expect(kept).toHaveLength(2);
    expect(kept.some((name) => name.startsWith("nf-pre-v6-"))).toBe(false);
  });

  test("files that are not backups are never pruned", async () => {
    const f = await fixture();
    mkdirSync(join(f.home, "backups"), { recursive: true });
    writeFileSync(join(f.home, "backups", "restore-me.db"), "");
    for (let hour = 1; hour <= 3; hour++) {
      await f.run(backupStore(f.home, { now: new Date(`2026-11-15T0${hour}:00:00Z`), keep: 1 }));
    }
    expect(backups(f.home)).toEqual(["nf-20261115T030000Z.db", "restore-me.db"]);
  });
});
