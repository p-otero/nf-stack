import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  applyPolicy,
  initPolicy,
  loadModelTraits,
  matchTrait,
  parsePolicy,
  proposePolicy,
  proposalFile,
  ulid,
  upsertRouteBlock,
} from "../src/index.ts";
import type { PolicyProposal, PriceFile, ProposalProfile } from "../src/index.ts";
import { cleanupAll, fixture, pricesOf, rejection } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

afterEach(cleanupAll);

const FIXTURES = join(import.meta.dir, "fixtures");
const LOCAL = readFileSync(join(FIXTURES, "t3-capabilities-local.json"), "utf8");
const FRONTIER = readFileSync(join(FIXTURES, "t3-capabilities-frontier.json"), "utf8");
const UNKNOWN = readFileSync(join(FIXTURES, "t3-capabilities-unknown.json"), "utf8");
const TEMPLATE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "skills",
  "nf-meta",
  "references",
  "policy.example.yaml",
);

const AT = new Date("2026-11-16T10:00:00.000Z");
const AT_STAMP = "20261116T100000Z";

/** LiteLLM rates as the price file reports them: tokens cost, so `$2/$10` per million. */
const PRICES: PriceFile = pricesOf((model) => {
  if (model.includes("astra"))
    return { input: 1e-5, output: 5e-5, cache_read: null, cache_write: null };
  if (model.includes("fable"))
    return { input: 8e-6, output: 4e-5, cache_read: null, cache_write: null };
  if (model.includes("opus"))
    return { input: 4e-6, output: 2e-5, cache_read: null, cache_write: null };
  if (model.includes("sol"))
    return { input: 2e-6, output: 1e-5, cache_read: null, cache_write: null };
  if (model.includes("sonnet"))
    return { input: 2e-6, output: 1e-5, cache_read: null, cache_write: null };
  if (model.includes("terra"))
    return { input: 1e-6, output: 5e-6, cache_read: null, cache_write: null };
  if (model.includes("zai/glm"))
    return { input: 1.4e-6, output: 4.4e-6, cache_read: null, cache_write: null };
  if (model.includes("luna") || model.includes("haiku"))
    return { input: 1e-7, output: 5e-7, cache_read: null, cache_write: null };
  return null;
}, "2026-11-15");

const POLICY = `# machine policy: hand-edited, so comments and unknown keys must survive apply
version: 1
analysis_mode: review

profiles:
  bounded:                     # cheap first
    - { provider: pi, model: opencode-go/deepseek-v4.1-flash, options: { thinking: max } }
    - { provider: pi, model: retired/model-x }
  review:
    - { provider: pi, model: openai-codex/gpt-6.1-terra, options: { thinking: high }, pinned: true }
    - { provider: pi, model: openai/gpt-6.1-sol, options: { thinking: medium } }
  house:
    - { provider: pi, model: openai/gpt-6.1-sol }

disabled: []
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }

notes: hand-written, not part of the schema
`;

const CAPPED_POLICY = `version: 1
analysis_mode: review
profiles:
  reasoning:
    max_output_per_m: 20
    candidates:
      - { provider: pi, model: openai-codex/gpt-6.1-sol, options: { thinking: medium } }
      - { provider: pi, model: openai-codex/gpt-6-astra, options: { thinking: high } }
  bounded:
    max_output_per_m: 5
    candidates:
      - { provider: pi, model: opencode-go/deepseek-v4.1-flash, options: { thinking: max } }
disabled: []
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }
`;

function withPolicy(f: Fixture, text = POLICY): void {
  writeFileSync(join(f.home, "policy.yaml"), text);
}

function propose(
  f: Fixture,
  options: { text?: string; catalog?: string; now?: Date; reorder?: boolean } = {},
): Promise<{ file: string; proposal: PolicyProposal }> {
  if (options.text !== undefined) withPolicy(f, options.text);
  return f.run(
    proposePolicy({
      home: f.home,
      machine: f.store.machine,
      environment: "local",
      source: "test catalog",
      text: options.catalog ?? LOCAL,
      prices: PRICES,
      now: options.now ?? AT,
      reorder: options.reorder ?? false,
    }),
  );
}

