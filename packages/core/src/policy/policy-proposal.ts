import { createHash } from "node:crypto";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { routeKey } from "@nf/contracts";
import type { Catalog, Policy, PolicyCandidate, RouteBlock } from "@nf/contracts";
import { childRoutes, compareText } from "./policy-ranking.ts";
import type { ModelTraits } from "./model-traits.ts";
import type { PriceFile } from "../domain/prices.ts";
import {
  planProfile,
  PROPOSAL_ACTION,
  ProposalCandidate,
  ProposalOverCap,
  isWritten,
} from "./policy-plan.ts";

export { PROPOSAL_ACTION, ProposalCandidate, ProposalOverCap } from "./policy-plan.ts";
export type { ProposalAction } from "./policy-plan.ts";

export const PROPOSAL_VERSION = 2;

export const PROFILE_ACTION = {
  CREATE: "create",
  UPDATE: "update",
  UNCHANGED: "unchanged",
} as const;
export type ProposalProfileAction = (typeof PROFILE_ACTION)[keyof typeof PROFILE_ACTION];

export const ProposalProfile = Schema.Struct({
  name: Schema.String,
  action: Schema.Literals(Object.values(PROFILE_ACTION)),
  candidates: Schema.Array(ProposalCandidate),
});
export type ProposalProfile = typeof ProposalProfile.Type;

export const ProposalUnclassified = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  reason: Schema.String,
});
export type ProposalUnclassified = typeof ProposalUnclassified.Type;

export const ProposalSummary = Schema.Struct({
  add: Schema.Int,
  reorder: Schema.Int,
  remove: Schema.Int,
  unavailable: Schema.Int,
  over_cap: Schema.Int,
  disabled: Schema.Int,
  changed_profiles: Schema.Int,
});
export type ProposalSummary = typeof ProposalSummary.Type;

/** The reviewable diff `nf policy propose` prints and `nf policy apply` writes. */
export const PolicyProposal = Schema.Struct({
  version: Schema.Literal(PROPOSAL_VERSION),
  environment: Schema.String,
  policy_file: Schema.String,
  /** SHA-256 of the policy file the proposal was made against; null when it did not exist. */
  policy_hash: Schema.NullOr(Schema.String),
  profiles: Schema.Array(ProposalProfile),
  disabled_add: Schema.Array(Schema.String),
  unclassified: Schema.Array(ProposalUnclassified),
  over_cap: Schema.Array(ProposalOverCap),
  summary: ProposalSummary,
});
export type PolicyProposal = typeof PolicyProposal.Type;

/** `$NF_HOME/policy.proposal.json`: what `nf policy propose` writes and `apply` reads by default. */
export function proposalFile(home: string): string {
  return join(home, "policy.proposal.json");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The fields of a candidate a proposal may not change; also the identity used for diffs. */
export const candidateData = (c: PolicyCandidate): string =>
  JSON.stringify([
    c.provider,
    c.model,
    c.options ?? null,
    c.max_options ?? null,
    c.pinned === true,
  ]);

function profileAction(
  existing: readonly PolicyCandidate[],
  candidates: readonly ProposalCandidate[],
): ProposalProfileAction {
  const before = existing.map(candidateData).join("\n");
  const after = candidates.filter(isWritten).map(candidateData).join("\n");
  if (before === after) return PROFILE_ACTION.UNCHANGED;
  return existing.length === 0 ? PROFILE_ACTION.CREATE : PROFILE_ACTION.UPDATE;
}

export interface ProposalInput {
  policy: Policy | null;
  environment: string;
  policyFile: string;
  policyHash: string | null;
  catalog: Catalog;
  traits: ModelTraits;
  blocks: readonly RouteBlock[];
  prices: PriceFile;
  nowMs: number;
  /** Rank the existing candidates too, instead of keeping the user's order. */
  reorder?: boolean;
}

/** The deterministic diff between `policy` and what the catalog and traits table support. */
export function buildProposal(input: ProposalInput): PolicyProposal {
  const routes = childRoutes(input.catalog, input.traits);
  const disabled = new Set(input.policy?.disabled ?? []);
  const existingProfiles = input.policy?.profiles ?? {};
  const names = [
    ...input.traits.profiles,
    ...Object.keys(existingProfiles)
      .filter((name) => !input.traits.profiles.includes(name))
      .toSorted(compareText),
  ];
  const profiles: ProposalProfile[] = [];
  const disabledAdd: string[] = [];
  const overCap: ProposalOverCap[] = [];
  const summary = {
    add: 0,
    reorder: 0,
    remove: 0,
    unavailable: 0,
    over_cap: 0,
    disabled: 0,
    changed_profiles: 0,
  };

  for (const name of names) {
    const rules = existingProfiles[name] ?? null;
    const plan = planProfile({
      name,
      existing: rules?.candidates ?? [],
      rules,
      routes,
      limit: input.traits.limit,
      disabled,
      blocks: input.blocks,
      prices: input.prices,
      environment: input.environment,
      catalog: input.catalog,
      nowMs: input.nowMs,
      reorder: input.reorder ?? false,
    });
    if (plan.candidates.length === 0) continue;
    for (const key of plan.disabled) if (!disabledAdd.includes(key)) disabledAdd.push(key);
    for (const entry of plan.overCap) overCap.push(entry);
    const action = profileAction(rules?.candidates ?? [], plan.candidates);
    for (const candidate of plan.candidates) {
      if (candidate.action === PROPOSAL_ACTION.ADD) summary.add++;
      if (candidate.action === PROPOSAL_ACTION.REORDER) summary.reorder++;
      if (candidate.action === PROPOSAL_ACTION.REMOVE) summary.remove++;
      if (candidate.action === PROPOSAL_ACTION.UNAVAILABLE) summary.unavailable++;
      if (candidate.action === PROPOSAL_ACTION.OVER_CAP) summary.over_cap++;
    }
    if (action !== PROFILE_ACTION.UNCHANGED) summary.changed_profiles++;
    profiles.push({ name, action, candidates: plan.candidates });
  }

  const unclassified = routes
    .filter((route) => !route.trait && !disabled.has(routeKey(route.provider, route.model)))
    .map((route) => ({
      provider: route.provider,
      model: route.model,
      reason: "no model traits entry · add one to packages/core/src/policy/model-traits.yaml",
    }))
    .toSorted((a, b) => compareText(a.provider, b.provider) || compareText(a.model, b.model));

  summary.over_cap += overCap.length;
  summary.disabled = disabledAdd.length;
  return {
    version: PROPOSAL_VERSION,
    environment: input.environment,
    policy_file: input.policyFile,
    policy_hash: input.policyHash,
    profiles,
    disabled_add: disabledAdd,
    unclassified,
    over_cap: overCap,
    summary,
  };
}
