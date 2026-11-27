import * as Schema from "effect/Schema";
import { PolicyOptions, routeKey } from "@nf/contracts";
import type { Catalog, PolicyCandidate, ProfilePolicy, RouteBlock } from "@nf/contracts";
import { activeBlock, candidateReason } from "../domain/policy.ts";
import type { CandidateContext } from "../domain/policy.ts";
import type { PriceFile } from "../domain/prices.ts";
import {
  UNRANKED,
  acceptedOptions,
  byPreference,
  catalogGap,
  fitText,
  overCapReason,
  priceDetails,
  priceRuleReason,
  providerAbsent,
} from "./policy-ranking.ts";
import type { Ranked, Route } from "./policy-ranking.ts";

export const PROPOSAL_ACTION = {
  ADD: "add",
  KEEP: "keep",
  REORDER: "reorder",
  REMOVE: "remove",
  UNAVAILABLE: "unavailable",
  OVER_CAP: "over_cap",
} as const;
export type ProposalAction = (typeof PROPOSAL_ACTION)[keyof typeof PROPOSAL_ACTION];

/** One candidate of the proposed profile, in the order `nf policy apply` writes it. */
export const ProposalCandidate = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  options: Schema.optional(PolicyOptions),
  max_options: Schema.optional(PolicyOptions),
  pinned: Schema.optional(Schema.Boolean),
  action: Schema.Literals(Object.values(PROPOSAL_ACTION)),
  reason: Schema.String,
});
export type ProposalCandidate = typeof ProposalCandidate.Type;

/** A route the profile's price rules keep out of the proposal, with the price it was judged on. */
export const ProposalOverCap = Schema.Struct({
  profile: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  price: Schema.String,
  reason: Schema.String,
});
export type ProposalOverCap = typeof ProposalOverCap.Type;

/** A `remove` candidate is reported but never written; every other action keeps its slot. */
export const isWritten = (candidate: ProposalCandidate): boolean =>
  candidate.action !== PROPOSAL_ACTION.REMOVE;

/** A route a proposal appends, with the reason its line prints. */
interface Addition extends Ranked {
  reason: string;
}

/** An existing candidate in the proposed profile; `ranked` is null when its slot is fixed. */
interface ExistingPlan {
  candidate: PolicyCandidate;
  action: ProposalAction;
  reason: string;
  disabledAdd: boolean;
  ranked: Ranked | null;
}

export interface PlanInput {
  name: string;
  existing: readonly PolicyCandidate[];
  rules: ProfilePolicy | null;
  routes: readonly Route[];
  limit: number;
  disabled: ReadonlySet<string>;
  blocks: readonly RouteBlock[];
  prices: PriceFile;
  environment: string;
  catalog: Catalog;
  nowMs: number;
}

export interface ProfilePlan {
  candidates: ProposalCandidate[];
  disabled: string[];
  overCap: ProposalOverCap[];
}

function existingPlan(input: PlanInput, candidate: PolicyCandidate): ExistingPlan {
  const { name, prices } = input;
  const key = routeKey(candidate.provider, candidate.model);
  const fixed = (action: ProposalAction, reason: string, disabledAdd = false): ExistingPlan => ({
    candidate,
    action,
    reason,
    disabledAdd,
    ranked: null,
  });
  if (input.disabled.has(key)) return fixed(PROPOSAL_ACTION.KEEP, "already disabled in policy");
  const route = input.routes.find((r) => routeKey(r.provider, r.model) === key);
  const fit = route?.trait?.profiles[name] ?? null;
  const price = priceDetails(prices, candidate.model);
  const info = fitText({ profile: name, trait: route?.trait ?? null, fit, price: price.text });
  const cap = input.rules === null ? null : overCapReason(input.rules, price.rates);
  const reason = candidateReason(candidate, candidateContext(input));
  if (candidate.pinned === true) {
    const absent = providerAbsent(input.catalog, candidate.provider);
    const notes = [cap, reason === null ? null : absent ? `broken: ${reason}` : reason].filter(
      (note): note is string => note !== null,
    );
    return fixed(PROPOSAL_ACTION.KEEP, ["pinned", info, ...notes].join(" · "));
  }
  if (providerAbsent(input.catalog, candidate.provider))
    return fixed(PROPOSAL_ACTION.REMOVE, reason ?? "provider not in catalog");
  if (reason !== null)
    return catalogGap(input.catalog, candidate)
      ? fixed(PROPOSAL_ACTION.UNAVAILABLE, reason, true)
      : fixed(PROPOSAL_ACTION.KEEP, reason);
  if (cap !== null) return fixed(PROPOSAL_ACTION.OVER_CAP, `${info} · ${cap}`);
  return {
    candidate,
    action: PROPOSAL_ACTION.KEEP,
    reason: info,
    disabledAdd: false,
    ranked: {
      candidate,
      rank: fit?.rank ?? UNRANKED,
      price: price.score,
      family: route?.trait?.family ?? "",
    },
  };
}

function candidateContext(input: PlanInput): CandidateContext {
  return {
    environmentId: input.environment,
    catalog: input.catalog,
    blocks: input.blocks,
    disabled: input.disabled,
    excluded: new Set<string>(),
    nowMs: input.nowMs,
  };
}

