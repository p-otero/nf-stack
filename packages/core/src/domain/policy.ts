import type {
  Catalog,
  CatalogModel,
  CatalogOption,
  CatalogProvider,
  Policy,
  PolicyCandidate,
  RouteBlock,
} from "@nf/contracts";
import { routeKey } from "@nf/contracts";

/** A cached catalog older than this is stale: `nf policy status` exits 3 and the skills re-check. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface PolicyRoute {
  provider: string;
  model: string;
  /** Profiles that list the route, in policy order. */
  profiles: string[];
}

/** The distinct routes a policy lists, in first-appearance order. */
export function policyRoutes(policy: Policy): PolicyRoute[] {
  const routes = new Map<string, PolicyRoute>();
  for (const [profile, { candidates }] of Object.entries(policy.profiles)) {
    for (const candidate of candidates) {
      const key = routeKey(candidate.provider, candidate.model);
      const route = routes.get(key);
      if (route) route.profiles.push(profile);
      else
        routes.set(key, {
          provider: candidate.provider,
          model: candidate.model,
          profiles: [profile],
        });
    }
  }
  return [...routes.values()];
}

/** Routes the policy disables, as `provider:model` keys. */
export function disabledRoutes(policy: Policy): Set<string> {
  return new Set(policy.disabled);
}

export function findProvider(catalog: Catalog, providerId: string): CatalogProvider | null {
  return catalog.providers.find((p) => p.provider_instance_id === providerId) ?? null;
}

