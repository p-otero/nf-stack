import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  LATEST_VERSION,
  activeBlock,
  checkPolicy,
  decodeCapabilities,
  findModel,
  findProvider,
  isStale,
  listRouteBlocks,
  loadCatalog,
  loadCatalogs,
  loadPolicy,
  loadPolicyPrices,
  mergeCatalog,
  parsePolicy,
  policyStatus,
  relativeAge,
  removeRouteBlock,
  resolveCandidate,
  saveCatalog,
  ulid,
  upsertRouteBlock,
} from "../src/index.ts";
import type { PriceFile } from "../src/index.ts";
import { cleanupAll, fixture, openStore, pricesOf, rejection, tempDir } from "./helpers.ts";

afterEach(cleanupAll);

const FIXTURES = join(import.meta.dir, "fixtures");
const LOCAL = readFileSync(join(FIXTURES, "t3-capabilities-local.json"), "utf8");
const VPS = readFileSync(join(FIXTURES, "t3-capabilities-vps.json"), "utf8");
const SEARCH = readFileSync(join(FIXTURES, "t3-capabilities-search.json"), "utf8");

const POLICY = `version: 1
analysis_mode: review
profiles:
  bounded:
    - { provider: pi, model: opencode-go/deepseek-v4.1-flash, options: { thinking: max } }
    - { provider: pi, model: opencode-go/glm-5.3-flash, options: { thinking: max } }
    - { provider: pi, model: openai-codex/gpt-6-luna, options: { thinking: ultra } }
    - { provider: claudeAgent, model: claude-sonnet-5-5, options: { effort: high } }
  reasoning:
    - { provider: pi, model: openai-codex/gpt-6.1-sol, options: { thinking: medium } }
    - { provider: pi, model: phantom-model }
  lookup:
    - { provider: cursor, model: whatever }
disabled: [ "pi:opencode-go/glm-5.3-flash" ]
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }
`;

/** LiteLLM rates as the price file reports them: tokens cost, so `$10/$50` per million. */
const PRICES: PriceFile = pricesOf((model) => {
  if (model.includes("astra"))
    return { input: 1e-5, output: 5e-5, cache_read: null, cache_write: null };
  if (model.includes("luna"))
    return { input: 1e-7, output: 5e-7, cache_read: null, cache_write: null };
  if (model.includes("sonnet"))
    return { input: 2e-6, output: 1e-5, cache_read: null, cache_write: null };
  if (model.includes("terra"))
    return { input: 1e-6, output: 5e-6, cache_read: null, cache_write: null };
  return null;
}, "2026-06-01");

const CAPPED_POLICY = `version: 1
analysis_mode: review
profiles:
  reasoning:
    max_output_per_m: 4
    candidates:
      - { provider: pi, model: openai-codex/gpt-6.1-terra, options: { thinking: high } }
      - { provider: pi, model: openai-codex/gpt-6-luna, options: { thinking: medium } }
  frontier:
    requires_approval: true
    candidates:
      - { provider: claudeAgent, model: claude-sonnet-5-5, options: { effort: high } }
disabled: []
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }
`;

const AT = new Date("2026-06-01T10:00:00.000Z");

function withPolicy(home: string, text = POLICY): void {
  writeFileSync(join(home, "policy.yaml"), text);
}

/** The rejection of an Effect, for the policy validation cases. */
function failure<A, E extends { message: string }>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

async function checked(environment: string, text: string, now = AT, policy = POLICY) {
  const f = await fixture();
  withPolicy(f.home, policy);
  const result = await f.run(
    checkPolicy({
      home: f.home,
      machine: f.store.machine,
      environment,
      source: "test",
      text,
      now,
    }),
  );
  return { f, result };
}

function block(
  f: Awaited<ReturnType<typeof fixture>>,
  provider: string,
  model: string,
  resetAt: string | null,
  at = AT,
) {
  return f.run(
    upsertRouteBlock({
      id: ulid(),
      machine: f.store.machine,
      block: {
        provider_instance_id: provider,
        model,
        reason: "quota",
        reset_at: resetAt,
        evidence: "usage limit",
        blocked_at: at.toISOString(),
      },
      at: at.toISOString(),
    }),
  );
}

