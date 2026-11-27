/** Props contract of the AgentTaskBoard (Eskais UI): the board receives these view types only and
 * knows nothing about SQLite, T3 or NF. */
import * as Schema from "effect/Schema";
import { AttemptStatus, CheckResult, ContextMode } from "./attempt.ts";
import { AcceptanceResult, AnalysisMode, TaskStatus } from "./task.ts";

export const QUALITY = {
  MEASURED: "measured",
  ESTIMATED: "estimated",
  DERIVED: "derived",
  UNKNOWN: "unknown",
} as const;
export type Quality = (typeof QUALITY)[keyof typeof QUALITY];
export const Quality = Schema.Literals(Object.values(QUALITY));

/** `value` is null exactly when `quality` is `unknown`. */
export const Quantity = Schema.Struct({
  value: Schema.NullOr(Schema.Finite),
  quality: Quality,
  source: Schema.optionalKey(Schema.String),
});
export type Quantity = typeof Quantity.Type;

export const AgentRef = Schema.Struct({
  provider: Schema.String,
  /** Exact model id, e.g. "zai/glm-5.3". */
  model: Schema.String,
  /** Provider-specific effort option, e.g. { name: "thinking", value: "high" }. */
  effort: Schema.optionalKey(Schema.Struct({ name: Schema.String, value: Schema.String })),
  /** Machine, when not the local one. */
  environment: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
});
export type AgentRef = typeof AgentRef.Type;

export const UsageSummary = Schema.Struct({
  inputTokens: Quantity,
  outputTokens: Quantity,
  cacheReadTokens: Quantity,
  cacheWriteTokens: Quantity,
  reasoningTokens: Quantity,
  /** API-equivalent cost, usually `estimated`. */
  costUsd: Quantity,
  durationMs: Schema.optionalKey(Quantity),
  activeMs: Schema.optionalKey(Quantity),
});
export type UsageSummary = typeof UsageSummary.Type;

/** `href` may use a custom scheme (t3-thread://). */
export const ThreadRef = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.String),
  href: Schema.optionalKey(Schema.String),
});
export type ThreadRef = typeof ThreadRef.Type;

export const LIVENESS = {
  RUNNING: "running",
  IDLE: "idle",
  WAITING_INPUT: "waiting_input",
  SUSPECT_DEAD: "suspect_dead",
  FINISHED: "finished",
} as const;
export type Liveness = (typeof LIVENESS)[keyof typeof LIVENESS];
export const Liveness = Schema.Literals(Object.values(LIVENESS));

