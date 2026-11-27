import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  NfError,
  PRICE_SOURCE,
  estimateCost,
  loadModelTraits,
  loadPrices,
  matchTrait,
  openRouterCachePath,
  parseOpenRouterModels,
  priceDetails,
  readOpenRouterCache,
  writeOpenRouterCache,
} from "../src/index.ts";
import type { OpenRouterCatalog, PolicyPrices } from "../src/index.ts";
import { EMPTY_TRAITS, cleanupAll, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const FIXTURES = join(import.meta.dir, "fixtures");
const MODELS = readFileSync(join(FIXTURES, "openrouter-models.json"), "utf8");
const AT = new Date("2026-11-16T10:00:00.000Z");

function catalog(): OpenRouterCatalog {
  return Effect.runSync(parseOpenRouterModels(MODELS, new Date("2026-11-15T08:00:00.000Z")));
}

function cacheHome(fetchedAt: string | null = null): string {
  const home = tempDir("nf-prices-");
  if (fetchedAt !== null)
    writeOpenRouterCache(openRouterCachePath(home), { ...catalog(), fetched_at: fetchedAt });
  return home;
}

/** A LiteLLM file with rates for the given model ids, as T3 caches it. */
function litellmFile(home: string, rates: Record<string, [number, number]>): string {
  const file = join(home, "usage-model-rates.json");
  const document = Object.fromEntries(
    Object.entries(rates).map(([id, [input, output]]) => [
      id,
      { input_cost_per_token: input, output_cost_per_token: output },
    ]),
  );
  writeFileSync(file, JSON.stringify({ fetchedAtMs: 1767225600000, document }));
  return file;
}

const traits = Effect.runSync(loadModelTraits());

function prices(input: {
  home: string;
  litellm?: Record<string, [number, number]>;
  manual?: PolicyPrices;
  offline?: boolean;
  fetchCatalog?: (now: Date) => Effect.Effect<OpenRouterCatalog, NfError>;
  now?: Date;
}) {
  return Effect.runPromise(
    loadPrices({
      home: input.home,
      litellmFile: litellmFile(input.home, input.litellm ?? {}),
      manual: input.manual ?? {},
      traits,
      now: input.now ?? AT,
      offline: input.offline ?? true,
      ...(input.fetchCatalog === undefined ? {} : { fetchCatalog: input.fetchCatalog }),
    }),
  );
}

describe("the model traits mapping", () => {
  test("names the OpenRouter id of every family the public catalog carries", () => {
    expect(matchTrait(traits, "opencode-go/deepseek-v4.1-flash")?.openrouter).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    expect(matchTrait(traits, "opencode-go/glm-5.3-flash")?.openrouter).toBe("z-ai/glm-5.3-flash");
    expect(matchTrait(traits, "zai/glm-5.3")?.openrouter).toBe("z-ai/glm-5.3");
    expect(matchTrait(traits, "claude-fable-5-2")?.openrouter).toBe("anthropic/claude-fable-5.2");
    expect(matchTrait(traits, "gpt-6-astra")?.openrouter).toBe("openai/gpt-6-astra");
  });
});

describe("the OpenRouter catalog", () => {
  test("reads the documented prompt and completion prices per token, never a batch variant", () => {
    const parsed = catalog();
    expect(parsed.models["deepseek/deepseek-v4.1-flash"]).toEqual({
      input: 1.4e-7,
      output: 4.2e-7,
    });
    expect(parsed.models["z-ai/glm-5.3"]).toEqual({ input: 6.99e-8, output: 1.4e-6 });
    expect(Object.keys(parsed.models).some((id) => id.endsWith(":batch"))).toBe(false);
    expect(parsed.fetched_at).toBe("2026-11-15T08:00:00.000Z");
  });

  test("a payload that is not the models JSON is a rejection", async () => {
    const error = await Effect.runPromise(Effect.flip(parseOpenRouterModels("{}", AT)));
    expect(error.code).toBe("bad_price_catalog");
  });
});

describe("the price chain", () => {
  test("LiteLLM first, then OpenRouter, then the policy overrides, each with its source", async () => {
    const home = cacheHome("2026-11-15T08:00:00.000Z");
    const file = await prices({
      home,
      litellm: {
        "opencode-go/deepseek-v4.1-flash": [1e-6, 2e-6],
        "gpt-6.1-sol": [2e-6, 1e-5],
      },
      manual: {
        "zai/glm-5.3": { input_per_m: 0.5, output_per_m: 1.5 },
        "pi/acme/local-model": { input_per_m: 3, output_per_m: 4 },
      },
    });

    expect(file.rates("opencode-go/deepseek-v4.1-flash")).toMatchObject({
      input: 1e-6,
      output: 2e-6,
      source: PRICE_SOURCE.LITELLM,
    });
    expect(file.rates("openai-codex/gpt-6.1-sol")).toMatchObject({
      source: PRICE_SOURCE.LITELLM,
    });
    expect(file.rates("opencode-go/glm-5.3-flash")).toMatchObject({
      input: 3.99e-8,
      output: 7.84e-8,
      source: PRICE_SOURCE.OPENROUTER,
    });
    expect(file.rates("zai/glm-5.3")?.source).toBe(PRICE_SOURCE.OPENROUTER);
    expect(file.rates("pi/acme/local-model")).toMatchObject({
      input: 3e-6,
      output: 4e-6,
      source: PRICE_SOURCE.MANUAL,
    });
    expect(file.rates("acme/unknown-model")).toBeNull();
    expect(file.sources).toEqual([
      { source: PRICE_SOURCE.LITELLM, date: "2026-01-01" },
      { source: PRICE_SOURCE.OPENROUTER, date: "2026-11-15" },
      { source: PRICE_SOURCE.MANUAL, date: null },
    ]);
    expect(priceDetails(file, "opencode-go/glm-5.3-flash").text).toBe(
      "$0.0399/$0.0784 per M (openrouter)",
    );
    expect(
      estimateCost(file, "opencode-go/glm-5.3-flash", {
        input_tokens: 1_000_000,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        reasoning_tokens: null,
      }),
    ).toMatchObject({ cost_quality: "unknown", price_source: null });

    expect(
      estimateCost(file, "opencode-go/glm-5.3-flash", {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: null,
        cache_write_tokens: null,
        reasoning_tokens: null,
      }),
    ).toMatchObject({ cost_quality: "estimated", price_source: "openrouter" });
  });

  test("a model without an OpenRouter id in the traits table stays unpriced", async () => {
    const home = cacheHome("2026-11-15T08:00:00.000Z");
    const file = await Effect.runPromise(
      loadPrices({
        home,
        litellmFile: litellmFile(home, {}),
        manual: {},
        traits: EMPTY_TRAITS,
        now: AT,
        offline: true,
      }),
    );
    expect(file.rates("opencode-go/glm-5.3-flash")).toBeNull();
  });
});

describe("the OpenRouter cache", () => {
  test("is fetched when missing, kept for a week and refreshed when older", async () => {
    const home = cacheHome();
    let fetches = 0;
    const fetchCatalog = () =>
      Effect.sync(() => {
        fetches++;
        return { ...catalog(), fetched_at: AT.toISOString() };
      });

    const fetched = await prices({ home, fetchCatalog, offline: false });
    expect(fetches).toBe(1);
    expect(fetched.rates("opencode-go/deepseek-v4.1-flash")?.source).toBe(PRICE_SOURCE.OPENROUTER);
    const cached = Effect.runSync(readOpenRouterCache(openRouterCachePath(home)));
    expect(cached === null ? null : cached.fetched_at).toBe(AT.toISOString());

    await prices({ home, fetchCatalog, offline: false, now: new Date("2026-11-20T00:00:00.000Z") });
    expect(fetches).toBe(1);

    await prices({ home, fetchCatalog, offline: false, now: new Date("2026-11-24T00:00:00.000Z") });
    expect(fetches).toBe(2);
  });

  test("offline reads the cache, and says so when there is none", async () => {
    const cached = await prices({ home: cacheHome("2026-01-01T00:00:00.000Z") });
    expect(cached.rates("zai/glm-5.3")?.source).toBe(PRICE_SOURCE.OPENROUTER);
    expect(cached.warnings).toEqual([]);

    const missing = await prices({ home: cacheHome() });
    expect(missing.rates("zai/glm-5.3")).toBeNull();
    expect(missing.warnings[0]).toContain("NF_OFFLINE");
    expect(missing.sources.map((entry) => entry.source)).toEqual([PRICE_SOURCE.LITELLM]);
  });

  test("a failed refresh keeps the stale cache and warns instead of failing", async () => {
    const home = cacheHome("2026-01-01T00:00:00.000Z");
    let fetches = 0;
    const file = await prices({
      home,
      offline: false,
      fetchCatalog: () =>
        Effect.sync(() => {
          fetches++;
        }).pipe(
          Effect.flatMap(() =>
            Effect.fail(new NfError({ code: "price_catalog_unavailable", message: "HTTP 503" })),
          ),
        ),
    });
    expect(fetches).toBe(1);
    expect(file.rates("zai/glm-5.3")?.source).toBe(PRICE_SOURCE.OPENROUTER);
    expect(file.warnings).toEqual(["openrouter prices stale (2026-01-01T00:00:00.000Z): HTTP 503"]);
  });

  test("an unreadable LiteLLM file only warns: the other layers still price", async () => {
    const home = cacheHome("2026-11-15T08:00:00.000Z");
    const file = await Effect.runPromise(
      loadPrices({
        home,
        litellmFile: join(home, "nope.json"),
        manual: {},
        traits,
        now: AT,
        offline: true,
      }),
    );
    expect(file.date).toBeNull();
    expect(file.warnings).toEqual([`price file not readable: ${join(home, "nope.json")}`]);
    expect(file.rates("zai/glm-5.3")?.source).toBe(PRICE_SOURCE.OPENROUTER);
  });
});
