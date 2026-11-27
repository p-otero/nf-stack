import { COST_QUALITY, QUALITY } from "@nf/contracts";
import type { CostSummary, Quantity, TokenFields } from "@nf/contracts";
import type { PriceFile } from "../domain/prices.ts";
import { isAggregateSourceKey } from "../domain/usage.ts";
import type { StatsEventRow } from "../persistence/usage-queries.persistence.ts";

const TOKEN_COLUMNS: readonly (keyof TokenFields)[] = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
];

/** The input side of a token count: what the cache read saved is read against these. */
const INPUT_COLUMNS: readonly (keyof TokenFields)[] = [
  "input_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
];

const unknown = (): Quantity => ({ value: null, quality: QUALITY.UNKNOWN });

/** `CostSummary` in board terms: Pi's own charges are measured, LiteLLM prices estimated. */
function costQuantity(summary: CostSummary): Quantity {
  if (summary.value === null) return unknown();
  return summary.quality === COST_QUALITY.REPORTED
    ? { value: summary.value, quality: QUALITY.MEASURED, source: "pi" }
    : { value: summary.value, quality: QUALITY.ESTIMATED, source: "litellm" };
}

/** Sum of these token columns; `null` when no event knows one of them, never zero. */
function tokenValue(
  rows: readonly StatsEventRow[],
  columns: readonly (keyof TokenFields)[],
): number | null {
  let value: number | null = null;
  for (const row of rows) {
    if (isAggregateSourceKey(row.source_key)) continue;
    for (const key of columns) {
      const tokens = row[key];
      if (tokens !== null) value = (value ?? 0) + tokens;
    }
  }
  return value;
}

const measured = (value: number | null): Quantity =>
  value === null ? unknown() : { value, quality: QUALITY.MEASURED };

/**
 * Input, output, cache read and cache write of these events; subagent aggregates are unknown
 * prices and carry no cache split, so they stay out as they do in `nf stats` token columns.
 */
function tokenQuantity(rows: readonly StatsEventRow[]): Quantity {
  return measured(tokenValue(rows, TOKEN_COLUMNS));
}

/** Cache read over the input side: 0..1, `null` when no event reported input tokens. */
function cacheShare(rows: readonly StatsEventRow[]): number | null {
  const cached = tokenValue(rows, ["cache_read_tokens"]);
  const input = tokenValue(rows, INPUT_COLUMNS);
  if (cached === null || input === null || input <= 0) return null;
  return Number((cached / input).toFixed(12));
}

/** What the cached input of these events saved at the rates that priced them. */
function cacheSavings(
  rows: readonly StatsEventRow[],
  prices: PriceFile | undefined,
): { readonly value: Quantity; readonly unpricedEvents: number; readonly unpricedTokens: number } {
  let total = 0;
  let priced = false;
  let unpricedEvents = 0;
  let unpricedTokens = 0;
  for (const row of rows) {
    if (isAggregateSourceKey(row.source_key)) continue;
    const tokens = row.cache_read_tokens ?? 0;
    if (tokens <= 0) continue;
    const rates = row.model === null ? null : (prices?.rates(row.model) ?? null);
    if (rates === null || rates.input === null || rates.cache_read === null) {
      unpricedEvents++;
      unpricedTokens += tokens;
      continue;
    }
    total += (rates.input - rates.cache_read) * tokens;
    priced = true;
  }
  return {
    value: priced ? { value: Number(total.toFixed(12)), quality: QUALITY.DERIVED } : unknown(),
    unpricedEvents,
    unpricedTokens,
  };
}

/** Middle cost to acceptance of the accepted tasks: derived from prices, so `derived`. */
function medianQuantity(values: readonly number[]): Quantity {
  if (values.length === 0) return unknown();
  const sorted = [...values].toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  if (high === undefined) return unknown();
  const low = sorted[middle - 1] ?? high;
  const value = sorted.length % 2 === 1 ? high : (low + high) / 2;
  return { value: Number(value.toFixed(12)), quality: QUALITY.DERIVED };
}

/** Cost to acceptance per accepted task; `null` without a price or an accepted task. */
function perAccepted(cost: Quantity, accepted: number): Quantity {
  if (cost.value === null || accepted <= 0) return unknown();
  return { value: Number((cost.value / accepted).toFixed(12)), quality: QUALITY.DERIVED };
}

function share(part: Quantity, whole: Quantity): number | null {
  if (part.value === null || whole.value === null || whole.value <= 0) return null;
  return Number((part.value / whole.value).toFixed(12));
}

export {
  cacheSavings,
  cacheShare,
  costQuantity,
  medianQuantity,
  measured,
  perAccepted,
  share,
  tokenQuantity,
  tokenValue,
  unknown,
};