function apply(f: Fixture, options: { text?: string; now?: Date } = {}) {
  const text = options.text ?? readFileSync(proposalFile(f.home), "utf8");
  return f.run(
    applyPolicy({
      home: f.home,
      template: TEMPLATE,
      text,
      source: "test proposal",
      now: options.now ?? AT,
    }),
  );
}

const profileOf = (proposal: PolicyProposal, name: string): ProposalProfile | undefined =>
  proposal.profiles.find((profile) => profile.name === name);

const candidateOf = (profile: ProposalProfile | undefined, model: string) =>
  profile?.candidates.find((candidate) => candidate.model === model);

describe("model traits", () => {
  test("the shipped table validates and matches model families", async () => {
    const traits = await Effect.runPromise(loadModelTraits());
    expect(traits.version).toBe(1);
    expect(traits.profiles).toEqual(["bounded", "reasoning", "lookup", "review", "frontier"]);
    expect(matchTrait(traits, "openai-codex/gpt-6.1-sol")?.family).toBe("gpt-6.1-sol");
    expect(matchTrait(traits, "gpt-6-astra")?.family).toBe("gpt-6-astra");
    expect(matchTrait(traits, "acme/mystery-9")).toBeNull();
  });

  test("ranks the coordinator's choices and omits the profiles a model does not suit", async () => {
    const traits = await Effect.runPromise(loadModelTraits());
    const ranks = (model: string): Record<string, number> | undefined => {
      const profiles = matchTrait(traits, model)?.profiles ?? {};
      return Object.fromEntries(Object.entries(profiles).map(([name, fit]) => [name, fit.rank]));
    };

    expect(ranks("opencode-go/deepseek-v4.1-flash")).toEqual({ bounded: 1, lookup: 2, review: 6 });
    expect(ranks("opencode-go/glm-5.3-flash")).toEqual({ bounded: 2, lookup: 4 });
    expect(ranks("openai-codex/gpt-6-luna")).toEqual({ bounded: 3, lookup: 1 });
    expect(ranks("gpt-6-luna")).toEqual({ bounded: 3, lookup: 1 });
    expect(ranks("claude-haiku-5-5")).toEqual({ bounded: 4, lookup: 3 });
    expect(ranks("claude-sonnet-5-5")).toEqual({ bounded: 5, reasoning: 4, review: 4 });
    expect(ranks("openai-codex/gpt-6.1-sol")).toEqual({ reasoning: 1, review: 3 });
    expect(ranks("gpt-6.1-sol")).toEqual({ reasoning: 1, review: 3 });
    expect(ranks("zai/glm-5.3")).toEqual({ reasoning: 2, review: 1 });
    expect(ranks("openai-codex/gpt-6.1-terra")).toEqual({ reasoning: 3, review: 2 });
    expect(ranks("gpt-6.1-terra")).toEqual({ reasoning: 3, review: 2 });
    expect(ranks("claude-opus-5-5")).toEqual({ reasoning: 5 });
    expect(ranks("claude-fable-5-2")).toEqual({ frontier: 1 });
    expect(ranks("gpt-6-astra")).toEqual({ frontier: 2 });
    expect(ranks("openai-codex/gpt-6-astra")).toEqual({ frontier: 2 });
  });
});

