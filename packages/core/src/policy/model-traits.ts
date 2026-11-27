import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { NfError, PolicyOptions } from "@nf/contracts";
import { parse } from "yaml";
import { formatIssuePaths } from "../domain/schema-errors.ts";

/** One profile a model suits: `rank` (lower is better) and the options to route it with. */
export const TraitFit = Schema.Struct({
  rank: Schema.Int,
  options: Schema.optional(PolicyOptions),
  max: Schema.optional(PolicyOptions),
});
export type TraitFit = typeof TraitFit.Type;

export const ModelTrait = Schema.Struct({
  /** Glob over the catalog model id (`*` matches any run); the first matching entry wins. */
  pattern: Schema.String,
  family: Schema.String,
  /** The model's id in OpenRouter's public catalog, for prices LiteLLM does not carry. */
  openrouter: Schema.optional(Schema.String),
  reasoning: Schema.Boolean,
  reasoning_options: Schema.Array(Schema.String),
  context_window: Schema.NullOr(Schema.Int),
  profiles: Schema.Record(Schema.String, TraitFit),
});
export type ModelTrait = typeof ModelTrait.Type;

export const ModelTraits = Schema.Struct({
  version: Schema.Literal(1),
  profiles: Schema.Array(Schema.String),
  /** Candidates a proposal tops a profile up to; existing candidates are never removed. */
  limit: Schema.Int,
  models: Schema.Array(ModelTrait),
});
export type ModelTraits = typeof ModelTraits.Type;

const decodeTraits = Schema.decodeUnknownResult(ModelTraits);

export const MODEL_TRAITS_FILE = fileURLToPath(new URL("./model-traits.yaml", import.meta.url));

const invalidTraits = (file: string, issues: readonly string[]) =>
  new NfError({
    code: "invalid_traits",
    message: `invalid model traits ${file}:\n  ${issues.join("\n  ")}`,
  });

/** Rules the Schema cannot express: known profiles, positive ranks, declared option names. */
function traitIssues(traits: ModelTraits): string[] {
  const issues: string[] = [];
  const profiles = new Set(traits.profiles);
  if (profiles.size !== traits.profiles.length) issues.push("profiles: duplicate profile name");
  if (traits.limit < 1) issues.push("limit: must be 1 or more");
  for (const [index, trait] of traits.models.entries()) {
    const at = `models[${index}]`;
    if (trait.pattern.trim().length === 0) issues.push(`${at}.pattern: must not be empty`);
    if (trait.openrouter !== undefined && trait.openrouter.includes(":batch"))
      issues.push(`${at}.openrouter: must not name a batch variant`);
    for (const [name, fit] of Object.entries(trait.profiles)) {
      if (!profiles.has(name)) issues.push(`${at}.profiles.${name}: not a declared profile`);
      if (fit.rank < 1) issues.push(`${at}.profiles.${name}.rank: must be 1 or more`);
      const used = [...Object.keys(fit.options ?? {}), ...Object.keys(fit.max ?? {})];
      for (const id of used)
        if (!trait.reasoning_options.includes(id))
          issues.push(`${at}.profiles.${name}: option '${id}' is not in reasoning_options`);
    }
  }
  return issues;
}

const escapePattern = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const glob = (pattern: string) =>
  new RegExp(`^${pattern.split("*").map(escapePattern).join(".*")}$`, "i");

/** The first traits entry whose pattern matches `model`, or null when the model is unclassified. */
export function matchTrait(traits: ModelTraits, model: string): ModelTrait | null {
  for (const trait of traits.models) if (glob(trait.pattern).test(model)) return trait;
  return null;
}

/** Load and validate the repo's traits table; a broken table is a rejection, never a default. */
export const loadModelTraits = Effect.fn("ModelTraits.load")(function* (
  file: string = MODEL_TRAITS_FILE,
) {
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () => invalidTraits(file, ["file cannot be read"]),
  });
  const document = yield* Effect.try({
    try: (): unknown => parse(text),
    catch: (error) =>
      invalidTraits(file, [`yaml: ${error instanceof Error ? error.message : String(error)}`]),
  });
  const decoded = decodeTraits(document);
  if (Result.isFailure(decoded))
    return yield* invalidTraits(file, formatIssuePaths(decoded.failure.issue));
  const issues = traitIssues(decoded.success);
  if (issues.length > 0) return yield* invalidTraits(file, issues);
  return decoded.success;
});
