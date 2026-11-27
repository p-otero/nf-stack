import { PolicyOptions } from "@nf/contracts";
import type { Catalog, CatalogModel, PolicyCandidate, ProfilePolicy } from "@nf/contracts";
import { findModel, findOption, findProvider } from "../domain/policy.ts";
import type { ModelRates, PriceFile } from "../domain/prices.ts";
import { matchTrait } from "./model-traits.ts";
import type { ModelTrait, ModelTraits, TraitFit } from "./model-traits.ts";

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rank of an existing route the traits table cannot rank for a profile: sorted last. */
export const UNRANKED = Number.MAX_SAFE_INTEGER;

const UNKNOWN_PRICE = "price unknown";

const perMillion = (rate: number): string => Number((rate * 1_000_000).toFixed(4)).toString();

export interface Price {
  /** `$10/$50 per M (litellm)`, or `price unknown` when no layer has a complete rate. */
  text: string;
  /** Input plus output USD per million tokens; infinite when unpriced. */
  score: number;
  rates: ModelRates | null;
}

export function priceDetails(prices: PriceFile, model: string): Price {
  const rates = prices.rates(model);
  if (!rates || rates.input === null || rates.output === null)
    return { text: UNKNOWN_PRICE, score: Number.POSITIVE_INFINITY, rates: null };
  return {
    text: `$${perMillion(rates.input)}/$${perMillion(rates.output)} per M (${rates.source})`,
    score: rates.input + rates.output,
    rates,
  };
}

/** The profile's caps, as the refusal reasons print them. */
function capText(profile: ProfilePolicy): string | null {
  const caps = [
    profile.max_input_per_m === undefined ? null : `max input $${profile.max_input_per_m}/M`,
    profile.max_output_per_m === undefined ? null : `max output $${profile.max_output_per_m}/M`,
  ].filter((cap): cap is string => cap !== null);
  return caps.length === 0 ? null : caps.join(", ");
}

/**
 * Why a priced model breaks the profile's caps, or null when it fits. A model without a complete
 * price is never over a cap; `priceRuleReason` covers that case.
 */
export function overCapReason(profile: ProfilePolicy, rates: ModelRates | null): string | null {
  if (!rates || rates.input === null || rates.output === null) return null;
  const overInput =
    profile.max_input_per_m !== undefined && rates.input * 1_000_000 > profile.max_input_per_m;
  const overOutput =
    profile.max_output_per_m !== undefined && rates.output * 1_000_000 > profile.max_output_per_m;
  if (!overInput && !overOutput) return null;
  const caps = [
    overInput ? `max input $${profile.max_input_per_m ?? 0}/M` : null,
    overOutput ? `max output $${profile.max_output_per_m ?? 0}/M` : null,
  ].filter((cap): cap is string => cap !== null);
  return `over cap > ${caps.join(", ")}`;
}

const UNPRICED_REASON = "price unknown > capped profile needs a models allow-list";

/**
 * Why the profile's price rules refuse a route, or null when they allow it. Without caps the
 * price never decides; with caps a model must be priced within them, or explicitly allowed.
 */
export function priceRuleReason(
  profile: ProfilePolicy,
  price: Price,
  model: string,
): string | null {
  if (price.rates !== null) return overCapReason(profile, price.rates);
  if (capText(profile) === null) return null;
  return profile.models?.includes(model) === true ? null : UNPRICED_REASON;
}

export interface Route {
  provider: string;
  model: string;
  catalogModel: CatalogModel;
  trait: ModelTrait | null;
}

/** Routes a catalog can delegate to: an enabled provider instance that runs child tasks. */
export function childRoutes(catalog: Catalog, traits: ModelTraits): Route[] {
  const routes: Route[] = [];
  for (const provider of catalog.providers) {
    if (provider.disabled || !provider.can_run_child_task) continue;
    for (const model of provider.models)
      routes.push({
        provider: provider.provider_instance_id,
        model: model.id,
        catalogModel: model,
        trait: matchTrait(traits, model.id),
      });
  }
  return routes;
}

export interface CandidateOptions {
  options?: PolicyOptions;
  max_options?: PolicyOptions;
}

/** Keep only the trait's option values the catalog model still accepts. */
export function acceptedOptions(model: CatalogModel, fit: TraitFit): CandidateOptions {
  const keep = (wanted: PolicyOptions | undefined): PolicyOptions | undefined => {
    if (!wanted) return undefined;
    const kept: (readonly [string, string | boolean | number])[] = [];
    for (const [id, value] of Object.entries(wanted)) {
      const option = findOption(model, id);
      if (option && option.values.some((accepted) => accepted === value)) kept.push([id, value]);
    }
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
  };
  const options = keep(fit.options);
  const max = keep(fit.max);
  return {
    ...(options === undefined ? {} : { options }),
    ...(max === undefined ? {} : { max_options: max }),
  };
}

export function fitText(input: {
  profile: string;
  trait: ModelTrait | null;
  fit: TraitFit | null;
  price: string;
}): string {
  if (!input.trait) return `unclassified in model traits · ${input.price}`;
  if (!input.fit) return `no ${input.profile} rank in model traits · ${input.price}`;
  return `rank ${input.fit.rank} · ${input.trait.family} · ${input.price}`;
}

/** Whether the environment's catalog has no provider instance with this id. */
export function providerAbsent(catalog: Catalog, providerId: string): boolean {
  return findProvider(catalog, providerId) === null;
}

/** A policy route the catalog no longer offers (a disabled provider, or the model removed). */
export function catalogGap(catalog: Catalog, candidate: PolicyCandidate): boolean {
  const provider = findProvider(catalog, candidate.provider);
  if (!provider || provider.disabled || !provider.can_run_child_task) return true;
  return findModel(provider, candidate.model) === null;
}

export interface Ranked {
  candidate: PolicyCandidate;
  rank: number;
  price: number;
  family: string;
}

export const byPreference = (a: Ranked, b: Ranked): number =>
  a.rank - b.rank ||
  a.price - b.price ||
  compareText(a.family, b.family) ||
  compareText(a.candidate.provider, b.candidate.provider) ||
  compareText(a.candidate.model, b.candidate.model);
