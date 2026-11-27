import { routeKey, relativeAge } from "@nf/core";
import type {
  ApplyResult,
  Attempt,
  AttemptAttachment,
  AttemptLivenessReport,
  AttachmentTheme,
  LinkResult,
  Policy,
  PolicyCandidate,
  PolicyCheck,
  PolicyResolution,
  PolicyStatus,
  ProfilePolicy,
  Project,
  ProposalOverCap,
  ProposeResult,
  Report,
  RouteBlock,
  StatusSummary,
  Task,
  TaskEvent,
} from "@nf/core";

export function taskLine(t: Task, prefix = ""): string {
  const deps = t.depends_on.length > 0 ? `  (after ${t.depends_on.join(", ")})` : "";
  return `${prefix}${t.key}  ${t.status.padEnd(9)} ${t.title}${t.ui ? "  [ui]" : ""}${deps}`;
}

export function attemptLine(a: Attempt): string {
  const bits = [
    a.kind,
    a.model ? `model=${a.model}` : "",
    a.thread_id ? `thread=${a.thread_id}` : "",
  ];
  return `${a.key}  ${a.status.padEnd(11)} ${bits.filter(Boolean).join(" ")}`;
}

export function attachmentLine(a: AttemptAttachment): string {
  return `${a.kind}${a.theme === null ? "" : ` ${a.theme}`}  ${a.name}  ${a.bytes}B  ${a.path}`;
}

/** The evidence a `ui` task needs, on stderr so the key line on stdout stays parseable. */
export function uiEvidenceHint(attemptKey: string, themes: readonly AttachmentTheme[]): string {
  const commands = themes.map(
    (theme) =>
      `  nf attempt attach ${attemptKey} --file <screen>-${theme}.png --kind screenshot --theme ${theme} --name <screen>`,
  );
  return [
    `ui task: attach a screenshot of every changed screen, state and component, once per project theme (${themes.join(", ")})`,
    ...commands,
  ].join("\n");
}

function kv(label: string, value: string | number | boolean | null | undefined): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : `${label}: ${String(value)}`;
}

function lines(...parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null).join("\n");
}

export function taskDetail(
  t: Task,
  attempts: Attempt[],
  events?: TaskEvent[],
  uiChange?: string | null,
): string {
  const meta = [
    kv("profile", t.profile),
    kv("mode", t.analysis_mode),
    kv("strategy", t.strategy ?? "—"),
    t.ui ? "ui: yes" : null,
    kv("first-pass", t.accepted_first_pass),
    t.human_interventions > 0 ? `interventions: ${t.human_interventions}` : null,
  ].filter(Boolean);
  const acc = t.acceptance.map(
    (a) => `  ${a.position}. [${a.result}] ${a.text}${a.evidence ? `  -- ${a.evidence}` : ""}`,
  );
  const out = [
    `${t.key}  ${t.status}  ${t.title}`,
    `goal: ${t.goal}`,
    meta.length > 0 ? meta.join("  ") : null,
    kv("ui change", uiChange),
    kv("depends on", t.depends_on.join(", ")),
    kv("superseded by", t.superseded_by),
    kv("authorization", t.authorization),
    kv("decision needed", t.decision_needed),
    t.blocker !== null ? `blocker: ${JSON.stringify(t.blocker)}` : null,
    kv("source", t.source),
    kv("design", t.design_ref),
    "acceptance:",
    ...acc,
    attempts.length > 0 ? "attempts:" : null,
    ...attempts.map((a) => `  ${attemptLine(a)}`),
    kv("evidence", t.evidence),
  ];
  if (events) {
    out.push("events:");
    for (const e of events) {
      const move =
        e.from_status || e.to_status
          ? ` ${e.from_status ? `${e.from_status} ` : ""}-> ${e.to_status ?? ""}`
          : "";
      out.push(`  ${e.created_at} ${e.actor_role} ${e.kind}${move}${e.note ? `  ${e.note}` : ""}`);
    }
  }
  return lines(...out);
}

export function attemptDetail(a: Attempt, reports: Report[] | null): string {
  const out = [
    `${a.key}  ${a.status}  ${a.kind}  (${a.mechanism}, ${a.context_mode})`,
    kv("model", [a.provider_instance_id, a.model].filter(Boolean).join("/")),
    kv("executed model", a.executed_model),
    kv("profile", a.profile),
    kv("strategy", a.strategy ?? "—"),
    kv("reason", a.reason),
    kv("thread", a.thread_id),
    kv("thread link", a.thread_link),
    kv("t3 task", a.t3_task_id),
    kv("worktree", a.worktree),
    kv("branch", a.branch),
    kv("pr", a.pr_url ?? null),
    kv("base", a.base_commit),
    a.commits.length > 0 ? `commits: ${a.commits.join(", ")}` : null,
    kv("diff", a.diff_location),
    kv("repair of", a.repair_of),
    kv("started", a.started_at),
    kv("ended", a.ended_at),
    kv("outcome", a.outcome),
    kv("failure", [a.failure_class, a.failure_detail].filter(Boolean).join(": ")),
    kv("retry at", a.retry_at),
    kv("last verified", a.last_verified),
    kv("remaining", a.remaining),
    ...a.checks.map(
      (c) => `check ${c.position}: ${c.command} -> ${c.result}${c.detail ? ` (${c.detail})` : ""}`,
    ),
  ];
  if (reports) {
    out.push(`reports: ${reports.length}`);
    for (const r of reports) out.push(`--- ${r.kind} ${r.created_at}`, r.body);
  }
  return lines(...out);
}

