import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ATTEMPT_LIVENESS,
  ATTEMPT_STATUS,
  COST_QUALITY,
  LIVENESS,
  NfError,
  QUALITY,
  TASK_STATUS,
  TaskView,
} from "@nf/contracts";
import type {
  AttemptLiveness,
  AttemptLivenessView,
  AttemptView,
  AttachmentView,
  Liveness,
  Quantity,
  TokenFields,
  UsageSummary,
} from "@nf/contracts";
import type { Attempt, Project, Task } from "@nf/contracts";
import { attemptLiveness } from "../attempts/attempt-liveness.ts";
import { taskUiChange } from "../attempts/ui-change.ts";
import {
  attemptFallbacks,
  configuredAgent,
  executedAgent,
  threadHrefOf,
} from "./attempt-presentation.ts";
import { attachmentBudget, attachmentViews } from "./attachment-view.ts";
import { codeEvidence, locationContext } from "./code-location.ts";
import type { CodeEvidence, GitProbe } from "./code-location.ts";
import type { PullRequestSource } from "./pull-request-source.ts";
import { DEFAULT_PROJECT_CONFIG, loadProjectConfig } from "../system/project-config.ts";
import { isAggregateSourceKey } from "../domain/usage.ts";
import { isLiveAttemptStatus } from "../domain/transitions.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import { selectStatsEvents } from "../persistence/usage-queries.persistence.ts";
import type { StatsEventRow } from "../persistence/usage-queries.persistence.ts";

const RUNNING_WINDOW_MS = 10 * 60 * 1000;
const IDLE_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Tasks whose location is derived at once: enough to hide one process per question, few enough to
 * keep a large project from spawning a hundred git processes together.
 */
const LOCATION_CONCURRENCY = 8;

const decodeTaskViews = Schema.decodeEffect(Schema.Array(TaskView));

const unknown = (): Quantity => ({ value: null, quality: QUALITY.UNKNOWN });

/** A token total is known only when some event reported it: no row means unknown, never zero. */
function tokenQuantity(rows: readonly StatsEventRow[], key: keyof TokenFields): Quantity {
  let value: number | null = null;
  for (const row of rows) {
    if (isAggregateSourceKey(row.source_key)) continue;
    const tokens = row[key];
    if (tokens !== null) value = (value ?? 0) + tokens;
  }
  return value === null ? unknown() : { value, quality: QUALITY.MEASURED };
}

/**
 * Pi reports what it charged (`reported`), LiteLLM prices the rest (`estimated`). T3 subagent
 * aggregates carry no price and stay out of the sum, as in `nf stats`. An unpriced event next to
 * priced ones makes the total a floor, so it is estimated rather than measured.
 */
function costQuantity(rows: readonly StatsEventRow[]): Quantity {
  const priced = rows.filter(
    (row) => !isAggregateSourceKey(row.source_key) && row.cost_usd !== null,
  );
  if (priced.length === 0) return unknown();
  const value = Number(priced.reduce((total, row) => total + (row.cost_usd ?? 0), 0).toFixed(12));
  const unpriced = rows.some(
    (row) => !isAggregateSourceKey(row.source_key) && row.cost_usd === null,
  );
  const estimated = priced.some((row) => row.cost_quality === COST_QUALITY.ESTIMATED);
  return unpriced || estimated
    ? { value, quality: QUALITY.ESTIMATED, source: "litellm" }
    : { value, quality: QUALITY.MEASURED, source: "pi" };
}

function usageSummary(rows: readonly StatsEventRow[], durationMs?: number): UsageSummary {
  return {
    inputTokens: tokenQuantity(rows, "input_tokens"),
    outputTokens: tokenQuantity(rows, "output_tokens"),
    cacheReadTokens: tokenQuantity(rows, "cache_read_tokens"),
    cacheWriteTokens: tokenQuantity(rows, "cache_write_tokens"),
    reasoningTokens: tokenQuantity(rows, "reasoning_tokens"),
    costUsd: costQuantity(rows),
    ...(durationMs === undefined
      ? {}
      : { durationMs: { value: durationMs, quality: QUALITY.DERIVED } }),
  };
}

/**
 * The store keeps no heartbeat, so liveness follows the status and the newest usage event the
 * attempt produced: dispatching is running, a live attempt that reported usage within 10 minutes
 * is running, within 6 hours idle, and older (or an `unknown` status) suspect_dead.
 */