describe("policy propose", () => {
  test("proposes every profile for a machine with no policy file, deterministically", async () => {
    const f = await fixture();
    const first = await propose(f);
    const { proposal } = first;

    expect(existsSync(join(f.home, "policy.yaml"))).toBe(false);
    expect(proposal.policy_hash).toBeNull();
    // This catalog offers no frontier model, so that profile is not proposed at all.
    expect(proposal.profiles.map((profile) => profile.name)).toEqual([
      "bounded",
      "reasoning",
      "lookup",
      "review",
    ]);
    expect(profileOf(proposal, "frontier")).toBeUndefined();
    expect(proposal.summary.reorder).toBe(0);
    expect(proposal.over_cap).toEqual([]);
    expect(proposal.profiles.every((profile) => profile.action === "create")).toBe(true);
    expect(proposal.profiles[0]?.candidates[0]).toMatchObject({
      provider: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: { thinking: "max" },
      action: "add",
    });
    expect(proposal.profiles[0]?.candidates[0]?.reason).toContain("rank 1");
    const traits = await Effect.runPromise(loadModelTraits());
    expect(proposal.profiles.every((profile) => profile.candidates.length <= traits.limit)).toBe(
      true,
    );
    expect(proposal.unclassified).toEqual([]);
    expect(proposal.disabled_add).toEqual([]);
    expect(JSON.parse(readFileSync(first.file, "utf8"))).toEqual(proposal);

    const second = await propose(f);
    expect(JSON.stringify(second.proposal)).toBe(JSON.stringify(proposal));
  });

  test("reports a model the catalog dropped and marks it disabled", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY });

    const bounded = profileOf(proposal, "bounded");
    expect(bounded?.action).toBe("update");
    expect(candidateOf(bounded, "retired/model-x")).toEqual({
      provider: "pi",
      model: "retired/model-x",
      action: "unavailable",
      reason: "model not in local catalog",
    });
    expect(proposal.disabled_add).toEqual(["pi:retired/model-x"]);
    expect(proposal.summary.unavailable).toBe(1);
    expect(proposal.summary.disabled).toBe(1);
  });

  test("keeps the policy order and only appends the best-ranked new routes", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY });
    const review = profileOf(proposal, "review");
    const lines =
      review?.candidates.map((candidate) => [
        candidate.provider,
        candidate.model,
        candidate.action,
      ]) ?? [];

    expect(lines).toEqual([
      ["pi", "openai-codex/gpt-6.1-terra", "keep"],
      ["pi", "openai/gpt-6.1-sol", "keep"],
      ["pi", "zai/glm-5.3", "add"],
      ["codex", "gpt-6.1-sol", "add"],
      ["claudeAgent", "claude-sonnet-5-5", "add"],
      ["pi", "opencode-go/deepseek-v4.1-flash", "add"],
    ]);
    expect(candidateOf(review, "openai/gpt-6.1-sol")?.reason).toContain("$2/$10 per M (litellm)");
    expect(proposal.summary.reorder).toBe(0);
  });

  test("--reorder ranks the existing candidates too and says where they moved", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY, reorder: true });
    const review = profileOf(proposal, "review");
    const lines =
      review?.candidates.map((candidate) => [
        candidate.provider,
        candidate.model,
        candidate.action,
      ]) ?? [];

    expect(lines).toEqual([
      ["pi", "openai-codex/gpt-6.1-terra", "keep"],
      ["pi", "zai/glm-5.3", "add"],
      ["codex", "gpt-6.1-sol", "add"],
      ["pi", "openai/gpt-6.1-sol", "reorder"],
      ["claudeAgent", "claude-sonnet-5-5", "add"],
      ["pi", "opencode-go/deepseek-v4.1-flash", "add"],
    ]);
    expect(candidateOf(review, "openai/gpt-6.1-sol")?.reason).toContain("moved from 2 to 4");
    expect(proposal.summary.reorder).toBe(1);
  });

  test("a model over the profile cap is reported and never added", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: CAPPED_POLICY, catalog: FRONTIER });
    const reasoning = profileOf(proposal, "reasoning");

    expect(candidateOf(reasoning, "openai-codex/gpt-6-astra")?.action).toBe("over_cap");
    expect(candidateOf(reasoning, "openai-codex/gpt-6-astra")?.reason).toContain(
      "over cap > max output $20/M",
    );
    expect(proposal.over_cap.map((entry) => [entry.profile, entry.model])).toEqual([
      ["bounded", "claude-sonnet-5-5"],
      ["bounded", "opencode-go/glm-5.3-flash"],
    ]);
    expect(proposal.over_cap[0]?.price).toBe("$2/$10 per M (litellm)");
    expect(proposal.over_cap[0]?.reason).toBe("over cap > max output $5/M");
    expect(proposal.summary.over_cap).toBe(3);
    const frontierOnly = ["claude-fable-5-2", "gpt-6-astra", "openai-codex/gpt-6-astra"];
    const added = proposal.profiles
      .filter((profile) => profile.name !== "frontier")
      .flatMap((profile) => profile.candidates)
      .filter((candidate) => candidate.action === "add")
      .map((candidate) => candidate.model);
    expect(added.filter((model) => frontierOnly.includes(model))).toEqual([]);
    expect(profileOf(proposal, "frontier")?.candidates.map((candidate) => candidate.model)).toEqual(
      frontierOnly,
    );
  });

  test("a model without a price needs the profile's models allow-list", async () => {
    const f = await fixture();
    const capped = await propose(f, { text: CAPPED_POLICY, catalog: FRONTIER });
    expect(
      candidateOf(profileOf(capped.proposal, "bounded"), "opencode-go/glm-5.3-flash"),
    ).toBeUndefined();
    expect(capped.proposal.over_cap).toContainEqual({
      profile: "bounded",
      provider: "pi",
      model: "opencode-go/glm-5.3-flash",
      price: "price unknown",
      reason: "price unknown > capped profile needs a models allow-list",
    });

    const allowed = await propose(f, {
      catalog: FRONTIER,
      text: CAPPED_POLICY.replace(
        "    max_output_per_m: 5\n",
        "    max_output_per_m: 5\n    models: [ opencode-go/glm-5.3-flash ]\n",
      ),
    });
    expect(
      candidateOf(profileOf(allowed.proposal, "bounded"), "opencode-go/glm-5.3-flash")?.action,
    ).toBe("add");
    expect(
      profileOf(allowed.proposal, "bounded")?.candidates.map((candidate) => candidate.model),
    ).toEqual(["opencode-go/deepseek-v4.1-flash", "opencode-go/glm-5.3-flash"]);
  });

  test("reports unknown models as unclassified and never adds them", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { catalog: UNKNOWN });

    expect(proposal.unclassified).toEqual([
      {
        provider: "pi",
        model: "acme/mystery-9",
        reason: "no model traits entry · add one to packages/core/src/policy/model-traits.yaml",
      },
    ]);
    const models = proposal.profiles.flatMap((profile) =>
      profile.candidates.map((candidate) => candidate.model),
    );
    expect(models).not.toContain("acme/mystery-9");
    expect(JSON.stringify(proposal)).not.toContain("grok-build");
  });

  test("a blocked route is reported in place but neither proposed nor disabled", async () => {
    const f = await fixture();
    await f.run(
      upsertRouteBlock({
        id: ulid(),
        machine: f.store.machine,
        block: {
          provider_instance_id: "pi",
          model: "openai/gpt-6.1-sol",
          reason: "quota",
          reset_at: "2999-01-01T00:00:00Z",
          evidence: "usage limit",
          blocked_at: AT.toISOString(),
        },
        at: AT.toISOString(),
      }),
    );
    await f.run(
      upsertRouteBlock({
        id: ulid(),
        machine: f.store.machine,
        block: {
          provider_instance_id: "pi",
          model: "zai/glm-5.3",
          reason: "quota",
          reset_at: null,
          evidence: null,
          blocked_at: AT.toISOString(),
        },
        at: AT.toISOString(),
      }),
    );
    const { proposal } = await propose(f, { text: POLICY });

    const sol = candidateOf(profileOf(proposal, "review"), "openai/gpt-6.1-sol");
    expect(sol?.action).toBe("keep");
    expect(sol?.reason).toContain("route blocked (quota, reset at 2999-01-01T00:00:00Z)");
    expect(proposal.disabled_add).not.toContain("pi:openai/gpt-6.1-sol");
    const models = proposal.profiles.flatMap((profile) =>
      profile.candidates.map((candidate) => candidate.model),
    );
    expect(models).not.toContain("zai/glm-5.3");
  });

  test("an existing profile the traits table does not know stays as it is", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY });
    const house = profileOf(proposal, "house");
    expect(house?.action).toBe("unchanged");
    expect(house?.candidates).toEqual([
      {
        provider: "pi",
        model: "openai/gpt-6.1-sol",
        action: "keep",
        reason: "no house rank in model traits · $2/$10 per M (litellm)",
      },
    ]);
  });
});