function resolve(
  f: Awaited<ReturnType<typeof fixture>>,
  profile: string,
  over: Partial<Parameters<typeof resolveCandidate>[0]> = {},
) {
  return f.run(
    resolveCandidate({
      home: f.home,
      profile,
      environment: "local",
      exclude: [],
      prices: PRICES,
      approved: false,
      now: AT,
      ...over,
    }),
  );
}

describe("policy validation", () => {
  test("accepts the policy shape of the template", async () => {
    const policy = await Effect.runPromise(parsePolicy(POLICY, "test policy"));
    expect(policy.analysis_mode).toBe("review");
    expect(Object.keys(policy.profiles)).toEqual(["bounded", "reasoning", "lookup"]);
    expect(policy.profiles.bounded?.candidates[0]).toEqual({
      provider: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: { thinking: "max" },
    });
  });

  test("reports one line per offending path", async () => {
    const text = POLICY.replace("version: 1", "version: 2").replace(
      "model: opencode-go/deepseek-v4.1-flash",
      "model: 7",
    );
    const error = await failure(parsePolicy(text, "test policy"));
    expect(error.message).toContain("invalid policy test policy:");
    expect(error.message).toContain("version: Expected 1");
    expect(error.message).toContain("profiles.bounded[0].model: Expected string");
  });

  test("rejects a disabled entry that is not provider:model", async () => {
    const error = await failure(
      parsePolicy(
        POLICY.replace('disabled: [ "pi:opencode-go/glm-5.3-flash" ]', 'disabled: [ "glm" ]'),
        "p",
      ),
    );
    expect(error.message).toContain("disabled[0]: expected provider:model, got 'glm'");
  });

  test("rejects a profile without candidates, a duplicate route and broken YAML", async () => {
    expect(
      (
        await failure(
          parsePolicy(
            POLICY.replace(
              "  lookup:\n    - { provider: cursor, model: whatever }\n",
              "  lookup: []\n",
            ),
            "p",
          ),
        )
      ).message,
    ).toContain("profiles.lookup: must list at least one candidate");
    expect(
      (
        await failure(
          parsePolicy(
            POLICY.replace(
              "    - { provider: pi, model: phantom-model }",
              "    - { provider: pi, model: openai-codex/gpt-6.1-sol }",
            ),
            "p",
          ),
        )
      ).message,
    ).toContain("profiles.reasoning[1]: duplicate route pi:openai-codex/gpt-6.1-sol");
    expect((await failure(parsePolicy("version: 1\n\tprofiles: x\n", "p"))).message).toContain(
      "yaml:",
    );
  });

  test("a missing policy file names the command that creates it", async () => {
    const home = tempDir("nf-policy-missing-");
    const error = await failure(loadPolicy(home));
    expect(error.message).toContain(join(home, "policy.yaml"));
    expect(error.message).toContain("nf policy propose --init");
  });
});