function attemptLivenessHeuristic(
  attempt: Attempt,
  lastActivityAt: string | undefined,
  nowMs: number,
): Liveness {
  if (!isLiveAttemptStatus(attempt.status)) return LIVENESS.FINISHED;
  if (attempt.status === ATTEMPT_STATUS.UNKNOWN) return LIVENESS.SUSPECT_DEAD;
  if (attempt.status === ATTEMPT_STATUS.DISPATCHING) return LIVENESS.RUNNING;
  const activity = Date.parse(lastActivityAt ?? attempt.started_at);
  if (Number.isNaN(activity)) return LIVENESS.SUSPECT_DEAD;
  const age = nowMs - activity;
  if (age <= RUNNING_WINDOW_MS) return LIVENESS.RUNNING;
  return age <= IDLE_WINDOW_MS ? LIVENESS.IDLE : LIVENESS.SUSPECT_DEAD;
}

/** T3's classes map onto the board's five; a gone thread needs a person, so it is suspect_dead. */
const BOARD_LIVENESS = {
  [ATTEMPT_LIVENESS.RUNNING]: LIVENESS.RUNNING,
  [ATTEMPT_LIVENESS.STALLED]: LIVENESS.SUSPECT_DEAD,
  [ATTEMPT_LIVENESS.WAITING_INPUT]: LIVENESS.WAITING_INPUT,
  [ATTEMPT_LIVENESS.FINISHED_OK]: LIVENESS.FINISHED,
  [ATTEMPT_LIVENESS.FINISHED_FAILED]: LIVENESS.FINISHED,
  [ATTEMPT_LIVENESS.MISSING]: LIVENESS.SUSPECT_DEAD,
} satisfies Record<AttemptLiveness, Liveness>;

/** Liveness from T3's projections when they were read; the recorded heuristic otherwise. */
function attemptLivenessOf(
  attempt: Attempt,
  verdict: AttemptLivenessView | undefined,
  lastActivityAt: string | undefined,
  nowMs: number,
): Liveness {
  if (!isLiveAttemptStatus(attempt.status)) return LIVENESS.FINISHED;
  if (verdict === undefined || verdict.liveness === null) {
    return attemptLivenessHeuristic(attempt, lastActivityAt, nowMs);
  }
  return BOARD_LIVENESS[verdict.liveness];
}

