import * as Effect from "effect/Effect";
import { loadModelTraits, loadPolicyPrices, loadPrices, pricesPath } from "@nf/core";
import type { PolicyPrices } from "@nf/core";

/** `NF_OFFLINE` keeps the price chain on the cache; set, any value means offline. */
const isOffline = (env: Record<string, string | undefined>): boolean =>
  (env["NF_OFFLINE"] ?? "").length > 0;

const priceChain = Effect.fn("cli.priceChain")(function* (
  home: string,
  env: Record<string, string | undefined>,
  offline: boolean,
) {
  const traits = yield* loadModelTraits();
  // An invalid policy.yaml is reported by the policy commands themselves; syncing usage does not
  // depend on it, so it only costs the manual overrides here.
  const manual = yield* Effect.orElseSucceed(loadPolicyPrices(home), (): PolicyPrices => ({}));
  return yield* loadPrices({
    home,
    litellmFile: pricesPath(env),
    manual,
    traits,
    now: new Date(),
    offline,
  });
});

/** The machine's price chain: LiteLLM, then OpenRouter's public catalog, then policy overrides. */
export const loadCliPrices = Effect.fn("cli.loadPrices")(function* (
  home: string,
  env: Record<string, string | undefined>,
) {
  return yield* priceChain(home, env, isOffline(env));
});

/**
 * The chain a board reads: cached rates only, because `nf board` and `nf serve` show what the
 * store already holds and never refresh a cache.
 */
export const loadBoardPrices = Effect.fn("cli.loadBoardPrices")(function* (
  home: string,
  env: Record<string, string | undefined>,
) {
  return yield* priceChain(home, env, true);
});