export function statusText(project: Project, s: StatusSummary): string {
  const counts = Object.entries(s.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  const out = [
    `${project.name}  ${project.root_path}`,
    `tasks ${s.total}${counts ? `: ${counts}` : ""}`,
    s.live_attempts.length > 0
      ? `live attempts:\n${s.live_attempts
          .map(
            (a) =>
              `  ${a.key}  ${a.status} ${a.kind}${a.thread_id ? ` thread=${a.thread_id}` : ""} liveness=${a.liveness ?? "unknown"}`,
          )
          .join("\n")}`
      : "live attempts: none",
    s.ready.length > 0
      ? `ready:\n${s.ready.map((t) => `  ${t.key}  ${t.title}`).join("\n")}`
      : "ready: none",
    s.proposals.length > 0
      ? `awaiting approval:\n${s.proposals.map((t) => `  ${t.key}  ${t.title}`).join("\n")}`
      : null,
  ];
  return lines(...out);
}

function livenessLine(attempt: AttemptLivenessReport["attempts"][number]): string[] {
  return [
    `${attempt.attempt}  ${attempt.status.padEnd(11)} ${(attempt.liveness ?? "unknown").padEnd(13)} last activity ${attempt.last_activity_at ?? "—"}`,
    `  ${attempt.evidence}`,
    `  task ${attempt.task}  thread ${attempt.thread_id ?? "—"}  run ${attempt.run_id ?? "—"}`,
  ];
}

/** `nf attempt reconcile`: per-attempt liveness with its evidence, then what --apply did. */
export function livenessText(project: Project, report: AttemptLivenessReport): string {
  const out = [
    `${project.name}  ${project.root_path}  stall ${report.stall_minutes}m  ${report.applied ? "applied" : "read-only"}`,
    ...(report.attempts.length === 0
      ? ["no live attempts"]
      : report.attempts.flatMap((attempt) => livenessLine(attempt))),
    ...report.warnings.map((warning) => `warning: ${warning}`),
  ];
  if (report.changes.length > 0) {
    out.push(
      "",
      `${report.applied ? "applied" : "would apply"} ${report.changes.length} change${report.changes.length === 1 ? "" : "s"}:`,
    );
    for (const change of report.changes) {
      out.push(`  ${change.attempt}  ${change.from} -> ${change.to}  (${change.liveness})`);
    }
    if (!report.applied) out.push("rerun with --apply to record them");
  } else if (report.applied) {
    out.push("", "no changes");
  }
  return out.join("\n");
}

export function candidateText(candidate: PolicyCandidate): string {
  const options = Object.entries(candidate.options ?? {})
    .map(([id, value]) => `${id}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(",");
  return `${candidate.provider} ${candidate.model}${options ? ` (${options})` : ""}`;
}

export function policyText(policy: Policy): string {
  const head = `policy v${policy.version} · analysis ${policy.analysis_mode} · ${Object.keys(policy.profiles).length} profiles · ${policy.disabled.length} disabled`;
  return [
    head,
    ...Object.entries(policy.profiles).map(([name, entry]) => profileText(name, entry)),
  ].join("\n");
}

/** The rules after a profile's candidates, e.g. ` · max output $15/M · needs approval`. */
function profileRulesText(profile: ProfilePolicy): string {
  const rules = [
    profile.max_input_per_m === undefined ? null : `max input $${profile.max_input_per_m}/M`,
    profile.max_output_per_m === undefined ? null : `max output $${profile.max_output_per_m}/M`,
    profile.models === undefined ? null : `models: ${profile.models.join(", ")}`,
    profile.requires_approval === true ? "needs approval" : null,
  ].filter((rule): rule is string => rule !== null);
  return rules.length === 0 ? "" : ` · ${rules.join(" · ")}`;
}

export function profileText(name: string, profile: ProfilePolicy): string {
  return `${name}: ${profile.candidates.map(candidateText).join(" → ")}${profileRulesText(profile)}`;
}

export function policyCheckText(result: PolicyCheck): string {
  const routes = [
    ...result.drift.missing.map((r) => `${routeKey(r.provider, r.model)}  missing everywhere`),
    ...result.drift.elsewhere.map(
      (e) => `${routeKey(e.route.provider, e.route.model)}  only in ${e.environments.join(", ")}`,
    ),
  ];
  const environments = result.environments.length > 0 ? result.environments.join(", ") : "none";
  routes.push(
    `catalog: ${environments} · ${result.drift.missing.length} missing · ${result.drift.elsewhere.length} only elsewhere`,
  );
  return routes.join("\n");
}

export function policyStatusText(status: PolicyStatus): string {
  if (status.state === "ok" && status.age_ms !== null)
    return `policy ok · catalog checked ${relativeAge(status.age_ms)} (${status.environment}) · ${status.drift.missing.length} missing`;
  if (status.state === "stale")
    return "catalog stale (>24h) — run orchestrator_capabilities and pipe it to nf policy check";
  return "catalog never checked — run orchestrator_capabilities and pipe it to nf policy check";
}

const PROPOSAL_MARK = {
  add: "+",
  keep: "=",
  reorder: "~",
  remove: "-",
  unavailable: "!",
  over_cap: "x",
} as const;

export function policyProposalText(result: ProposeResult): string {
  const { proposal, file } = result;
  const out = [`policy proposal · ${proposal.policy_file} · catalog ${proposal.environment}`];
  for (const profile of proposal.profiles) {
    out.push(`${profile.name} · ${profile.action}`);
    for (const candidate of profile.candidates)
      out.push(
        `  ${PROPOSAL_MARK[candidate.action]} ${candidateText(candidate)}  ${candidate.reason}`,
      );
  }
  if (proposal.over_cap.length > 0) {
    out.push("over cap · never added to that profile");
    for (const entry of proposal.over_cap) out.push(overCapLine(entry));
  }
  if (proposal.unclassified.length > 0) {
    out.push("unclassified · never added automatically; add a model traits entry to rank them");
    for (const entry of proposal.unclassified) out.push(`  ${entry.provider} ${entry.model}`);
  }
  if (proposal.disabled_add.length > 0)
    out.push(`disabled add: ${proposal.disabled_add.join(", ")}`);
  const { summary } = proposal;
  const noChanges = summary.changed_profiles === 0 && summary.disabled === 0;
  out.push(
    noChanges
      ? "no changes"
      : `${summary.changed_profiles} profiles · ${summary.add} add · ${summary.reorder} reorder · ${summary.remove} remove · ${summary.unavailable} unavailable · ${summary.over_cap} over cap · ${summary.disabled} disabled`,
  );
  out.push(
    noChanges
      ? `saved ${file} · nothing to apply`
      : `saved ${file} · review the diff, then run nf policy apply`,
  );
  return out.join("\n");
}

function overCapLine(entry: ProposalOverCap): string {
  return `  ${entry.profile} ${entry.provider} ${entry.model}  ${entry.price}  ${entry.reason}`;
}

export function policyApplyText(result: ApplyResult): string {
  const backup = result.backup === null ? "created" : `backup ${result.backup}`;
  const changes =
    result.profiles.length === 0 && result.disabled.length === 0
      ? "no changes"
      : `${result.profiles.length} profiles · ${result.disabled.length} disabled`;
  return `applied ${result.file} · ${changes} · ${backup}`;
}

export function policyResolveText(result: PolicyResolution): string {
  if (result.eligible && result.target) {
    const options = JSON.stringify(
      Object.fromEntries(result.target.options.map((o) => [o.id, o.value])),
    );
    const price = result.price === null ? "" : ` · ${result.price}`;
    return `${result.profile} · ${result.eligible.provider} ${result.eligible.model} · options ${options}${price}`;
  }
  const reasons = result.verdicts.map(
    (v) => `  ${routeKey(v.candidate.provider, v.candidate.model)}  ${v.reason ?? "eligible"}`,
  );
  return [
    `no eligible candidate for profile '${result.profile}' in ${result.environment}`,
    ...reasons,
  ].join("\n");
}

export function routeBlockText(block: RouteBlock): string {
  const until = block.reset_at === null ? "no reset" : `until ${block.reset_at}`;
  const evidence = block.evidence === null ? "" : ` · ${block.evidence}`;
  return `blocked ${routeKey(block.provider_instance_id, block.model)} · ${block.reason} · ${until}${evidence}`;
}

export function routeBlockLine(block: RouteBlock, nowMs: number): string {
  const reset = block.reset_at === null ? "until unblocked" : `until ${block.reset_at}`;
  const age = relativeAge(Math.max(0, nowMs - Date.parse(block.blocked_at)));
  const expired =
    block.reset_at !== null && Date.parse(block.reset_at) <= nowMs ? "  (expired)" : "";
  return `${routeKey(block.provider_instance_id, block.model)}  ${block.reason}  blocked ${age}  ${reset}${expired}`;
}

/** One `nf skills link` or `nf setup` row: the action, its target and where that points. */
export function linkResultText(result: LinkResult): string {
  const detail = result.note === undefined ? ` -> ${result.source}` : `  (${result.note})`;
  return `${result.action.padEnd(12)} ${result.target}${detail}`;
}
