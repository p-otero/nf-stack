import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { machineId } from "../domain/ids.ts";
import { BACKUP_KEEP_DEFAULT, dbPath } from "../system/home.ts";
import * as SqliteLayer from "./sqlite-layer.ts";
import * as TaskStore from "./task-store.persistence.ts";

export interface StoreLayerOptions {
  /** Backups kept in `<home>/backups`, including the one a pending migration writes. */
  readonly backupKeep?: number;
  /** Receives the line naming a pre-migration backup; silent by default. */
  readonly notice?: (text: string) => void;
}

/**
 * The store of one `NF_HOME`: `TaskStore` over the migrated SQLite database `<home>/nf.db`,
 * with the machine id from `<home>/machine-id`. Also provides `SqlClient` for the import,
 * usage and backup modules.
 */
export const storeLayer = (home: string, options: StoreLayerOptions = {}) =>
  Layer.unwrap(Effect.sync(() => TaskStore.layer({ machine: machineId(home) }))).pipe(
    Layer.provideMerge(
      SqliteLayer.layer(dbPath(home), {
        home,
        keep: options.backupKeep ?? BACKUP_KEEP_DEFAULT,
        notice: options.notice ?? (() => {}),
      }),
    ),
  );