export const AttemptView = Schema.Struct({
  /** "T-014-A2" */
  id: Schema.String,
  /** One of the attempt kinds, or a future kind. */
  kind: Schema.String,
  status: AttemptStatus,
  profile: Schema.optionalKey(Schema.String),
  configured: AgentRef,
  /** What ran, when it differs or is known. */
  executed: Schema.optionalKey(AgentRef),
  /** Routes discarded before this one. */
  fallbacks: Schema.optionalKey(
    Schema.Array(Schema.Struct({ agent: AgentRef, reason: Schema.String })),
  ),
  contextMode: Schema.optionalKey(ContextMode),
  /** Origin thread for reuse/fork. */
  sourceThread: Schema.optionalKey(ThreadRef),
  reason: Schema.optionalKey(Schema.String),
  repairOf: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(ThreadRef),
  /** ISO 8601 UTC. */
  startedAt: Schema.String,
  endedAt: Schema.optionalKey(Schema.String),
  liveness: Schema.optionalKey(Liveness),
  /** Why the board shows that liveness, from T3's projections; absent without a verdict. */
  livenessEvidence: Schema.optionalKey(Schema.String),
  lastActivityAt: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(UsageSummary),
  checks: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        result: CheckResult,
        note: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  commits: Schema.optionalKey(Schema.Array(Schema.String)),
  blocker: Schema.optionalKey(
    Schema.Struct({
      kind: Schema.String,
      summary: Schema.String,
      retryAt: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type AttemptView = typeof AttemptView.Type;

export const ATTACHMENT_VIEW_KIND = { IMAGE: "image", FILE: "file" } as const;
export type AttachmentViewKind = (typeof ATTACHMENT_VIEW_KIND)[keyof typeof ATTACHMENT_VIEW_KIND];
export const AttachmentViewKind = Schema.Literals(Object.values(ATTACHMENT_VIEW_KIND));

/** An attachment as the board shows it: `src`/`thumbnail` for the image, `href` for the file. */
export const AttachmentView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: AttachmentViewKind,
  src: Schema.String,
  /** The same screen captured in dark theme. */
  srcDark: Schema.optionalKey(Schema.String),
  thumbnail: Schema.optionalKey(Schema.String),
  thumbnailDark: Schema.optionalKey(Schema.String),
  alt: Schema.String,
  /** Absolute `file://` URL of the full-size file. */
  href: Schema.optionalKey(Schema.String),
});
export type AttachmentView = typeof AttachmentView.Type;

export const TASK_LINK_KIND = {
  PULL_REQUEST: "pull-request",
  BRANCH: "branch",
  COMMIT: "commit",
  ISSUE: "issue",
  EXTERNAL: "external",
} as const;
export type TaskLinkKind = (typeof TASK_LINK_KIND)[keyof typeof TASK_LINK_KIND];
export const TASK_LINK_KINDS: readonly TaskLinkKind[] = Object.values(TASK_LINK_KIND);
export const TaskLinkKind = Schema.Literals(Object.values(TASK_LINK_KIND));

export const TASK_LINK_STATE = {
  DRAFT: "draft",
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
} as const;
export type TaskLinkState = (typeof TASK_LINK_STATE)[keyof typeof TASK_LINK_STATE];
export const TASK_LINK_STATES: readonly TaskLinkState[] = Object.values(TASK_LINK_STATE);
export const TaskLinkState = Schema.Literals(Object.values(TASK_LINK_STATE));

/** A pull request, branch, commit, issue or page about the task. */
export const TaskLink = Schema.Struct({
  kind: TaskLinkKind,
  href: Schema.String,
  label: Schema.String,
  state: Schema.optionalKey(TaskLinkState),
});
export type TaskLink = typeof TaskLink.Type;

/** Stage ids of the default progression; a project config replaces `merged` with its environments. */
export const LOCATION_STAGE = { BRANCH: "branch", PR: "pr", MERGED: "merged" } as const;
export type LocationStage = (typeof LOCATION_STAGE)[keyof typeof LOCATION_STAGE];

/** Where the task's code is: the stage id, and the page that shows it. */
export const TaskLocation = Schema.Struct({
  stage: Schema.String,
  href: Schema.optionalKey(Schema.String),
});
export type TaskLocation = typeof TaskLocation.Type;

/** One stage of the project's progression, in order. */
export const TaskStage = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  tone: Schema.optionalKey(Schema.String),
});
export type TaskStage = typeof TaskStage.Type;

export const TaskView = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  goal: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.String),
  status: TaskStatus,
  /** Derived; only meaningful for `todo`. */
  ready: Schema.optionalKey(Schema.Boolean),
  profile: Schema.optionalKey(Schema.String),
  analysisMode: Schema.optionalKey(AnalysisMode),
  dependsOn: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.optionalKey(Schema.String),
      status: TaskStatus,
    }),
  ),
  acceptance: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      result: AcceptanceResult,
      evidence: Schema.optionalKey(Schema.String),
    }),
  ),
  attempts: Schema.Array(AttemptView),
  activeAttemptId: Schema.optionalKey(Schema.String),
  decisionNeeded: Schema.optionalKey(Schema.String),
  /** A `ui` task's change size, e.g. "small (42 lines, 2 files)"; `large` needs the user. */
  uiChange: Schema.optionalKey(Schema.String),
  /** A `ui` task in `review`: acceptance waits for the user's approval, which the board can record. */
  awaitingApproval: Schema.optionalKey(Schema.Boolean),
  /** Task total, repairs and reviews included. */
  usage: Schema.optionalKey(UsageSummary),
  counts: Schema.optionalKey(
    Schema.Struct({
      attempts: Schema.Finite,
      repairs: Schema.Finite,
      reviews: Schema.Finite,
      humanInterventions: Schema.Finite,
    }),
  ),
  acceptedFirstPass: Schema.optionalKey(Schema.Boolean),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Screenshots, recordings and files of the task's attempts, paired by name and theme. */
  attachments: Schema.optionalKey(Schema.Array(AttachmentView)),
  /** The task's pull requests, branches and commits, newest evidence first. */
  links: Schema.optionalKey(Schema.Array(TaskLink)),
  /** Absent when the task has no code yet. */
  location: Schema.optionalKey(TaskLocation),
  updatedAt: Schema.String,
});
export type TaskView = typeof TaskView.Type;