function lastActivity(rows: readonly StatsEventRow[]): string | undefined {
  let latest: number | null = null;
  for (const row of rows) {
    const ts = Date.parse(row.ts);
    if (Number.isNaN(ts)) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest === null ? undefined : new Date(latest).toISOString();
}

function duration(attempt: Attempt): number | undefined {
  if (!attempt.ended_at) return undefined;
  const start = Date.parse(attempt.started_at);
  const end = Date.parse(attempt.ended_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

function attemptBlocker(attempt: Attempt): AttemptView["blocker"] {
  if (attempt.status !== ATTEMPT_STATUS.FAILED) return undefined;
  const summary = attempt.failure_detail ?? attempt.outcome;
  if (!summary) return undefined;
  return {
    kind: attempt.failure_class ?? ATTEMPT_STATUS.FAILED,
    summary,
    ...(attempt.retry_at === null ? {} : { retryAt: attempt.retry_at }),
  };
}

function toAttemptView(
  attempt: Attempt,
  taskProfile: string | null,
  rows: readonly StatsEventRow[],
  verdict: AttemptLivenessView | undefined,
  nowMs: number,
  threadHref: string | undefined,
): AttemptView {
  const configured = configuredAgent(attempt);
  const executed = executedAgent(attempt, configured);
  const fallbackRoutes = attemptFallbacks(attempt);
  const activity = verdict?.last_activity_at ?? lastActivity(rows);
  const profile = attempt.profile ?? taskProfile;
  const blocker = attemptBlocker(attempt);
  const usage = rows.length === 0 ? undefined : usageSummary(rows, duration(attempt));
  return {
    id: attempt.key,
    kind: attempt.kind,
    status: attempt.status,
    ...(profile === null ? {} : { profile }),
    configured,
    ...(executed === undefined ? {} : { executed }),
    ...(fallbackRoutes.length === 0 ? {} : { fallbacks: fallbackRoutes }),
    contextMode: attempt.context_mode,
    ...(attempt.source_thread_id === null
      ? {}
      : { sourceThread: { id: attempt.source_thread_id } }),
    ...(attempt.reason === null ? {} : { reason: attempt.reason }),
    ...(attempt.repair_of === null ? {} : { repairOf: attempt.repair_of }),
    ...(attempt.thread_id === null
      ? {}
      : {
          thread: {
            id: attempt.thread_id,
            ...(threadHref === undefined ? {} : { href: threadHref }),
          },
        }),
    startedAt: attempt.started_at,
    ...(attempt.ended_at === null ? {} : { endedAt: attempt.ended_at }),
    liveness: attemptLivenessOf(attempt, verdict, activity, nowMs),
    ...(verdict === undefined ? {} : { livenessEvidence: verdict.reason }),
    ...(activity === undefined ? {} : { lastActivityAt: activity }),
    ...(usage === undefined ? {} : { usage }),
    ...(attempt.checks.length === 0
      ? {}
      : {
          checks: attempt.checks.map((check) => ({
            name: check.command,
            result: check.result,
            ...(check.detail === null ? {} : { note: check.detail }),
          })),
        }),
    ...(attempt.commits.length === 0 ? {} : { commits: attempt.commits }),
    ...(blocker === undefined ? {} : { blocker }),
  };
}

function toTaskView(input: {
  task: Task;
  project: Project;
  attempts: readonly Attempt[];
  attachments: readonly AttachmentView[];
  tasksByKey: ReadonlyMap<string, Task>;
  readyKeys: ReadonlySet<string>;
  rowsByAttempt: ReadonlyMap<string, StatsEventRow[]>;
  verdicts: ReadonlyMap<string, AttemptLivenessView>;
  nowMs: number;
  evidence: CodeEvidence;
  deepLinks: boolean;
  uiChange: string | null;
}): TaskView {
  const {
    task,
    project,
    attempts,
    attachments,
    tasksByKey,
    readyKeys,
    rowsByAttempt,
    verdicts,
    nowMs,
    evidence,
    deepLinks,
    uiChange,
  } = input;
  const rows = attempts.flatMap((attempt) => rowsByAttempt.get(attempt.id) ?? []);
  const live = attempts.findLast((attempt) => isLiveAttemptStatus(attempt.status));
  const usage = rows.length === 0 ? undefined : usageSummary(rows);
  return {
    id: task.key,
    title: task.title,
    goal: task.goal,
    project: project.name,
    status: task.status,
    ...(task.status === TASK_STATUS.TODO ? { ready: readyKeys.has(task.key) } : {}),
    ...(task.profile === null ? {} : { profile: task.profile }),
    ...(task.analysis_mode === null ? {} : { analysisMode: task.analysis_mode }),
    dependsOn: task.depends_on.flatMap((key) => {
      const dependency = tasksByKey.get(key);
      return dependency === undefined
        ? []
        : [{ id: dependency.key, title: dependency.title, status: dependency.status }];
    }),
    acceptance: task.acceptance.map((item) => ({
      text: item.text,
      result: item.result,
      ...(item.evidence === null ? {} : { evidence: item.evidence }),
    })),
    attempts: attempts.map((attempt) =>
      toAttemptView(
        attempt,
        task.profile,
        rowsByAttempt.get(attempt.id) ?? [],
        verdicts.get(attempt.key),
        nowMs,
        threadHrefOf(attempt, project, deepLinks),
      ),
    ),
    ...(live === undefined ? {} : { activeAttemptId: live.key }),
    ...(task.decision_needed === null ? {} : { decisionNeeded: task.decision_needed }),
    ...(uiChange === null ? {} : { uiChange }),
    ...(task.ui && task.status === TASK_STATUS.REVIEW ? { awaitingApproval: true } : {}),
    ...(usage === undefined ? {} : { usage }),
    counts: {
      attempts: attempts.length,
      repairs: attempts.filter((attempt) => attempt.repair_of !== null).length,
      reviews: attempts.filter((attempt) => attempt.kind === "review").length,
      humanInterventions: task.human_interventions,
    },
    ...(task.accepted_first_pass === null ? {} : { acceptedFirstPass: task.accepted_first_pass }),
    ...(task.ui ? { labels: ["UI"] } : {}),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(evidence.links.length === 0 ? {} : { links: [...evidence.links] }),
    ...(evidence.location === null ? {} : { location: evidence.location }),
    updatedAt: task.updated_at,
  };
}

export interface BoardOptions {
  /** T3 Code's `statev2.sqlite`; reading it gives live attempts T3's own liveness. */
  t3State?: string | undefined;
  /** `$NF_HOME` for the project config; without it the defaults apply and nothing is read. */
  home?: string | undefined;
  /** Reads PRs' GitHub state; default shells out to `gh` and degrades to git only. */
  readPullRequest?: PullRequestSource | undefined;
  /** Git answers from an earlier derivation; a live board passes it back instead of re-probing. */
  gitProbe?: GitProbe | undefined;
  /** URL prefix (`/artifacts`) the page reads attachments from; without it images are inlined. */
  artifactBase?: string | undefined;
}

/**
 * Liveness of the project's live attempts from T3's projections, by attempt key. A missing or
 * unreadable source leaves the map empty and the board on its recorded heuristic.
 */
const livenessVerdicts = Effect.fnUntraced(function* (
  projectId: string,
  t3State: string | undefined,
  nowMs: number,
) {
  if (t3State === undefined) return new Map<string, AttemptLivenessView>();
  const report = yield* attemptLiveness(projectId, {
    t3State,
    now: new Date(nowMs),
    bestEffort: true,
  });
  return new Map(report.attempts.map((view) => [view.attempt, view]));
});

/**
 * The board views of one project: tasks with their attempts, dependencies and usage, ready for
 * the Eskais UI AgentTaskBoard. `at` is the snapshot's "now": it dates the liveness heuristic and
 * is what the board displays as `generatedAt`. With `t3State`, live attempts get T3's own
 * liveness (running, stalled, waiting, finished, missing); without it, the recorded heuristic.
 */
export const boardViews = Effect.fn("Board.boardViews")(function* (
  projectId: string,
  at: string,
  options: BoardOptions = {},
) {
  const nowMs = Date.parse(at);
  if (Number.isNaN(nowMs)) {
    return yield* new NfError({ code: "invalid_value", message: `invalid snapshot time '${at}'` });
  }
  const store = yield* TaskStore;
  const project = yield* store.getProject(projectId);
  const config =
    options.home === undefined
      ? DEFAULT_PROJECT_CONFIG
      : yield* loadProjectConfig(options.home, project.prefix);
  const code = yield* locationContext({
    root: project.root_path,
    remoteUrl: project.remote_url,
    config,
    ...(options.readPullRequest === undefined ? {} : { pullRequest: options.readPullRequest }),
    ...(options.gitProbe === undefined ? {} : { probe: options.gitProbe }),
  });
  const tasks = yield* store.listTasks({ projectId });
  const readyKeys = new Set((yield* store.readyTasks(projectId)).map((task) => task.key));
  const attempts = yield* Effect.forEach(tasks, (task) => store.listAttempts(projectId, task.key));
  const budget = attachmentBudget();
  const [evidence, attachmentRows, verdicts, rows, uiChanges] = yield* Effect.all(
    [
      Effect.forEach(
        tasks,
        (task, index) =>
          codeEvidence(
            (attempts[index] ?? []).map((attempt) => ({
              branch: attempt.branch,
              commits: attempt.commits,
              pr_url: attempt.pr_url ?? null,
            })),
            code,
          ),
        { concurrency: LOCATION_CONCURRENCY },
      ),
      Effect.forEach(attempts, (taskAttempts) =>
        Effect.forEach(taskAttempts, (attempt) => store.listAttachments(projectId, attempt.key)),
      ),
      livenessVerdicts(projectId, options.t3State, nowMs),
      selectStatsEvents({
        kind: "attempts",
        attemptIds: attempts.flat().map((attempt) => attempt.id),
      }),
      Effect.forEach(tasks, (task, index) =>
        task.ui
          ? Effect.gen(function* () {
              const events = yield* store.listEvents(projectId, task.key);
              return yield* taskUiChange({
                root: project.root_path,
                attempts: attempts[index] ?? [],
                review: config.uiReview,
                events,
              });
            })
          : Effect.succeed(null),
      ),
    ] as const,
    { concurrency: 5 },
  );
  const rowsByAttempt = new Map<string, StatsEventRow[]>();
  for (const row of rows) {
    if (row.attempt_id === null) continue;
    const list = rowsByAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    rowsByAttempt.set(row.attempt_id, list);
  }
  const tasksByKey = new Map(tasks.map((task) => [task.key, task]));
  const views = yield* Effect.forEach(tasks, (task, index) =>
    Effect.gen(function* () {
      const attachments = yield* attachmentViews(
        (attachmentRows[index] ?? []).flat(),
        budget,
        options.artifactBase,
      );
      return toTaskView({
        task,
        project,
        attempts: attempts[index] ?? [],
        evidence: evidence[index] ?? { location: null, links: [] },
        attachments,
        tasksByKey,
        readyKeys,
        rowsByAttempt,
        verdicts,
        nowMs,
        deepLinks: config.t3DeepLinks,
        uiChange: uiChanges[index] ?? null,
      });
    }),
  );
  return yield* decodeTaskViews(views);
});
