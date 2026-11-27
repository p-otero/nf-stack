import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Document } from "yaml";
import { NfError, parseRouteRef, routeKey } from "@nf/contracts";
import type { Policy, PolicyCandidate } from "@nf/contracts";
import { formatIssuePaths } from "../domain/schema-errors.ts";
import { utcStamp } from "../system/home.ts";
import { PROFILE_ACTION, candidateData, contentHash, PolicyProposal } from "./policy-proposal.ts";
import type { ProposalCandidate } from "./policy-proposal.ts";
import { isWritten } from "./policy-plan.ts";
import { parsePolicy, policyFile, readPolicyTemplate } from "./policy-file.ts";

const invalidProposal = (source: string, issues: readonly string[]) =>
  new NfError({
    code: "invalid_proposal",
    message: `invalid proposal ${source}:\n  ${issues.join("\n  ")}`,
  });

const decodeProposal = Schema.decodeUnknownResult(PolicyProposal);

const setFlowDeep = (node: unknown): void => {
  if (isMap(node)) {
    node.flow = true;
    for (const item of node.items) setFlowDeep(item.value);
  } else if (isSeq(node)) {
    node.flow = true;
    for (const item of node.items) setFlowDeep(item);
  }
};

/** The value node stored under `key` in a YAML map, or undefined for any other node. */
function mapValue(node: unknown, key: string): unknown {
  if (!isMap(node)) return undefined;
  for (const item of node.items)
    if (isScalar(item.key) && item.key.value === key) return item.value;
  return undefined;
}

/** Keep the comments of the node a proposal replaces; yaml attaches them to the value. */
function carryComments(from: unknown, to: unknown): void {
  if (!isMap(from) && !isSeq(from) && !isScalar(from)) return;
  if (!isMap(to) && !isSeq(to) && !isScalar(to)) return;
  if (from.comment) to.comment = from.comment;
  if (from.commentBefore) to.commentBefore = from.commentBefore;
  if (from.spaceBefore) to.spaceBefore = true;
}

/** The profile key stays on its own line; each candidate becomes one readable flow mapping. */
function setProfileCandidates(
  document: Document,
  name: string,
  candidates: readonly ProposalCandidate[],
): void {
  const profile = mapValue(mapValue(document.contents, "profiles"), name);
  const current = isMap(profile) ? mapValue(profile, "candidates") : profile;
  const sequence = document.createNode(candidates.map(candidateValue));
  if (isSeq(sequence)) for (const item of sequence.items) setFlowDeep(item);
  carryComments(current, sequence);
  document.setIn(isMap(profile) ? ["profiles", name, "candidates"] : ["profiles", name], sequence);
}

function candidateValue(candidate: ProposalCandidate): Record<string, unknown> {
  return {
    provider: candidate.provider,
    model: candidate.model,
    ...(candidate.options === undefined ? {} : { options: candidate.options }),
    ...(candidate.max_options === undefined ? {} : { max_options: candidate.max_options }),
    ...(candidate.pinned === true ? { pinned: true } : {}),
  };
}

function pinnedConflict(file: string, profile: string, index: number, candidate: PolicyCandidate) {
  return new NfError({
    code: "pinned_conflict",
    message: `proposal would change the pinned candidate ${profile}[${index}] (${routeKey(candidate.provider, candidate.model)}) in ${file}; unpin it or edit the policy by hand`,
  });
}

/** A timestamped copy name that never overwrites an earlier backup of the same second. */
function backupPath(file: string, now: Date): string {
  const base = `${file}.bak-${utcStamp(now)}`;
  if (!existsSync(base)) return base;
  for (let attempt = 2; ; attempt++) {
    const candidate = `${base}-${attempt}`;
    if (!existsSync(candidate)) return candidate;
  }
}

export interface ApplyResult {
  file: string;
  /** Timestamped copy of the previous policy file; null when the proposal created it. */
  backup: string | null;
  profiles: string[];
  disabled: readonly string[];
  policy: Policy;
}

/**
 * Write a proposal to `$NF_HOME/policy.yaml`: only with an unchanged file (content hash), never
 * touching pinned candidates, keeping comments and unknown keys through the YAML document API.
 */
export const applyPolicy = Effect.fn("Policy.apply")(function* (input: {
  home: string;
  template: string;
  text: string;
  source: string;
  now: Date;
}) {
  const json = yield* Effect.try({
    try: (): unknown => JSON.parse(input.text),
    catch: () => invalidProposal(input.source, ["not valid JSON"]),
  });
  const decoded = decodeProposal(json);
  if (Result.isFailure(decoded))
    return yield* invalidProposal(input.source, formatIssuePaths(decoded.failure.issue));
  const proposal = decoded.success;
  const file = policyFile(input.home);
  if (resolve(file) !== resolve(proposal.policy_file))
    return yield* new NfError({
      code: "foreign_proposal",
      message: `proposal ${input.source} targets ${proposal.policy_file}, not ${file}`,
    });

  const currentText = existsSync(file) ? readFileSync(file, "utf8") : null;
  const currentHash = currentText === null ? null : contentHash(currentText);
  if (currentHash !== proposal.policy_hash)
    return yield* new NfError({
      code: "policy_stale",
      message: `${file} changed since the proposal was made; run 'nf policy propose' again`,
    });

  const current = currentText === null ? null : yield* parsePolicy(currentText, file);
  for (const [name, profile] of Object.entries(current?.profiles ?? {})) {
    const target = proposal.profiles.find((entry) => entry.name === name);
    // A proposal keeps every remove entry in its slot, so a pinned candidate's index in the
    // written list is the index it had in the policy.
    for (const [index, candidate] of profile.candidates.entries()) {
      if (candidate.pinned !== true) continue;
      const kept = target?.candidates[index];
      if (!kept || candidateData(kept) !== candidateData(candidate))
        return yield* pinnedConflict(file, name, index, candidate);
    }
  }

  const baseText = currentText ?? (yield* readPolicyTemplate(input.template));
  const document = parseDocument(baseText);
  const firstError = document.errors[0];
  if (firstError) return yield* invalidProposal(file, [`yaml: ${firstError.message}`]);

  const profiles: string[] = [];
  for (const profile of proposal.profiles) {
    if (profile.action === PROFILE_ACTION.UNCHANGED) continue;
    setProfileCandidates(document, profile.name, profile.candidates.filter(isWritten));
    profiles.push(profile.name);
  }

  for (const key of proposal.disabled_add)
    if (!parseRouteRef(key))
      return yield* invalidProposal(input.source, [
        `disabled_add: expected provider:model, got '${key}'`,
      ]);
  if (proposal.disabled_add.length > 0) {
    const merged = [...(current?.disabled ?? [])];
    for (const key of proposal.disabled_add) if (!merged.includes(key)) merged.push(key);
    document.setIn(["disabled"], merged);
  }

  const text = document.toString({ lineWidth: 0 });
  const policy = yield* parsePolicy(text, file);
  const backup = currentText === null ? null : backupPath(file, input.now);
  yield* Effect.sync(() => {
    if (backup !== null) copyFileSync(file, backup);
    const temp = `${file}.tmp`;
    writeFileSync(temp, text);
    renameSync(temp, file);
  });
  return {
    file,
    backup,
    profiles,
    disabled: proposal.disabled_add,
    policy,
  } satisfies ApplyResult;
});
