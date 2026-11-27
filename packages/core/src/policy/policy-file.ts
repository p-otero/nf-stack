import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { SchemaError } from "effect/Schema";
import { parse } from "yaml";
import { NfError, Policy, PolicyFile, parseRouteRef, routeKey } from "@nf/contracts";
import type {
  PolicyCandidate,
  PolicyFile as PolicyFileType,
  PolicyPrices,
  ProfileEntry,
} from "@nf/contracts";
import { formatIssuePaths } from "../domain/schema-errors.ts";
import { isRecord } from "../domain/validate.ts";

/** `$NF_HOME/policy.yaml`, default `~/.nf/policy.yaml`. */
export function policyFile(home: string): string {
  return join(home, "policy.yaml");
}

const invalidPolicy = (source: string, issues: readonly string[]) =>
  new NfError({
    code: "invalid_policy",
    message: `invalid policy ${source}:\n  ${issues.join("\n  ")}`,
  });

const SECTIONS = [
  "version",
  "analysis_mode",
  "profiles",
  "disabled",
  "context_transfer",
  "recovery",
] as const;

const decodePolicy = Schema.decodeUnknownResult(PolicyFile);
const DECODE_SECTION: Record<
  (typeof SECTIONS)[number],
  (input: unknown) => Result.Result<unknown, SchemaError>
> = {
  version: Schema.decodeUnknownResult(PolicyFile.fields.version),
  analysis_mode: Schema.decodeUnknownResult(PolicyFile.fields.analysis_mode),
  profiles: Schema.decodeUnknownResult(PolicyFile.fields.profiles),
  disabled: Schema.decodeUnknownResult(PolicyFile.fields.disabled),
  context_transfer: Schema.decodeUnknownResult(PolicyFile.fields.context_transfer),
  recovery: Schema.decodeUnknownResult(PolicyFile.fields.recovery),
};

/** Decode each top-level section on its own: the parser stops at the first problem per section. */
function sectionIssues(document: unknown): string[] {
  if (!isRecord(document) || Array.isArray(document)) return [];
  const record = document;
  const issues: string[] = [];
  for (const key of SECTIONS) {
    if (!(key in record)) {
      issues.push(`${key}: Missing key`);
      continue;
    }
    const decoded = DECODE_SECTION[key](record[key]);
    if (Result.isFailure(decoded)) issues.push(...formatIssuePaths(decoded.failure.issue, key));
  }
  return issues;
}

const isCandidateList = (entry: ProfileEntry): entry is readonly PolicyCandidate[] =>
  Array.isArray(entry);

const entryCandidates = (entry: ProfileEntry): readonly PolicyCandidate[] =>
  isCandidateList(entry) ? entry : entry.candidates;

/** Path prefix of a profile's candidate list, matching how the file wrote the profile. */
const entryPath = (name: string, entry: ProfileEntry): string =>
  isCandidateList(entry) ? `profiles.${name}` : `profiles.${name}.candidates`;

/** Extra rules the Schema cannot express, reported with the same `path: message` shape. */
function policyIssues(policy: PolicyFileType): string[] {
  const issues: string[] = [];
  const profiles = Object.entries(policy.profiles);
  if (profiles.length === 0) issues.push("profiles: must define at least one profile");
  for (const [name, entry] of profiles) {
    const candidates = entryCandidates(entry);
    const at = entryPath(name, entry);
    if (candidates.length === 0) issues.push(`profiles.${name}: must list at least one candidate`);
    const seen = new Set<string>();
    for (const [index, candidate] of candidates.entries()) {
      const key = routeKey(candidate.provider, candidate.model);
      if (seen.has(key)) issues.push(`${at}[${index}]: duplicate route ${key}`);
      seen.add(key);
    }
    if (isCandidateList(entry)) continue;
    for (const cap of ["max_input_per_m", "max_output_per_m"] as const) {
      const value = entry[cap];
      if (value !== undefined && !(Number.isFinite(value) && value > 0))
        issues.push(`profiles.${name}.${cap}: must be a price above 0, got ${String(value)}`);
    }
    for (const [index, model] of (entry.models ?? []).entries()) {
      if (model.trim().length === 0)
        issues.push(`profiles.${name}.models[${index}]: must not be empty`);
    }
  }
  for (const [index, entry] of policy.disabled.entries()) {
    if (!parseRouteRef(entry))
      issues.push(`disabled[${index}]: expected provider:model, got '${entry}'`);
  }
  return issues;
}

/** Give every profile the same shape: a bare candidate list means a profile without rules. */
function normalizePolicy(file: PolicyFileType): Policy {
  const profiles = Object.entries(file.profiles).map(
    ([name, entry]) => [name, isCandidateList(entry) ? { candidates: entry } : entry] as const,
  );
  return { ...file, profiles: Object.fromEntries(profiles) };
}

const yamlErrorLine = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.split("\n")[0] ?? "invalid YAML";
};

const readYaml = (text: string, source: string) =>
  Effect.try({
    try: (): unknown => parse(text),
    catch: (error) => invalidPolicy(source, [`yaml: ${yamlErrorLine(error)}`]),
  });

/** Parse and validate policy YAML; every problem is reported as a `path: message` line. */
export const parsePolicy = Effect.fn("Policy.parse")(function* (text: string, source: string) {
  const document = yield* readYaml(text, source);
  const decoded = decodePolicy(document);
  if (Result.isFailure(decoded)) {
    const issues = sectionIssues(document);
    return yield* invalidPolicy(
      source,
      issues.length > 0 ? issues : formatIssuePaths(decoded.failure.issue),
    );
  }
  const issues = policyIssues(decoded.success);
  if (issues.length > 0) return yield* invalidPolicy(source, issues);
  return normalizePolicy(decoded.success);
});

/** The machine policy, or a rejection that says how to create it. */
export const loadPolicy = Effect.fn("Policy.load")(function* (home: string) {
  const file = policyFile(home);
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () =>
      new NfError({
        code: "no_policy",
        message: `${file} not found; run 'nf policy propose --init' to create it from the catalog`,
      }),
  });
  return yield* parsePolicy(text, file);
});

/** The manual price overrides of the machine policy; a missing file has none. */
export const loadPolicyPrices = Effect.fn("Policy.loadPrices")(function* (home: string) {
  const file = policyFile(home);
  if (!existsSync(file)) return {} satisfies PolicyPrices;
  const policy = yield* parsePolicy(readFileSync(file, "utf8"), file);
  return policy.prices ?? {};
});

/** The repo template, as `nf policy show`, `propose --init` and `apply` read it. */
export const readPolicyTemplate = Effect.fn("Policy.readTemplate")(function* (file: string) {
  return yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () =>
      new NfError({ code: "no_template", message: `policy template ${file} cannot be read` }),
  });
});

/**
 * Copy the repo template to `$NF_HOME/policy.yaml` when it is missing. The template path is
 * resolved by the caller (the CLI knows its checkout); existing files are never touched.
 */
export const ensurePolicyFile = Effect.fn("Policy.ensureFile")(function* (
  home: string,
  template: string,
) {
  const file = policyFile(home);
  if (existsSync(file)) return { file, created: false };
  if (!existsSync(template))
    return yield* new NfError({
      code: "no_template",
      message: `policy template ${template} is missing from this nf checkout`,
    });
  yield* Effect.sync(() => {
    mkdirSync(home, { recursive: true });
    copyFileSync(template, file);
  });
  return { file, created: true };
});
