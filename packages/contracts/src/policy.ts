import * as Schema from "effect/Schema";
import { ContextMode } from "./attempt.ts";
import { PolicyPrices } from "./prices.ts";
import { AnalysisMode } from "./task.ts";

/** The only policy file layout nf understands; a different version is a validation error. */
export const POLICY_VERSION = 1;

/** Label of this machine's catalog; other labels are linked environments. */
export const LOCAL_ENVIRONMENT = "local";

export const OPTION_SCALAR = Schema.Union([Schema.String, Schema.Boolean, Schema.Finite]);
export type OptionScalar = typeof OPTION_SCALAR.Type;

/** Provider-native option values, e.g. `{ thinking: "max" }` for Pi. */
export const PolicyOptions = Schema.Record(Schema.String, OPTION_SCALAR);
export type PolicyOptions = typeof PolicyOptions.Type;

/** One route of a profile, tried in order. `max_options` caps an effort escalation. */
export const PolicyCandidate = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  options: Schema.optional(PolicyOptions),
  max_options: Schema.optional(PolicyOptions),
  /** `nf policy apply` keeps a pinned candidate exactly where it is. */
  pinned: Schema.optional(Schema.Boolean),
});
export type PolicyCandidate = typeof PolicyCandidate.Type;

export const PolicyContextTransfer = Schema.Struct({
  default: ContextMode,
  never_reuse_for: Schema.Array(Schema.String),
});
export type PolicyContextTransfer = typeof PolicyContextTransfer.Type;

export const PolicyRecovery = Schema.Struct({
  pi_usage_limit_with_reset: Schema.String,
  max_repair_cycles: Schema.Int,
  reasoning_escalations: Schema.Int,
});
export type PolicyRecovery = typeof PolicyRecovery.Type;

/**
 * Rules a profile adds to its candidates: USD per million token caps, the models it may hold
 * even without a price, and whether dispatching to it needs the user's approval.
 */
export const ProfilePolicy = Schema.Struct({
  candidates: Schema.Array(PolicyCandidate),
  max_input_per_m: Schema.optional(Schema.Finite),
  max_output_per_m: Schema.optional(Schema.Finite),
  models: Schema.optional(Schema.Array(Schema.String)),
  requires_approval: Schema.optional(Schema.Boolean),
});
export type ProfilePolicy = typeof ProfilePolicy.Type;

/** A profile as `policy.yaml` may write it: the rule-free candidate list, or both together. */
export const ProfileEntry = Schema.Union([Schema.Array(PolicyCandidate), ProfilePolicy]);
export type ProfileEntry = typeof ProfileEntry.Type;

/** `$NF_HOME/policy.yaml` as nf reads it: every profile has its candidates and its rules. */
export const Policy = Schema.Struct({
  version: Schema.Literal(POLICY_VERSION),
  analysis_mode: AnalysisMode,
  profiles: Schema.Record(Schema.String, ProfilePolicy),
  /** Routes to skip without deleting them, as `provider:model`. */
  disabled: Schema.Array(Schema.String),
  /** Manual price overrides, used after the LiteLLM and OpenRouter rates. */
  prices: Schema.optional(PolicyPrices),
  context_transfer: PolicyContextTransfer,
  recovery: PolicyRecovery,
});
export type Policy = typeof Policy.Type;

/** The file as a user writes it: a profile stays a bare candidate list unless it has rules. */
export const PolicyFile = Schema.Struct({
  version: Schema.Literal(POLICY_VERSION),
  analysis_mode: AnalysisMode,
  profiles: Schema.Record(Schema.String, ProfileEntry),
  disabled: Schema.Array(Schema.String),
  /** Manual price overrides, used after the LiteLLM and OpenRouter rates. */
  prices: Schema.optional(PolicyPrices),
  context_transfer: PolicyContextTransfer,
  recovery: PolicyRecovery,
});
export type PolicyFile = typeof PolicyFile.Type;

/** A route is the exact provider instance plus model id, e.g. `pi:openai-codex/gpt-6-luna`. */
export function routeKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Parse `provider:model`, rejecting anything without both halves. */
export function parseRouteRef(ref: string): { provider: string; model: string } | null {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { provider: ref.slice(0, at), model: ref.slice(at + 1) };
}

/** An option of a catalog model, with every value the provider accepts for it. */
export const CatalogOption = Schema.Struct({
  id: Schema.String,
  values: Schema.Array(OPTION_SCALAR),
  default: Schema.optional(OPTION_SCALAR),
});
export type CatalogOption = typeof CatalogOption.Type;

export const CatalogModel = Schema.Struct({
  id: Schema.String,
  label: Schema.NullOr(Schema.String),
  options: Schema.Array(CatalogOption),
});
export type CatalogModel = typeof CatalogModel.Type;

export const CatalogProvider = Schema.Struct({
  provider_instance_id: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  /** Whether T3 accepts this provider instance as the parent of a delegated child. */
  can_run_child_task: Schema.Boolean,
  /** Whether T3 reports the instance as disabled (constraint "Provider instance is disabled."). */
  disabled: Schema.Boolean,
  constraints: Schema.Array(Schema.String),
  models: Schema.Array(CatalogModel),
});
export type CatalogProvider = typeof CatalogProvider.Type;

/** The merged, validated capabilities of one environment, as cached in the store. */
export const Catalog = Schema.Struct({
  environment_id: Schema.String,
  checked_at: Schema.String,
  providers: Schema.Array(CatalogProvider),
});
export type Catalog = typeof Catalog.Type;

export const ROUTE_BLOCK_REASON = {
  QUOTA: "quota",
  AUTH: "auth",
  AVAILABILITY: "availability",
  OTHER: "other",
} as const;
export type RouteBlockReason = (typeof ROUTE_BLOCK_REASON)[keyof typeof ROUTE_BLOCK_REASON];
export const ROUTE_BLOCK_REASONS: readonly RouteBlockReason[] = Object.values(ROUTE_BLOCK_REASON);
export const RouteBlockReason = Schema.Literals(Object.values(ROUTE_BLOCK_REASON));

/** A blocked route; `reset_at` absent means it stays blocked until `nf route unblock`. */
export const RouteBlock = Schema.Struct({
  provider_instance_id: Schema.String,
  model: Schema.String,
  reason: RouteBlockReason,
  reset_at: Schema.NullOr(Schema.String),
  evidence: Schema.NullOr(Schema.String),
  blocked_at: Schema.String,
});
export type RouteBlock = typeof RouteBlock.Type;
