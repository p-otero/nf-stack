import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { NfError } from "@nf/contracts";
import type { CatalogOption, CatalogProvider, OptionScalar } from "@nf/contracts";
import { formatIssuePaths } from "../domain/schema-errors.ts";

/**
 * The subset of T3 `orchestrator_capabilities` that routing needs. T3 also sends runtime
 * modes, inherited model options and features; those are ignored, and an unknown field never
 * rejects a payload.
 */
const CapabilityOption = Schema.Struct({
  id: Schema.String,
  values: Schema.optional(
    Schema.Array(Schema.Union([Schema.String, Schema.Boolean, Schema.Finite])),
  ),
  default: Schema.optional(Schema.Union([Schema.String, Schema.Boolean, Schema.Finite])),
});

const CapabilityModel = Schema.Struct({
  id: Schema.String,
  label: Schema.optional(Schema.NullOr(Schema.String)),
  options: Schema.optional(Schema.Array(CapabilityOption)),
});

const CapabilityProvider = Schema.Struct({
  providerInstanceId: Schema.String,
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  models: Schema.optional(Schema.Array(CapabilityModel)),
  canRunChildTask: Schema.optional(Schema.Boolean),
  constraints: Schema.optional(Schema.Array(Schema.String)),
});

export const Capabilities = Schema.Struct({
  providers: Schema.Array(CapabilityProvider),
});

export type Capabilities = typeof Capabilities.Type;

// T3 marks an instance it will not run with this constraint; the other constraints are advisory.
const DISABLED = /disabled/i;

const option = (input: {
  id: string;
  values?: readonly OptionScalar[] | undefined;
  default?: OptionScalar | undefined;
}): CatalogOption => ({
  id: input.id,
  values: [...(input.values ?? [])],
  ...(input.default === undefined ? {} : { default: input.default }),
});

const provider = (input: Capabilities["providers"][number]): CatalogProvider => {
  const constraints = [...(input.constraints ?? [])];
  return {
    provider_instance_id: input.providerInstanceId,
    display_name: input.displayName ?? null,
    can_run_child_task: input.canRunChildTask ?? false,
    disabled: constraints.some((c) => DISABLED.test(c)),
    constraints,
    models: (input.models ?? []).map((m) => ({
      id: m.id,
      label: m.label ?? null,
      options: (m.options ?? []).map(option),
    })),
  };
};

const decodeCapabilitiesPayload = Schema.decodeUnknownResult(Capabilities);

/** Decode one `orchestrator_capabilities` payload (or a `search` result of the same shape). */
export const decodeCapabilities = Effect.fn("Capabilities.decode")(function* (
  text: string,
  source: string,
) {
  const json = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () =>
      new NfError({
        code: "invalid_catalog",
        message: `${source} is not valid JSON; pipe the orchestrator_capabilities result to 'nf policy check'`,
      }),
  });
  const decoded = decodeCapabilitiesPayload(json);
  if (Result.isFailure(decoded)) {
    return yield* new NfError({
      code: "invalid_catalog",
      message: `invalid catalog from ${source}:\n  ${formatIssuePaths(decoded.failure.issue).join("\n  ")}`,
    });
  }
  return decoded.success.providers.map(provider);
});
