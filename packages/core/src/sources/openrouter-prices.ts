import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { NfError } from "@nf/contracts";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** A week keeps the public catalog current without polling it on every command. */
export const OPENROUTER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** USD per token, as OpenRouter's `pricing.prompt` and `pricing.completion` report them. */
export const OpenRouterRates = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
});
export type OpenRouterRates = typeof OpenRouterRates.Type;

/** The cache in `$NF_HOME`: when it was fetched, and the rates of every listed model id. */
export const OpenRouterCatalog = Schema.Struct({
  fetched_at: Schema.String,
  models: Schema.Record(Schema.String, OpenRouterRates),
});
export type OpenRouterCatalog = typeof OpenRouterCatalog.Type;

const OpenRouterResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      pricing: Schema.Struct({
        prompt: Schema.FiniteFromString,
        completion: Schema.FiniteFromString,
      }),
    }),
  ),
});

/** OpenRouter serves batch variants of the same model at a discount; they are never priced here. */
const isBatchVariant = (id: string): boolean => id.includes(":batch");

const decodeResponse = Schema.decodeUnknownResult(Schema.fromJsonString(OpenRouterResponse));
const decodeCache = Schema.decodeUnknownOption(Schema.fromJsonString(OpenRouterCatalog));

export function openRouterCachePath(home: string): string {
  return join(home, "openrouter-models.json");
}

const invalidCatalog = (source: string, detail: string) =>
  new NfError({ code: "bad_price_catalog", message: `${source}: ${detail}` });

/** Turn the API body into the cache document; every unusable model entry is dropped. */
export const parseOpenRouterModels = Effect.fn("OpenRouter.parseModels")(function* (
  text: string,
  fetchedAt: Date,
) {
  const decoded = decodeResponse(text);
  if (Result.isFailure(decoded))
    return yield* invalidCatalog(OPENROUTER_MODELS_URL, "not the models JSON nf expects");
  const models: Record<string, OpenRouterRates> = {};
  for (const model of decoded.success.data) {
    if (isBatchVariant(model.id)) continue;
    if (!(Number.isFinite(model.pricing.prompt) && Number.isFinite(model.pricing.completion)))
      continue;
    models[model.id] = { input: model.pricing.prompt, output: model.pricing.completion };
  }
  return { fetched_at: fetchedAt.toISOString(), models };
});

/** The cached catalog, or null when the file is missing or unreadable. */
export const readOpenRouterCache = (file: string): Effect.Effect<OpenRouterCatalog | null> =>
  Effect.sync(() => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return null;
    }
    const decoded = decodeCache(text);
    return Option.isNone(decoded) ? null : decoded.value;
  });

export const writeOpenRouterCache = (file: string, catalog: OpenRouterCatalog): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(catalog)}\n`);
  renameSync(temp, file);
};

const refreshFailed = (detail: string) =>
  new NfError({ code: "price_catalog_unavailable", message: `OpenRouter catalog: ${detail}` });

/** `GET /api/v1/models`: public, unauthenticated, and carrying nothing about this machine. */
export const fetchOpenRouterModels = (fetchedAt: Date): Effect.Effect<OpenRouterCatalog, NfError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    },
    catch: (error) => refreshFailed(error instanceof Error ? error.message : String(error)),
  }).pipe(Effect.flatMap((text) => parseOpenRouterModels(text, fetchedAt)));

export const catalogIsFresh = (catalog: OpenRouterCatalog, nowMs: number): boolean => {
  const fetched = Date.parse(catalog.fetched_at);
  return Number.isFinite(fetched) && nowMs - fetched < OPENROUTER_MAX_AGE_MS;
};

export interface OpenRouterOptions {
  file: string;
  now: Date;
  /** `NF_OFFLINE`: never touch the network, use the cache or go without prices. */
  offline: boolean;
  fetchCatalog?: (now: Date) => Effect.Effect<OpenRouterCatalog, NfError>;
}

export interface OpenRouterLoad {
  catalog: OpenRouterCatalog | null;
  warnings: readonly string[];
}

/** The cached catalog, refreshed when it is missing or older than a week and this is online. */
export const loadOpenRouterCatalog = Effect.fn("OpenRouter.load")(function* (
  options: OpenRouterOptions,
) {
  const cached = yield* readOpenRouterCache(options.file);
  if (cached !== null && catalogIsFresh(cached, options.now.getTime()))
    return { catalog: cached, warnings: [] } satisfies OpenRouterLoad;
  if (options.offline)
    return {
      catalog: cached,
      warnings:
        cached === null
          ? [`openrouter prices unavailable: ${options.file} not cached and NF_OFFLINE is set`]
          : [],
    } satisfies OpenRouterLoad;
  const fetched = yield* Effect.result(
    (options.fetchCatalog ?? fetchOpenRouterModels)(options.now),
  );
  if (Result.isSuccess(fetched)) {
    yield* Effect.sync(() => writeOpenRouterCache(options.file, fetched.success));
    return { catalog: fetched.success, warnings: [] } satisfies OpenRouterLoad;
  }
  return {
    catalog: cached,
    warnings: [
      cached === null
        ? `openrouter prices unavailable: ${fetched.failure.message}`
        : `openrouter prices stale (${cached.fetched_at}): ${fetched.failure.message}`,
    ],
  } satisfies OpenRouterLoad;
});