describe("policy apply", () => {
  test("creates the policy from the template with every proposed profile", async () => {
    const f = await fixture();
    await propose(f);
    const result = await apply(f);

    expect(result.backup).toBeNull();
    const text = readFileSync(join(f.home, "policy.yaml"), "utf8");
    expect(text).toContain("# NF routing policy.");
    expect(text).toContain("- { provider: pi, model: opencode-go/deepseek-v4.1-flash");
    const policy = await Effect.runPromise(parsePolicy(text, "applied policy"));
    expect(Object.keys(policy.profiles)).toEqual([
      "bounded",
      "reasoning",
      "lookup",
      "review",
      "frontier",
    ]);
    expect(policy.profiles.bounded?.candidates.length).toBeGreaterThan(3);
    expect(policy.profiles.bounded?.max_output_per_m).toBe(15);
    expect(policy.profiles.frontier).toMatchObject({
      requires_approval: true,
      models: ["claude-fable-5-2", "gpt-6-astra"],
    });
  });

  test("keeps comments, unknown keys and pinned candidates", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY });
    expect(profileOf(proposal, "review")?.candidates[0]).toMatchObject({
      provider: "pi",
      model: "openai-codex/gpt-6.1-terra",
      pinned: true,
      action: "keep",
    });

    const result = await apply(f);
    expect(result.backup).toBe(join(f.home, "policy.yaml") + `.bak-${AT_STAMP}`);
    expect(readFileSync(result.backup as string, "utf8")).toBe(POLICY);
    expect(result.disabled).toEqual(["pi:retired/model-x"]);

    const text = readFileSync(join(f.home, "policy.yaml"), "utf8");
    expect(text).toContain(
      "# machine policy: hand-edited, so comments and unknown keys must survive apply",
    );
    expect(text).toContain("# cheap first");
    expect(text).toContain("notes: hand-written, not part of the schema");
    expect(text).toContain(
      "- { provider: pi, model: openai-codex/gpt-6.1-terra, options: { thinking: high }, pinned: true }",
    );

    const policy = await Effect.runPromise(parsePolicy(text, "applied policy"));
    expect(policy.disabled).toEqual(["pi:retired/model-x"]);
    expect(policy.profiles.review?.candidates[0]).toEqual({
      provider: "pi",
      model: "openai-codex/gpt-6.1-terra",
      options: { thinking: "high" },
      pinned: true,
    });
    expect(policy.profiles.bounded?.candidates.map((candidate) => candidate.model)).toContain(
      "openai-codex/gpt-6-luna",
    );
  });

  test("a second apply in the same second keeps both backups", async () => {
    const f = await fixture();
    await propose(f, { text: POLICY });
    const first = await apply(f);
    expect(first.backup).toBe(join(f.home, "policy.yaml") + `.bak-${AT_STAMP}`);

    await propose(f);
    const second = await apply(f);
    expect(second.backup).toBe(`${first.backup as string}-2`);
    expect(existsSync(first.backup as string)).toBe(true);
    expect(readFileSync(first.backup as string, "utf8")).toBe(POLICY);
  });

  test("refuses a proposal that changes a pinned candidate", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: POLICY });
    const tampered = JSON.parse(JSON.stringify(proposal)) as {
      profiles: { name: string; candidates: unknown[] }[];
    };
    tampered.profiles.find((profile) => profile.name === "review")?.candidates.reverse();

    const error = await rejection(apply(f, { text: JSON.stringify(tampered) }));
    expect(error.message).toContain("pinned candidate review[0]");
    expect(readFileSync(join(f.home, "policy.yaml"), "utf8")).toBe(POLICY);
  });

  test("refuses a proposal made against a policy that changed since", async () => {
    const f = await fixture();
    await propose(f, { text: POLICY });
    withPolicy(f, `${POLICY}# edited after the proposal\n`);

    const error = await rejection(apply(f));
    expect(error.message).toContain("changed since the proposal was made");
    expect(readFileSync(join(f.home, "policy.yaml"), "utf8")).toContain(
      "# edited after the proposal",
    );

    const fresh = await fixture();
    await propose(fresh);
    withPolicy(fresh, POLICY);
    const appeared = await rejection(apply(fresh));
    expect(appeared.message).toContain("changed since the proposal was made");
  });

  test("refuses a proposal for another machine's policy file", async () => {
    const source = await fixture();
    await propose(source);
    const proposalText = readFileSync(proposalFile(source.home), "utf8");
    const other = await fixture();
    const error = await rejection(apply(other, { text: proposalText }));
    expect(error.message).toContain("targets");
    expect(existsSync(join(other.home, "policy.yaml"))).toBe(false);
  });
});

