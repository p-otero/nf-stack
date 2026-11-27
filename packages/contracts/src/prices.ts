import * as Schema from "effect/Schema";

/** Where an estimated cost's rates came from. Pi's own charge is `reported`, not a price source. */
export const PRICE_SOURCE = {
  LITELLM: "litellm",
  OPENROUTER: "openrouter",
  MANUAL: "manual",
} as const;
export type PriceSource = (typeof PRICE_SOURCE)[keyof typeof PRICE_SOURCE];
export const PRICE_SOURCES: readonly PriceSource[] = Object.values(PRICE_SOURCE);
export const PriceSource = Schema.Literals(Object.values(PRICE_SOURCE));

/** A price layer in lookup order, with the date of the data behind it (`null` for overrides). */
export const PriceSourceStatus = Schema.Struct({
  source: PriceSource,
  date: Schema.NullOr(Schema.String),
});
export type PriceSourceStatus = typeof PriceSourceStatus.Type;

/** A manual override in `policy.yaml`, in USD per million tokens. */
export const ManualPrice = Schema.Struct({
  input_per_m: Schema.Finite,
  output_per_m: Schema.Finite,
});
export type ManualPrice = typeof ManualPrice.Type;

/** `policy.yaml`'s `prices`, keyed by `<provider>/<model>` or by the model id alone. */
export const PolicyPrices = Schema.Record(Schema.String, ManualPrice);
export type PolicyPrices = typeof PolicyPrices.Type;