describe("catalog snapshot", () => {
  test("a second payload merges into the environment without dropping models or values", async () => {
    const { f, result } = await checked("local", LOCAL);
    expect(result.environments).toEqual(["local"]);
    expect(result.providers).toBe(5);
    expect(result.models).toBe(11);
    const before = await f.run(loadCatalog("local"));
    expect(before?.checked_at).toBe(AT.toISOString());
    const luna = await f
      .run(loadCatalog("local"))
      .then((c) => findModel(findProvider(c!, "pi")!, "openai-codex/gpt-6-luna")!);
    expect(luna.options[0]?.values).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    const later = new Date("2026-06-01T11:00:00.000Z");
    const merged = await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "local",
        source: "search",
        text: SEARCH,
        now: later,
      }),
    );
    expect(merged.models).toBe(12);
    const after = await f.run(loadCatalog("local"));
    expect(after?.checked_at).toBe(later.toISOString());
    const pi = findProvider(after!, "pi")!;
    expect(pi.models.map((m) => m.id)).toContain("opencode-go/deepseek-v4.1-flash");
    expect(pi.models.map((m) => m.id)).toContain("openai/gpt-6-astra");
    const updated = findModel(pi, "openai-codex/gpt-6-luna")!;
    expect(updated.options[0]?.values).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(updated.options[0]?.default).toBe("minimal");
  });

  test("environments keep separate snapshots", async () => {
    const { f } = await checked("local", LOCAL);
    await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "vps",
        source: "test",
        text: VPS,
        now: AT,
      }),
    );
    const catalogs = await f.run(loadCatalogs());
    expect(catalogs.map((c) => c.environment_id)).toEqual(["local", "vps"]);
    expect(findProvider(catalogs[0]!, "pi")!.models.length).toBe(6);
    expect(findProvider(catalogs[1]!, "pi")!.models.length).toBe(2);
  });

  test("missing everywhere versus only in another environment", async () => {
    const { f, result } = await checked("local", LOCAL);
    expect(result.drift.missing.map((r) => `${r.provider}:${r.model}`)).toEqual([
      "pi:openai-codex/gpt-6.1-sol",
      "pi:phantom-model",
      "cursor:whatever",
    ]);
    expect(result.drift.elsewhere).toEqual([]);

    const withVps = await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "vps",
        source: "test",
        text: VPS,
        now: AT,
      }),
    );
    expect(withVps.drift.missing.map((r) => `${r.provider}:${r.model}`)).toEqual([
      "pi:phantom-model",
      "cursor:whatever",
    ]);
    expect(withVps.drift.elsewhere.map((e) => `${e.route.provider}:${e.route.model}`)).toEqual([
      "pi:openai-codex/gpt-6.1-sol",
    ]);
    expect(withVps.drift.elsewhere[0]?.environments).toEqual(["vps"]);
  });

  test("the same environment replaces instance level state but keeps models", async () => {
    const { f } = await checked("local", LOCAL);
    const payload = JSON.stringify({
      providers: [
        {
          providerInstanceId: "pi",
          models: [{ id: "new/model" }],
          canRunChildTask: false,
          constraints: ["Provider instance is disabled."],
        },
      ],
    });
    const result = await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "local",
        source: "test",
        text: payload,
        now: AT,
      }),
    );
    expect(result.drift.missing.length).toBeGreaterThan(0);
    const catalog = await f.run(loadCatalog("local"));
    const pi = findProvider(catalog!, "pi")!;
    expect(pi.disabled).toBe(true);
    expect(pi.can_run_child_task).toBe(false);
    expect(findModel(pi, "opencode-go/deepseek-v4.1-flash")).not.toBeNull();
  });

  test("decoding rejects a payload that is not a capabilities result", async () => {
    expect((await failure(decodeCapabilities("{}", "stdin"))).message).toContain("providers");
    expect((await failure(decodeCapabilities("not json", "stdin"))).message).toContain(
      "not valid JSON",
    );
  });

  test("mergeCatalog keeps the previous environment out of a new one", () => {
    const merged = mergeCatalog(
      { environment_id: "local", checked_at: AT.toISOString(), providers: [] },
      "vps",
      [],
      AT.toISOString(),
    );
    expect(merged).toEqual({ environment_id: "vps", checked_at: AT.toISOString(), providers: [] });
  });
});