const GHOST_POLICY = `version: 1
analysis_mode: review
profiles:
  review:
    - { provider: ghost, model: retired/model-x, pinned: true }
    - { provider: pi, model: zai/glm-5.3 }
  bounded:
    - { provider: peers, model: shared/model-y }
    - { provider: pi, model: opencode-go/deepseek-v4.1-flash }
disabled: []
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }
`;

describe("removals", () => {
  test("marks a candidate whose provider instance is gone as removed, not unavailable", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: GHOST_POLICY });

    expect(candidateOf(profileOf(proposal, "bounded"), "shared/model-y")).toEqual({
      provider: "peers",
      model: "shared/model-y",
      action: "remove",
      reason: "provider 'peers' not in local catalog",
    });
    expect(proposal.summary.remove).toBe(1);
    expect(proposal.summary.unavailable).toBe(0);
    expect(proposal.disabled_add).toEqual([]);
  });

  test("apply drops a removed candidate and keeps a pinned one as it is, broken", async () => {
    const f = await fixture();
    const { proposal } = await propose(f, { text: GHOST_POLICY });
    const pinned = candidateOf(profileOf(proposal, "review"), "retired/model-x");
    expect(pinned).toMatchObject({ action: "keep" });
    expect(pinned?.reason).toContain("pinned");
    expect(pinned?.reason).toContain("broken: provider 'ghost' not in local catalog");

    await apply(f);
    const text = readFileSync(join(f.home, "policy.yaml"), "utf8");
    const policy = await Effect.runPromise(parsePolicy(text, "applied policy"));
    const models = (profile: string) =>
      policy.profiles[profile]?.candidates.map((candidate) => candidate.model) ?? [];
    expect(models("bounded")).not.toContain("shared/model-y");
    expect(models("review")[0]).toBe("retired/model-x");
    expect(policy.profiles.review?.candidates[0]?.pinned).toBe(true);
    expect(policy.disabled).toEqual([]);
  });

  test("a profile whose every route is gone is disabled instead of emptied", async () => {
    const f = await fixture();
    const onlyGhost = GHOST_POLICY.replace(
      `  bounded:
    - { provider: peers, model: shared/model-y }
    - { provider: pi, model: opencode-go/deepseek-v4.1-flash }
`,
      `  house:
    - { provider: peers, model: shared/model-y }
`,
    );
    const { proposal } = await propose(f, { text: onlyGhost });
    expect(profileOf(proposal, "house")?.candidates).toEqual([
      {
        provider: "peers",
        model: "shared/model-y",
        action: "unavailable",
        reason: "provider 'peers' not in local catalog",
      },
    ]);
    expect(proposal.disabled_add).toEqual(["peers:shared/model-y"]);
  });
});