/** Routes the profile may gain, ranked by traits then price, and those its price rules refuse. */
function planAdditions(input: PlanInput): { additions: Addition[]; overCap: ProposalOverCap[] } {
  const { name, rules, prices } = input;
  const existingKey = new Set(input.existing.map((c) => routeKey(c.provider, c.model)));
  const additions: Addition[] = [];
  const overCap: ProposalOverCap[] = [];
  for (const route of input.routes) {
    const key = routeKey(route.provider, route.model);
    if (input.disabled.has(key) || existingKey.has(key)) continue;
    if (activeBlock(input.blocks, route.provider, route.model, input.nowMs)) continue;
    const fit = route.trait?.profiles[name];
    if (!fit) continue;
    if (rules?.models !== undefined && !rules.models.includes(route.model)) continue;
    const price = priceDetails(prices, route.model);
    const refused = rules === null ? null : priceRuleReason(rules, price, route.model);
    if (refused !== null) {
      overCap.push({
        profile: name,
        provider: route.provider,
        model: route.model,
        price: price.text,
        reason: refused,
      });
      continue;
    }
    additions.push({
      candidate: {
        provider: route.provider,
        model: route.model,
        ...acceptedOptions(route.catalogModel, fit),
      },
      rank: fit.rank,
      price: price.score,
      family: route.trait?.family ?? "",
      reason: fitText({ profile: name, trait: route.trait, fit, price: price.text }),
    });
  }
  return { additions, overCap };
}

function proposalCandidate(
  candidate: PolicyCandidate,
  action: ProposalAction,
  reason: string,
): ProposalCandidate {
  return { ...candidate, action, reason };
}

/** A planned candidate written back to the policy; a `remove` frees its slot. */
const isWrittenPlan = (plan: ExistingPlan): boolean => plan.action !== PROPOSAL_ACTION.REMOVE;

/** The user's order first, new routes after it: nothing existing moves. */
function keepOrderCandidates(
  input: PlanInput,
  plans: readonly ExistingPlan[],
  additions: readonly Addition[],
): ProposalCandidate[] {
  const capacity = Math.max(0, input.limit - plans.filter(isWrittenPlan).length);
  return [
    ...plans.map((plan) => proposalCandidate(plan.candidate, plan.action, plan.reason)),
    ...additions
      .toSorted(byPreference)
      .slice(0, capacity)
      .map((entry) => proposalCandidate(entry.candidate, PROPOSAL_ACTION.ADD, entry.reason)),
  ];
}

/** `--reorder`: rank every movable candidate, keeping fixed ones in their slot. */
function rankCandidates(
  input: PlanInput,
  plans: readonly ExistingPlan[],
  additions: readonly Addition[],
): ProposalCandidate[] {
  const capacity = Math.max(0, input.limit - plans.filter(isWrittenPlan).length);
  const appended = additions.toSorted(byPreference).slice(0, capacity);
  const movable = plans.flatMap((plan) =>
    plan.ranked === null ? [] : [{ ...plan.ranked, reason: plan.reason }],
  );
  const queue = [...movable, ...appended].toSorted(byPreference);
  const positionOf = new Map(
    input.existing.map((candidate, index) => [
      routeKey(candidate.provider, candidate.model),
      index,
    ]),
  );
  const candidates: ProposalCandidate[] = [];
  let next = 0;
  for (let position = 0; position < plans.length + appended.length; position++) {
    const plan = plans[position];
    if (plan !== undefined && plan.ranked === null) {
      candidates.push(proposalCandidate(plan.candidate, plan.action, plan.reason));
      continue;
    }
    const entry = queue[next++];
    if (entry === undefined) continue;
    const before = positionOf.get(routeKey(entry.candidate.provider, entry.candidate.model));
    const action =
      before === undefined
        ? PROPOSAL_ACTION.ADD
        : before === position
          ? PROPOSAL_ACTION.KEEP
          : PROPOSAL_ACTION.REORDER;
    const moved =
      before === undefined || before === position
        ? ""
        : ` · moved from ${before + 1} to ${position + 1}`;
    candidates.push(proposalCandidate(entry.candidate, action, `${entry.reason}${moved}`));
  }
  return candidates;
}

/** The candidate list a proposal writes for one profile, and what it refuses to add. */
export function planProfile(input: PlanInput & { reorder: boolean }): ProfilePlan {
  const plans = input.existing.map((candidate) => existingPlan(input, candidate));
  // A policy profile must keep a candidate: when every route left the catalog, disabling them
  // reports the same problem without writing an empty list the schema rejects.
  const settled =
    plans.length > 0 && plans.every((plan) => plan.action === PROPOSAL_ACTION.REMOVE)
      ? plans.map((plan): ExistingPlan => ({
          ...plan,
          action: PROPOSAL_ACTION.UNAVAILABLE,
          disabledAdd: true,
        }))
      : plans;
  const { additions, overCap } = planAdditions(input);
  return {
    candidates: input.reorder
      ? rankCandidates(input, settled, additions)
      : keepOrderCandidates(input, settled, additions),
    disabled: settled
      .filter((plan) => plan.disabledAdd)
      .map((plan) => routeKey(plan.candidate.provider, plan.candidate.model)),
    overCap,
  };
}
