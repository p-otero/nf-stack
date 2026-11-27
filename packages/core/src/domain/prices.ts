import { COST_QUALITY } from "@nf/contracts";
import type { CostQuality, PriceSource, PriceSourceStatus, TokenFields } from "@nf/contracts";

export interface ModelRates {
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
}

/** Rates with the layer that produced them, so every price can say where it came from. */
export interface PricedRates extends ModelRates {
  source: PriceSource;
}

export interface PriceFile {
  /** UTC date of the LiteLLM rates (`fetchedAtMs`), else the file modification date. */
  date: string | null;
  /** Conditions that only cost accuracy: an unreadable rate file, a failed OpenRouter refresh. */
  warnings: readonly string[];
  /** Price layers that can answer here, in lookup order. */
  sources: readonly PriceSourceStatus[];
  /** Look up the API-equivalent rates for a provider model id. */
  rates(model: string): PricedRates | null;
}

export interface CostEstimate {
  cost_usd: number | null;
  cost_quality: CostQuality;
  price_source: string | null;
  price_date: string | null;
}

/** Candidate keys, in T3's lookup order: lowercase, a `[...]` suffix dropped, then prefix-stripped and full. */
export function priceKeys(model: string): string[] {
  const id = model
    .trim()
    .toLowerCase()
    .replace(/\s*\[[^\]]*\]\s*$/, "");
  if (id.length === 0) return [];
  const slash = id.indexOf("/");
  return slash > 0 ? [id.slice(slash + 1), id] : [id];
}

export function unknownCost(): CostEstimate {
  return {
    cost_usd: null,
    cost_quality: COST_QUALITY.UNKNOWN,
    price_source: null,
    price_date: null,
  };
}

/** Layers in lookup order, deduplicated, as the CLI and sync print them. */
export function priceSourceText(sources: readonly PriceSourceStatus[]): string {
  return sources
    .map((entry) => (entry.date === null ? entry.source : `${entry.source} ${entry.date}`))
    .join(" · ");
}

/** API-equivalent cost: each token class at its own rate (input + cache read + cache write +
 * output). Reasoning is already inside output, and a cache component is charged only when both
 * its token count and rate are known. */
export function estimateCost(
  prices: PriceFile,
  model: string | null,
  tokens: TokenFields,
): CostEstimate {
  if (model === null) return unknownCost();
  const rates = prices.rates(model);
  if (!rates || rates.input === null || rates.output === null) return unknownCost();
  if (tokens.input_tokens === null || tokens.output_tokens === null) return unknownCost();
  let total = tokens.input_tokens * rates.input + tokens.output_tokens * rates.output;
  const extras: [number | null, number | null][] = [
    [tokens.cache_read_tokens, rates.cache_read],
    [tokens.cache_write_tokens, rates.cache_write],
  ];
  for (const [count, r] of extras) {
    if (count === null) continue;
    if (count > 0 && r === null) return unknownCost();
    total += count * (r ?? 0);
  }
  return {
    cost_usd: Number(total.toFixed(12)),
    cost_quality: COST_QUALITY.ESTIMATED,
    price_source: rates.source,
    price_date: prices.sources.find((entry) => entry.source === rates.source)?.date ?? null,
  };
}
