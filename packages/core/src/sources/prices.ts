import { readFileSync, statSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { NfError, PRICE_SOURCE } from "@nf/contracts";
import type { PolicyPrices, PriceSource, PriceSourceStatus } from "@nf/contracts";
import { money, obj } from "../domain/usage.ts";
import type { Obj } from "../domain/usage.ts";
import { priceKeys } from "../domain/prices.ts";
import type { ModelRates, PriceFile, PricedRates } from "../domain/prices.ts";
import { matchTrait } from "../policy/model-traits.ts";
import type { ModelTraits } from "../policy/model-traits.ts";
import { loadOpenRouterCatalog, openRouterCachePath } from "./openrouter-prices.ts";
import type { OpenRouterCatalog } from "./openrouter-prices.ts";

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeFetchedAt = Schema.decodeUnknownOption(Schema.Finite);

function readRates(raw: unknown): ModelRates | null {
  const o = obj(raw);
  if (!o) return null;
  const rates: ModelRates = {
    input: money(o["input_cost_per_token"]),
    output: money(o["output_cost_per_token"]),
    cache_read: money(o["cache_read_input_token_cost"]),
    cache_write: money(o["cache_creation_input_token_cost"]),
  };
  return rates.input === null && rates.output === null ? null : rates;
}

interface LitellmLayer {
  date: string | null;
  error: string | null;
  rates(model: string): ModelRates | null;
}

const unavailable = (error: string): LitellmLayer => ({ date: null, error, rates: () => null });

/** Load T3's cached LiteLLM rates. A missing or unreadable file only disables that layer. */
export const loadLitellmRates = (file: string): Effect.Effect<LitellmLayer> =>
  Effect.sync(() => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return unavailable(`price file not readable: ${file}`);
    }
    const parsed = decodeJson(text);
    if (Option.isNone(parsed)) return unavailable(`price file is not valid JSON: ${file}`);
    let table: Obj | null = null;
    let date: string | null = null;
    // A JSON array is accepted as a (useless) table, as before; only objects carry rates.
    const root = obj(parsed.value) ?? (Array.isArray(parsed.value) ? {} : null);
    if (root) {
      table = obj(root["document"]) ?? root;
      const fetched = decodeFetchedAt(root["fetchedAtMs"]);
      if (Option.isSome(fetched)) date = new Date(fetched.value).toISOString().slice(0, 10);
    }
    if (date === null) {
      try {
        date = statSync(file).mtime.toISOString().slice(0, 10);
      } catch {
        date = null;
      }
    }
    return {
      date,
      error: null,
      rates(model: string): ModelRates | null {
        if (!table) return null;
        for (const key of priceKeys(model)) {
          const found = readRates(table[key]);
          if (found) return found;
        }
        return null;
      },
    };
  });

/** A layer only answers a price when both the input and the output rate are known. */
const isComplete = (rates: ModelRates | null): rates is ModelRates =>
  rates !== null && rates.input !== null && rates.output !== null;

const priced = (rates: ModelRates, source: PriceSource): PricedRates => ({ ...rates, source });

/** Manual overrides in `policy.yaml`, in USD per million, indexed by every model id they name. */
function manualIndex(manual: PolicyPrices): Map<string, ModelRates> {
  const index = new Map<string, ModelRates>();
  for (const key of Object.keys(manual).toSorted()) {
    const entry = manual[key];
    if (!entry) continue;
    const rates: ModelRates = {
      input: entry.input_per_m / 1_000_000,
      output: entry.output_per_m / 1_000_000,
      cache_read: null,
      cache_write: null,
    };
    for (const alias of priceKeys(key)) if (!index.has(alias)) index.set(alias, rates);
  }
  return index;
}

const catalogDate = (catalog: OpenRouterCatalog): string | null =>
  catalog.fetched_at.slice(0, 10) || null;

/** OpenRouter rates for a catalog model id, through the traits entry's `openrouter` id. */
function openRouterRates(
  catalog: OpenRouterCatalog,
  traits: ModelTraits,
  model: string,
): ModelRates | null {
  const id = matchTrait(traits, model)?.openrouter;
  if (id === undefined) return null;
  const rates = catalog.models[id];
  return rates === undefined ? null : { ...rates, cache_read: null, cache_write: null };
}

export interface PricesInput {
  /** `$NF_HOME`, where the OpenRouter catalog is cached. */
  home: string;
  /** T3's cached LiteLLM rates. */
  litellmFile: string;
  /** `policy.yaml`'s `prices` map. */
  manual: PolicyPrices;
  /** The traits table's `openrouter` ids map model ids to the public catalog. */
  traits: ModelTraits;
  now: Date;
  /** `NF_OFFLINE`: read the cache, never the network. */
  offline: boolean;
  fetchCatalog?: (now: Date) => Effect.Effect<OpenRouterCatalog, NfError>;
}

/**
 * The price chain every cost and cap goes through: LiteLLM, then OpenRouter's public catalog,
 * then the manual overrides in `policy.yaml`. Each answer carries the layer it came from.
 */
export const loadPrices = Effect.fn("Prices.load")(function* (input: PricesInput) {
  const litellm = yield* loadLitellmRates(input.litellmFile);
  const openrouter = yield* loadOpenRouterCatalog({
    file: openRouterCachePath(input.home),
    now: input.now,
    offline: input.offline,
    ...(input.fetchCatalog === undefined ? {} : { fetchCatalog: input.fetchCatalog }),
  });
  const manual = manualIndex(input.manual);
  const sources: PriceSourceStatus[] = [];
  if (litellm.error === null) sources.push({ source: PRICE_SOURCE.LITELLM, date: litellm.date });
  if (openrouter.catalog !== null)
    sources.push({ source: PRICE_SOURCE.OPENROUTER, date: catalogDate(openrouter.catalog) });
  if (manual.size > 0) sources.push({ source: PRICE_SOURCE.MANUAL, date: null });
  const warnings = [...(litellm.error === null ? [] : [litellm.error]), ...openrouter.warnings];
  const rates = (model: string): PricedRates | null => {
    const fromLitellm = litellm.rates(model);
    if (isComplete(fromLitellm)) return priced(fromLitellm, PRICE_SOURCE.LITELLM);
    const fromOpenRouter =
      openrouter.catalog === null ? null : openRouterRates(openrouter.catalog, input.traits, model);
    if (isComplete(fromOpenRouter)) return priced(fromOpenRouter, PRICE_SOURCE.OPENROUTER);
    for (const key of priceKeys(model)) {
      const override = manual.get(key);
      if (override) return priced(override, PRICE_SOURCE.MANUAL);
    }
    return null;
  };
  return { date: litellm.date, warnings, sources, rates } satisfies PriceFile;
});