describe("resolve", () => {
  test("picks the first eligible candidate and builds the delegate target", async () => {
    const { f } = await checked("local", LOCAL);
    const result = await resolve(f, "bounded");
    expect(result.eligible).toEqual({
      provider: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: { thinking: "max" },
    });
    expect(result.target).toEqual({
      providerInstanceId: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: [{ id: "thinking", value: "max" }],
    });
    expect(result.verdicts.map((v) => v.eligible)).toEqual([true]);
  });

  test("skips a blocked route, a policy-disabled route and an invalid option in order", async () => {
    const { f } = await checked("local", LOCAL);
    await block(f, "pi", "opencode-go/deepseek-v4.1-flash", "2026-06-01T12:00:00.000Z");
    const result = await resolve(f, "bounded");
    expect(result.eligible?.provider).toBe("claudeAgent");
    expect(result.verdicts.map((v) => v.reason)).toEqual([
      "route blocked (quota, reset at 2026-06-01T12:00:00.000Z)",
      "disabled in policy",
      "option 'thinking' value \"ultra\" not accepted",
      null,
    ]);
  });

  test("a block whose reset passed no longer applies", async () => {
    const { f } = await checked("local", LOCAL);
    await block(f, "pi", "opencode-go/deepseek-v4.1-flash", "2026-05-31T00:00:00.000Z");
    const blocks = await f.run(listRouteBlocks());
    expect(activeBlock(blocks, "pi", "opencode-go/deepseek-v4.1-flash", AT.getTime())).toBeNull();
    const result = await resolve(f, "bounded");
    expect(result.eligible?.model).toBe("opencode-go/deepseek-v4.1-flash");
  });

  test("a block without reset stays until it is removed", async () => {
    const { f } = await checked("local", LOCAL);
    await block(f, "pi", "opencode-go/deepseek-v4.1-flash", null);
    expect((await resolve(f, "bounded")).eligible?.model).toBe("claude-sonnet-5-5");
    await f.run(removeRouteBlock("pi", "opencode-go/deepseek-v4.1-flash"));
    expect((await resolve(f, "bounded")).eligible?.model).toBe("opencode-go/deepseek-v4.1-flash");
  });

  test("--exclude and a disabled provider are reported per candidate", async () => {
    const { f } = await checked("local", LOCAL);
    const excluded = await resolve(f, "bounded", {
      exclude: ["pi:opencode-go/deepseek-v4.1-flash"],
    });
    expect(excluded.eligible?.model).toBe("claude-sonnet-5-5");
    expect(excluded.verdicts[0]?.reason).toBe("excluded by --exclude");

    const lookup = await resolve(f, "lookup");
    expect(lookup.eligible).toBeNull();
    expect(lookup.verdicts.map((v) => v.reason)).toEqual([
      "provider 'cursor' disabled in local catalog",
    ]);
  });

  test("an unknown profile, a bad exclude and an unchecked environment fail", async () => {
    const { f } = await checked("local", LOCAL);
    expect((await rejection(resolve(f, "nope"))).message).toContain(
      "profile 'nope' is not in the policy",
    );
    expect((await rejection(resolve(f, "bounded", { exclude: ["nope"] }))).message).toContain(
      "--exclude takes provider:model",
    );
    expect((await rejection(resolve(f, "bounded", { environment: "vps" }))).message).toContain(
      "no cached catalog for 'vps'",
    );
  });

  test("skips a candidate over the profile's price cap with its price", async () => {
    const { f } = await checked("local", LOCAL, AT, CAPPED_POLICY);
    const reasoning = await resolve(f, "reasoning");
    expect(reasoning.eligible?.model).toBe("openai-codex/gpt-6-luna");
    expect(reasoning.verdicts[0]?.reason).toBe(
      "over cap > max output $4/M · $1/$5 per M (litellm)",
    );
  });

  test("a profile with requires_approval refuses until the user approves it", async () => {
    const { f } = await checked("local", LOCAL, AT, CAPPED_POLICY);
    expect((await rejection(resolve(f, "frontier"))).message).toContain(
      "profile 'frontier' needs the user's approval",
    );
    const approved = await resolve(f, "frontier", { approved: true });
    expect(approved.eligible?.model).toBe("claude-sonnet-5-5");
  });

  test("a routing target on a linked environment carries its environmentId", async () => {
    const { f } = await checked("local", LOCAL);
    await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "vps",
        source: "test",
        text: VPS,
        now: AT,
      }),
    );
    const result = await resolve(f, "reasoning", { environment: "vps" });
    expect(result.eligible?.model).toBe("openai-codex/gpt-6.1-sol");
    expect(result.target?.environmentId).toBe("vps");
  });
});

describe("status and freshness", () => {
  test("never checked, fresh and stale", async () => {
    const { f } = await checked("local", LOCAL);
    const fresh = await f.run(
      policyStatus({ home: f.home, now: new Date("2026-06-01T13:00:00.000Z") }),
    );
    expect(fresh.state).toBe("ok");
    expect(fresh.age_ms).toBe(3 * 60 * 60 * 1000);
    expect(relativeAge(fresh.age_ms!)).toBe("3h ago");
    expect(fresh.drift.missing.map((r) => r.model)).toEqual([
      "openai-codex/gpt-6.1-sol",
      "phantom-model",
      "whatever",
    ]);

    const stale = await f.run(
      policyStatus({ home: f.home, now: new Date("2026-06-02T11:00:00.000Z") }),
    );
    expect(stale.state).toBe("stale");
    expect(isStale(AT.toISOString(), Date.parse("2026-06-02T10:00:00.000Z"))).toBe(false);
    expect(isStale(AT.toISOString(), Date.parse("2026-06-02T10:00:00.001Z"))).toBe(true);
    expect(isStale("not a date", Date.now())).toBe(true);

    const fresh2 = await fixture();
    withPolicy(fresh2.home);
    const never = await fresh2.run(policyStatus({ home: fresh2.home, now: AT }));
    expect(never.state).toBe("never");
    expect(never.checked_at).toBeNull();
    expect(never.age_ms).toBeNull();
  });

  test("only the local environment makes the status fresh", async () => {
    const f = await fixture();
    withPolicy(f.home);
    await f.run(
      checkPolicy({
        home: f.home,
        machine: f.store.machine,
        environment: "vps",
        source: "test",
        text: VPS,
        now: AT,
      }),
    );
    const status = await f.run(policyStatus({ home: f.home, now: AT }));
    expect(status.state).toBe("never");
    expect(status.environments).toEqual(["vps"]);
    expect(status.drift.elsewhere.map((e) => e.route.model)).toEqual(["openai-codex/gpt-6.1-sol"]);
  });

  test("relativeAge keeps the compact shapes the skills branch on", () => {
    expect(relativeAge(30_000)).toBe("just now");
    expect(relativeAge(42 * 60_000)).toBe("42m ago");
    expect(relativeAge(3 * 3_600_000)).toBe("3h ago");
    expect(relativeAge(49 * 3_600_000)).toBe("2d ago");
  });
});

