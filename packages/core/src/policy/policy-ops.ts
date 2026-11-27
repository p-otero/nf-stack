import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { LOCAL_ENVIRONMENT, NfError, parseRouteRef, routeKey } from "@nf/contracts";
import type { OptionScalar, Policy, PolicyCandidate } from "@nf/contracts";
import {
  ageOf,
  disabledRoutes,
  isStale,
  mergeCatalog,
  policyDrift,
  resolveProfile,
  STALE_AFTER_MS,
} from "../domain/policy.ts";
import type { CandidateVerdict, PolicyDrift } from "../domain/policy.ts";
import type { PriceFile } from "../domain/prices.ts";
import {
  listRouteBlocks,
  loadCatalog,
  loadCatalogs,
  saveCatalog,
} from "../persistence/policy.persistence.ts";
import { decodeCapabilities } from "../sources/orchestrator-capabilities.ts";
import { loadModelTraits } from "./model-traits.ts";
import type { ModelTraits } from "./model-traits.ts";
import { loadPolicy, parsePolicy, policyFile, readPolicyTemplate } from "./policy-file.ts";
import { applyPolicy } from "./policy-apply.ts";
import { buildProposal, contentHash, proposalFile } from "./policy-proposal.ts";
import type { PolicyProposal } from "./policy-proposal.ts";
import { overCapReason, priceDetails } from "./policy-ranking.ts";
import type { Price } from "./policy-ranking.ts";

export interface DelegateOption {
  id: string;
  value: OptionScalar;
}

/** The `target` object a coordinator passes to T3 `delegate_task`. */
export interface DelegateTarget {
  providerInstanceId: string;
  model: string;
  options: DelegateOption[];
  environmentId?: string;
}

/** Fold one `orchestrator_capabilities` payload into the environment's cached catalog. */
const mergeCatalogPayload = Effect.fn("Policy.mergeCatalog")(function* (input: {
  machine: string;
  environment: string;
  source: string;
  text: string;
  now: Date;
}) {
  const incoming = yield* decodeCapabilities(input.text, input.source);
  const previous = yield* loadCatalog(input.environment);
  const checkedAt = input.now.toISOString();
  const catalog = mergeCatalog(previous, input.environment, incoming, checkedAt);
  yield* saveCatalog({ machine: input.machine, catalog, createdAt: checkedAt });
  return catalog;
});

export interface PolicyCheck {
  environment: string;
  checked_at: string;
  providers: number;
  models: number;
  environments: string[];
  drift: PolicyDrift;
}

/**
 * Merge one `orchestrator_capabilities` result into the environment's cached catalog, then
 * compare the machine policy against every cached environment.
 */
export const checkPolicy = Effect.fn("Policy.check")(function* (input: {
  home: string;
  machine: string;
  environment: string;
  source: string;
  text: string;
  now: Date;
}) {
  const policy = yield* loadPolicy(input.home);
  const catalog = yield* mergeCatalogPayload(input);
  const checkedAt = catalog.checked_at;
  const catalogs = yield* loadCatalogs();
  return {
    environment: input.environment,
    checked_at: checkedAt,
    providers: catalog.providers.length,
    models: catalog.providers.reduce((sum, p) => sum + p.models.length, 0),
    environments: catalogs.map((c) => c.environment_id),
    drift: policyDrift(policy, catalogs, LOCAL_ENVIRONMENT),
  } satisfies PolicyCheck;
});

export interface PolicyStatus {
  state: "ok" | "stale" | "never";
  environment: string;
  checked_at: string | null;
  age_ms: number | null;
  stale_after_ms: number;
  environments: string[];
  drift: PolicyDrift;
}

/** One line for the coordinator: is the local catalog fresh, and how many policy routes it lacks. */
export const policyStatus = Effect.fn("Policy.status")(function* (input: {
  home: string;
  now: Date;
}) {
  const policy = yield* loadPolicy(input.home);
  const catalogs = yield* loadCatalogs();
  const local = catalogs.find((c) => c.environment_id === LOCAL_ENVIRONMENT) ?? null;
  const nowMs = input.now.getTime();
  const state = local === null ? "never" : isStale(local.checked_at, nowMs) ? "stale" : "ok";
  return {
    state,
    environment: LOCAL_ENVIRONMENT,
    checked_at: local?.checked_at ?? null,
    age_ms: local === null ? null : ageOf(local.checked_at, nowMs),
    stale_after_ms: STALE_AFTER_MS,
    environments: catalogs.map((c) => c.environment_id),
    drift: policyDrift(policy, catalogs, LOCAL_ENVIRONMENT),
  } satisfies PolicyStatus;
});

/** A price with a layer behind it, or null when the chain knows no complete rate. */
function knownPrice(price: Price | null): string | null {
  return price === null || price.rates === null ? null : price.text;
}

export interface PolicyResolution {
  profile: string;
  environment: string;
  eligible: PolicyCandidate | null;
  /** The eligible candidate's price with the layer it came from; null when unpriced. */
  price: string | null;
  verdicts: CandidateVerdict[];
  target: DelegateTarget | null;
}

/** `delegate_task` target for a policy candidate; linked environments travel as `environmentId`. */
export function delegateTarget(candidate: PolicyCandidate, environment: string): DelegateTarget {
  return {
    providerInstanceId: candidate.provider,
    model: candidate.model,
    options: Object.entries(candidate.options ?? {}).map(([id, value]) => ({ id, value })),
    ...(environment === LOCAL_ENVIRONMENT ? {} : { environmentId: environment }),
  };
}