export function findModel(provider: CatalogProvider, modelId: string): CatalogModel | null {
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function findOption(model: CatalogModel, id: string): CatalogOption | null {
  return model.options.find((o) => o.id === id) ?? null;
}

/** Whether `route` can be delegated in `catalog`: the provider runs children and lists the model. */
export function routeAvailable(
  catalog: Catalog,
  route: { provider: string; model: string },
): boolean {
  const provider = findProvider(catalog, route.provider);
  if (!provider || provider.disabled || !provider.can_run_child_task) return false;
  return findModel(provider, route.model) !== null;
}

function mergeOptions(
  previous: readonly CatalogOption[],
  incoming: readonly CatalogOption[],
): CatalogOption[] {
  const merged = new Map(previous.map((o) => [o.id, o]));
  for (const option of incoming) {
    const before = merged.get(option.id);
    if (!before) {
      merged.set(option.id, option);
      continue;
    }
    const values = [...before.values];
    for (const value of option.values) if (!values.includes(value)) values.push(value);
    merged.set(option.id, {
      id: option.id,
      values,
      ...(option.default === undefined && before.default === undefined
        ? {}
        : { default: option.default ?? before.default }),
    });
  }
  return [...merged.values()];
}

function mergeModels(
  previous: readonly CatalogModel[],
  incoming: readonly CatalogModel[],
): CatalogModel[] {
  const merged = new Map(previous.map((m) => [m.id, m]));
  for (const model of incoming) {
    const before = merged.get(model.id);
    merged.set(
      model.id,
      before
        ? {
            id: model.id,
            label: model.label ?? before.label,
            options: mergeOptions(before.options, model.options),
          }
        : model,
    );
  }
  return [...merged.values()];
}

function mergeProvider(
  previous: CatalogProvider | undefined,
  incoming: CatalogProvider,
): CatalogProvider {
  if (!previous) return incoming;
  return {
    provider_instance_id: incoming.provider_instance_id,
    display_name: incoming.display_name ?? previous.display_name,
    can_run_child_task: incoming.can_run_child_task,
    disabled: incoming.disabled,
    constraints: incoming.constraints,
    models: mergeModels(previous.models, incoming.models),
  };
}

/**
 * Fold one `orchestrator_capabilities` payload into the environment's snapshot. Instance-level
 * state (constraints, child-task support) reflects the newest payload; models and their option
 * values accumulate, so a `search` result for one model never drops the rest of the catalog.
 */
export function mergeCatalog(
  previous: Catalog | null,
  environmentId: string,
  incoming: readonly CatalogProvider[],
  checkedAt: string,
): Catalog {
  const providers = new Map<string, CatalogProvider>(
    (previous?.environment_id === environmentId ? previous.providers : []).map((p) => [
      p.provider_instance_id,
      p,
    ]),
  );
  for (const provider of incoming) {
    providers.set(
      provider.provider_instance_id,
      mergeProvider(providers.get(provider.provider_instance_id), provider),
    );
  }
  return {
    environment_id: environmentId,
    checked_at: checkedAt,
    providers: [...providers.values()],
  };
}

/** A block that still applies: no reset, or a reset in the future. */
export function activeBlock(
  blocks: readonly RouteBlock[],
  provider: string,
  model: string,
  nowMs: number,
): RouteBlock | null {
  for (const block of blocks) {
    if (block.provider_instance_id !== provider || block.model !== model) continue;
    if (block.reset_at === null) return block;
    const reset = Date.parse(block.reset_at);
    if (Number.isNaN(reset)) return block;
    if (nowMs < reset) return block;
  }
  return null;
}

export interface CandidateContext {
  environmentId: string;
  catalog: Catalog;
  blocks: readonly RouteBlock[];
  disabled: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  nowMs: number;
  /** One more check after the catalog ones, for rules like a profile's price caps. */
  priceReason?: (candidate: PolicyCandidate) => string | null;
}

export interface CandidateVerdict {
  candidate: PolicyCandidate;
  eligible: boolean;
  /** Why the candidate is not eligible; null when it is. */
  reason: string | null;
}

function optionReason(
  model: CatalogModel,
  label: string,
  id: string,
  value: unknown,
): string | null {
  const option = findOption(model, id);
  if (!option) return `${label} '${id}' not offered`;
  if (!option.values.some((v) => v === value))
    return `${label} '${id}' value ${JSON.stringify(value)} not accepted`;
  return null;
}

/** The first reason `candidate` cannot be delegated in `context`, or null when it can. */
export function candidateReason(
  candidate: PolicyCandidate,
  context: CandidateContext,
): string | null {
  const key = routeKey(candidate.provider, candidate.model);
  if (context.disabled.has(key)) return "disabled in policy";
  if (context.excluded.has(key)) return "excluded by --exclude";
  const block = activeBlock(context.blocks, candidate.provider, candidate.model, context.nowMs);
  if (block)
    return block.reset_at === null
      ? `route blocked (${block.reason}, no reset)`
      : `route blocked (${block.reason}, reset at ${block.reset_at})`;
  const provider = findProvider(context.catalog, candidate.provider);
  if (!provider) return `provider '${candidate.provider}' not in ${context.environmentId} catalog`;
  if (provider.disabled)
    return `provider '${candidate.provider}' disabled in ${context.environmentId} catalog`;
  if (!provider.can_run_child_task)
    return `provider '${candidate.provider}' cannot run child tasks`;
  const model = findModel(provider, candidate.model);
  if (!model) return `model not in ${context.environmentId} catalog`;
  for (const [id, value] of Object.entries(candidate.options ?? {})) {
    const reason = optionReason(model, "option", id, value);
    if (reason) return reason;
  }
  for (const [id, value] of Object.entries(candidate.max_options ?? {})) {
    const reason = optionReason(model, "max_options", id, value);
    if (reason) return reason;
  }
  return context.priceReason?.(candidate) ?? null;
}

/** Evaluate a profile in order, stopping at the first eligible candidate. */
export function resolveProfile(
  profile: string,
  candidates: readonly PolicyCandidate[],
  context: CandidateContext,
): { eligible: PolicyCandidate | null; verdicts: CandidateVerdict[] } {
  const verdicts: CandidateVerdict[] = [];
  for (const candidate of candidates) {
    const reason = candidateReason(candidate, context);
    verdicts.push({ candidate, eligible: reason === null, reason });
    if (reason === null) return { eligible: candidate, verdicts };
  }
  return { eligible: null, verdicts };
}

export interface PolicyDrift {
  missing: PolicyRoute[];
  elsewhere: { route: PolicyRoute; environments: string[] }[];
}

/** Policy routes absent from every catalog, and routes only cached for another environment. */
export function policyDrift(
  policy: Policy,
  catalogs: readonly Catalog[],
  localEnvironment: string,
): PolicyDrift {
  const disabled = disabledRoutes(policy);
  const missing: PolicyRoute[] = [];
  const elsewhere: { route: PolicyRoute; environments: string[] }[] = [];
  for (const route of policyRoutes(policy)) {
    if (disabled.has(routeKey(route.provider, route.model))) continue;
    const available = catalogs.filter((c) => routeAvailable(c, route)).map((c) => c.environment_id);
    if (available.length === 0) {
      missing.push(route);
    } else if (!available.includes(localEnvironment)) {
      elsewhere.push({ route, environments: available });
    }
  }
  return { missing, elsewhere };
}

/** Compact age for one-line status, e.g. `just now`, `42m ago`, `3h ago`, `2d ago`. */
export function relativeAge(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/** Age in ms, or null when `checkedAt` is not a timestamp. */
export function ageOf(checkedAt: string, nowMs: number): number | null {
  const at = Date.parse(checkedAt);
  return Number.isNaN(at) ? null : Math.max(0, nowMs - at);
}

export function isStale(checkedAt: string, nowMs: number): boolean {
  const age = ageOf(checkedAt, nowMs);
  return age === null || age > STALE_AFTER_MS;
}