function v2Home(): string {
  const home = tempDir("nf-policy-v2-");
  copyFileSync(join(FIXTURES, "nf-v2.db"), join(home, "nf.db"));
  copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));
  return home;
}

describe("migration v3", () => {
  test("a v2 store gains the catalog and route tables without losing data", async () => {
    const home = v2Home();
    const opened = await openStore(home);
    try {
      expect((await opened.sql("PRAGMA user_version"))[0]).toEqual({
        user_version: LATEST_VERSION,
      });
      expect(LATEST_VERSION).toBe(10);
      const tables = (
        await opened.sql<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
      ).map((r) => r.name);
      expect(tables).toContain("catalog_snapshots");
      expect(tables).toContain("route_blocks");
      const project = await opened.store.resolveProject("demo");
      expect((await opened.store.listTasks({ projectId: project.id })).length).toBe(5);

      const checkedAt = AT.toISOString();
      await opened.run(
        saveCatalog({
          machine: opened.store.machine,
          catalog: { environment_id: "local", checked_at: checkedAt, providers: [] },
          createdAt: checkedAt,
        }),
      );
      expect((await opened.run(loadCatalog("local")))?.checked_at).toBe(checkedAt);
      await opened.run(
        upsertRouteBlock({
          id: ulid(),
          machine: opened.store.machine,
          block: {
            provider_instance_id: "pi",
            model: "x",
            reason: "auth",
            reset_at: null,
            evidence: null,
            blocked_at: checkedAt,
          },
          at: checkedAt,
        }),
      );
      expect((await opened.run(listRouteBlocks())).length).toBe(1);
      writeFileSync(join(home, "policy.yaml"), POLICY);
      const resolved = await opened.run(
        resolveCandidate({
          home,
          profile: "bounded",
          environment: "local",
          exclude: [],
          prices: PRICES,
          approved: false,
          now: AT,
        }),
      );
      expect(resolved.verdicts.every((v) => !v.eligible)).toBe(true);
    } finally {
      await opened.close();
    }
  });
});

describe("manual prices", () => {
  const WITH_PRICES = POLICY.replace(
    `disabled: [ "pi:opencode-go/glm-5.3-flash" ]`,
    `disabled: []
prices:
  "pi/phantom-model": { input_per_m: 3, output_per_m: 4 }`,
  );

  test("come from the policy file, keyed by provider and model", async () => {
    const home = tempDir("nf-policy-prices-");
    expect(await Effect.runPromise(loadPolicyPrices(home))).toEqual({});

    writeFileSync(join(home, "policy.yaml"), WITH_PRICES);
    const policy = await Effect.runPromise(loadPolicy(home));
    expect(policy.prices).toEqual({
      "pi/phantom-model": { input_per_m: 3, output_per_m: 4 },
    });
    expect(await Effect.runPromise(loadPolicyPrices(home))).toEqual(policy.prices ?? {});
  });

  test("an override without both rates is a policy error with its path", async () => {
    const home = tempDir("nf-policy-prices-");
    writeFileSync(
      join(home, "policy.yaml"),
      WITH_PRICES.replace("input_per_m: 3, output_per_m: 4", "input_per_m: 3"),
    );
    const error = await failure(loadPolicy(home));
    expect(error.message).toContain("prices.pi/phantom-model.output_per_m: Missing key");
  });
});