/**
 * Pick the first eligible candidate of `profile` in the cached catalog of `environment`.
 * A profile with `requires_approval` refuses until the caller passes the user's approval; a
 * candidate above the profile's price cap is skipped with its price. Without an eligible
 * candidate the verdicts carry the reason for each one.
 */
export const resolveCandidate = Effect.fn("Policy.resolve")(function* (input: {
  home: string;
  profile: string;
  environment: string;
  exclude: readonly string[];
  prices: PriceFile;
  approved: boolean;
  now: Date;
}) {
  const policy = yield* loadPolicy(input.home);
  const profilePolicy = policy.profiles[input.profile];
  if (!profilePolicy)
    return yield* new NfError({
      code: "unknown_profile",
      message: `profile '${input.profile}' is not in the policy (${Object.keys(policy.profiles).join("|")})`,
    });
  if (profilePolicy.requires_approval === true && !input.approved)
    return yield* new NfError({
      code: "approval_required",
      message: `profile '${input.profile}' needs the user's approval: ask the user, then rerun 'nf policy resolve ${input.profile} --approved'`,
    });
  const catalog = yield* loadCatalog(input.environment);
  if (!catalog)
    return yield* new NfError({
      code: "no_catalog",
      message: `no cached catalog for '${input.environment}'; run orchestrator_capabilities and pipe it to 'nf policy check --env ${input.environment}'`,
    });
  const excluded = new Set<string>();
  for (const ref of input.exclude) {
    const route = parseRouteRef(ref);
    if (!route)
      return yield* new NfError({
        code: "invalid_value",
        message: `--exclude takes provider:model, got '${ref}'`,
      });
    excluded.add(routeKey(route.provider, route.model));
  }
  const blocks = yield* listRouteBlocks();
  const { eligible, verdicts } = resolveProfile(input.profile, profilePolicy.candidates, {
    environmentId: input.environment,
    catalog,
    blocks,
    disabled: disabledRoutes(policy),
    excluded,
    nowMs: input.now.getTime(),
    priceReason: (candidate) => {
      const price = priceDetails(input.prices, candidate.model);
      const cap = overCapReason(profilePolicy, price.rates);
      return cap === null ? null : `${cap} · ${price.text}`;
    },
  });
  const eligiblePrice = eligible === null ? null : priceDetails(input.prices, eligible.model);
  return {
    profile: input.profile,
    environment: input.environment,
    eligible,
    price: knownPrice(eligiblePrice),
    verdicts,
    target: eligible ? delegateTarget(eligible, input.environment) : null,
  } satisfies PolicyResolution;
});

export interface ProposeResult {
  /** Where the proposal JSON was written, for `nf policy apply`. */
  file: string;
  proposal: PolicyProposal;
}

/**
 * Merge the `orchestrator_capabilities` payload into the cached catalog and propose the policy
 * changes it implies. Nothing under `$NF_HOME` except the proposal file is written.
 */
export const proposePolicy = Effect.fn("Policy.propose")(function* (input: {
  home: string;
  machine: string;
  environment: string;
  source: string;
  text: string;
  prices: PriceFile;
  now: Date;
  reorder?: boolean;
  traits?: ModelTraits;
  /** The policy to plan against when the file does not exist yet (`propose --init`). */
  base?: Policy | null;
}) {
  const file = policyFile(input.home);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  const policy = current === null ? (input.base ?? null) : yield* parsePolicy(current, file);
  const catalog = yield* mergeCatalogPayload(input);
  const traits = input.traits ?? (yield* loadModelTraits());
  const blocks = yield* listRouteBlocks();
  const proposal = buildProposal({
    policy,
    environment: input.environment,
    policyFile: file,
    policyHash: current === null ? null : contentHash(current),
    catalog,
    traits,
    blocks,
    prices: input.prices,
    nowMs: input.now.getTime(),
    reorder: input.reorder ?? false,
  });
  const target = proposalFile(input.home);
  yield* Effect.sync(() => {
    mkdirSync(input.home, { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify(proposal, null, 2)}
`,
    );
  });
  return { file: target, proposal } satisfies ProposeResult;
});

export interface InitResult {
  file: string;
  policy: Policy;
}

/**
 * `nf policy propose --init` on a machine without a policy: plan from the catalog against the
 * template's rules and write the file in one step. A policy that exists is never overwritten.
 */
export const initPolicy = Effect.fn("Policy.init")(function* (input: {
  home: string;
  machine: string;
  environment: string;
  source: string;
  text: string;
  template: string;
  prices: PriceFile;
  now: Date;
}) {
  const file = policyFile(input.home);
  if (existsSync(file))
    return yield* new NfError({
      code: "policy_exists",
      message: `${file} already exists; run 'nf policy propose' to review the diff instead`,
    });
  const template = yield* readPolicyTemplate(input.template);
  const base = yield* parsePolicy(template, input.template);
  const catalog = yield* mergeCatalogPayload(input);
  const proposal = buildProposal({
    policy: base,
    environment: input.environment,
    policyFile: file,
    policyHash: null,
    catalog,
    traits: yield* loadModelTraits(),
    blocks: yield* listRouteBlocks(),
    prices: input.prices,
    nowMs: input.now.getTime(),
  });
  const applied = yield* applyPolicy({
    home: input.home,
    template: input.template,
    text: JSON.stringify(proposal),
    source: "init",
    now: input.now,
  });
  return { file: applied.file, policy: applied.policy } satisfies InitResult;
});