const initialize = (f: Fixture) =>
  f.run(
    initPolicy({
      home: f.home,
      machine: f.store.machine,
      environment: "local",
      source: "test catalog",
      text: FRONTIER,
      template: TEMPLATE,
      prices: PRICES,
      now: AT,
    }),
  );

describe("policy init", () => {
  test("writes the policy from the catalog and the template, without a proposal or a backup", async () => {
    const f = await fixture();
    const result = await initialize(f);

    expect(result.file).toBe(join(f.home, "policy.yaml"));
    expect(result.policy.profiles.bounded?.max_output_per_m).toBe(15);
    expect(result.policy.profiles.frontier).toMatchObject({
      requires_approval: true,
      models: ["claude-fable-5-2", "gpt-6-astra"],
    });
    // The template's own frontier candidates stay in front; the catalog adds the rest.
    expect(result.policy.profiles.frontier?.candidates.map((c) => c.model)).toEqual([
      "claude-fable-5-2",
      "openai-codex/gpt-6-astra",
      "gpt-6-astra",
    ]);
    expect(result.policy.profiles.bounded?.candidates[0]).toMatchObject({
      provider: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: { thinking: "max" },
    });
    expect(readFileSync(join(f.home, "policy.yaml"), "utf8")).toContain("# NF routing policy.");
    expect(existsSync(proposalFile(f.home))).toBe(false);
    expect(existsSync(join(f.home, `policy.yaml.bak-${AT_STAMP}`))).toBe(false);
  });

  test("refuses when a policy already exists", async () => {
    const f = await fixture();
    await initialize(f);
    const error = await rejection(initialize(f));
    expect(error.message).toContain("already exists");
    expect(error.message).toContain("nf policy propose");
  });
});
