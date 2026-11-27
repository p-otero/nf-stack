import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { CatalogProvider, NfError, RouteBlock } from "@nf/contracts";
import type { Catalog as CatalogType, RouteBlock as RouteBlockType } from "@nf/contracts";
import { fromJson, toJson } from "../domain/validate.ts";

const decodeProviders = Schema.decodeUnknownOption(Schema.Array(CatalogProvider));

const corruptCatalog = (environmentId: string) =>
  new NfError({
    code: "corrupt_store",
    message: `catalog snapshot for '${environmentId}' is not readable; check again with 'nf policy check'`,
  });

/** The cached catalog of one environment, or null when it was never checked. */
export const loadCatalog = Effect.fn("PolicyStore.loadCatalog")(function* (environmentId: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    environment_id: string;
    checked_at: string;
    providers: string;
  }>`SELECT environment_id, checked_at, providers FROM catalog_snapshots
    WHERE environment_id = ${environmentId}`;
  const row = rows[0];
  if (!row) return null;
  const providers = Option.getOrUndefined(decodeProviders(fromJson(row.providers)));
  if (!providers) return yield* corruptCatalog(environmentId);
  return {
    environment_id: row.environment_id,
    checked_at: row.checked_at,
    providers,
  };
});

export const loadCatalogs = Effect.fn("PolicyStore.loadCatalogs")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    environment_id: string;
    checked_at: string;
    providers: string;
  }>`SELECT environment_id, checked_at, providers FROM catalog_snapshots ORDER BY environment_id`;
  const catalogs: CatalogType[] = [];
  for (const row of rows) {
    const providers = Option.getOrUndefined(decodeProviders(fromJson(row.providers)));
    if (!providers) return yield* corruptCatalog(row.environment_id);
    catalogs.push({
      environment_id: row.environment_id,
      checked_at: row.checked_at,
      providers,
    });
  }
  return catalogs;
});

/** Replace the environment's snapshot with the merged catalog. */
export const saveCatalog = Effect.fn("PolicyStore.saveCatalog")(function* (input: {
  machine: string;
  catalog: CatalogType;
  createdAt: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const { machine, catalog, createdAt } = input;
  const providers = toJson(catalog.providers);
  yield* sql`INSERT INTO catalog_snapshots ${sql.insert({
    environment_id: catalog.environment_id,
    machine_id: machine,
    checked_at: catalog.checked_at,
    providers: providers ?? "[]",
    created_at: createdAt,
    updated_at: createdAt,
  })} ON CONFLICT (environment_id) DO UPDATE SET
    checked_at = excluded.checked_at,
    providers = excluded.providers,
    updated_at = excluded.updated_at`;
});

/** Block a route, replacing the block of an earlier blocking period for the same route. */
export const upsertRouteBlock = Effect.fn("PolicyStore.upsertRouteBlock")(function* (input: {
  id: string;
  machine: string;
  block: RouteBlockType;
  at: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const { id, machine, block, at } = input;
  yield* sql`INSERT INTO route_blocks ${sql.insert({
    id,
    machine_id: machine,
    provider_instance_id: block.provider_instance_id,
    model: block.model,
    reason: block.reason,
    reset_at: block.reset_at,
    evidence: block.evidence,
    blocked_at: block.blocked_at,
    updated_at: at,
  })} ON CONFLICT (provider_instance_id, model) DO UPDATE SET
    reason = excluded.reason,
    reset_at = excluded.reset_at,
    evidence = excluded.evidence,
    blocked_at = excluded.blocked_at,
    updated_at = excluded.updated_at`;
});

export const listRouteBlocks = Effect.fn("PolicyStore.listRouteBlocks")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<RouteBlockType>`SELECT provider_instance_id, model, reason, reset_at,
      evidence, blocked_at FROM route_blocks ORDER BY provider_instance_id, model`;
  return rows.map((row) => RouteBlock.make(row));
});

export const removeRouteBlock = Effect.fn("PolicyStore.removeRouteBlock")(function* (
  provider: string | null,
  model: string | null,
) {
  const sql = yield* SqlClient.SqlClient;
  const removed = (yield* listRouteBlocks()).filter(
    (b) =>
      (provider === null || b.provider_instance_id === provider) &&
      (model === null || b.model === model),
  );
  if (provider !== null && model !== null) {
    yield* sql`DELETE FROM route_blocks
      WHERE provider_instance_id = ${provider} AND model = ${model}`;
  } else {
    yield* sql`DELETE FROM route_blocks`;
  }
  return removed;
});
