import * as Schema from "effect/Schema";
import { Strategy, TaskStatus } from "./task.ts";

export const ATTEMPT_KIND = {
  IMPLEMENTATION: "implementation",
  INTEGRATION: "integration",
  RESEARCH: "research",
  DESIGN: "design",
  REVIEW: "review",
} as const;
export type AttemptKind = (typeof ATTEMPT_KIND)[keyof typeof ATTEMPT_KIND];
export const ATTEMPT_KINDS: readonly AttemptKind[] = Object.values(ATTEMPT_KIND);
export const AttemptKind = Schema.Literals(Object.values(ATTEMPT_KIND));

/** Kinds that write product code: at most one live attempt per task. */
export const WRITING_KINDS: readonly AttemptKind[] = [
  ATTEMPT_KIND.IMPLEMENTATION,
  ATTEMPT_KIND.INTEGRATION,
];

export const ATTEMPT_STATUS = {
  DISPATCHING: "dispatching",
  ACTIVE: "active",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SUPERSEDED: "superseded",
  UNKNOWN: "unknown",
} as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[keyof typeof ATTEMPT_STATUS];
export const ATTEMPT_STATUSES: readonly AttemptStatus[] = Object.values(ATTEMPT_STATUS);
export const AttemptStatus = Schema.Literals(Object.values(ATTEMPT_STATUS));

export const LIVE_ATTEMPT_STATUSES = [
  ATTEMPT_STATUS.DISPATCHING,
  ATTEMPT_STATUS.ACTIVE,
  ATTEMPT_STATUS.UNKNOWN,
] as const;
export type LiveAttemptStatus = (typeof LIVE_ATTEMPT_STATUSES)[number];

export const FINAL_ATTEMPT_STATUSES = [
  ATTEMPT_STATUS.SUCCEEDED,
  ATTEMPT_STATUS.FAILED,
  ATTEMPT_STATUS.CANCELLED,
  ATTEMPT_STATUS.SUPERSEDED,
] as const;
export type FinalAttemptStatus = (typeof FINAL_ATTEMPT_STATUSES)[number];

/**
 * How a live attempt is doing on its T3 thread, read from the `statev2` projections. `null`
 * liveness means the source could not be read, not that the attempt is fine.
 */
export const ATTEMPT_LIVENESS = {
  RUNNING: "running",
  STALLED: "stalled",
  WAITING_INPUT: "waiting_input",
  FINISHED_OK: "finished_ok",
  FINISHED_FAILED: "finished_failed",
  MISSING: "missing",
} as const;
export type AttemptLiveness = (typeof ATTEMPT_LIVENESS)[keyof typeof ATTEMPT_LIVENESS];
export const AttemptLiveness = Schema.Literals(Object.values(ATTEMPT_LIVENESS));

/** Minutes without turn-item, provider-turn or message activity before a running run is stalled. */
export const DEFAULT_STALL_MINUTES = 20;

/** Failure classes `nf attempt reconcile --apply` records for a run T3 already finished. */
export const ATTEMPT_FAILURE = {
  QUOTA: "quota",
  THROTTLED: "throttled",
  AUTH: "auth",
  AVAILABILITY: "availability",
  CONTEXT_EXHAUSTED: "context_exhausted",
  CANCELLED: "cancelled",
  INTERRUPTED: "interrupted",
  ROLLED_BACK: "rolled_back",
  FAILED: "failed",
} as const;
export type AttemptFailure = (typeof ATTEMPT_FAILURE)[keyof typeof ATTEMPT_FAILURE];

export const MECHANISM = {
  DELEGATE_TASK: "delegate_task",
  T3_THREAD_LAUNCH: "t3_thread_launch",
  THREAD_SEND_REUSE: "thread_send_reuse",
  FORK: "fork",
  /** The thread that opened the task implements it itself, without a coordinator. */
  DIRECT: "direct",
} as const;
export type Mechanism = (typeof MECHANISM)[keyof typeof MECHANISM];
export const MECHANISMS: readonly Mechanism[] = Object.values(MECHANISM);
export const Mechanism = Schema.Literals(Object.values(MECHANISM));

export const CONTEXT_MODE = {
  FRESH: "fresh",
  FORK: "fork",
  REUSE: "reuse",
  COMPACT: "compact",
} as const;
export type ContextMode = (typeof CONTEXT_MODE)[keyof typeof CONTEXT_MODE];
export const CONTEXT_MODES: readonly ContextMode[] = Object.values(CONTEXT_MODE);
export const ContextMode = Schema.Literals(Object.values(CONTEXT_MODE));

export const REPORT_KIND = { CHECKPOINT: "checkpoint", RESULT: "result" } as const;
export type ReportKind = (typeof REPORT_KIND)[keyof typeof REPORT_KIND];
export const REPORT_KINDS: readonly ReportKind[] = Object.values(REPORT_KIND);
export const ReportKind = Schema.Literals(Object.values(REPORT_KIND));

export const CHECK_RESULT = { PASS: "pass", FAIL: "fail", NOT_RUN: "not_run" } as const;
export type CheckResult = (typeof CHECK_RESULT)[keyof typeof CHECK_RESULT];
export const CHECK_RESULTS: readonly CheckResult[] = Object.values(CHECK_RESULT);
export const CheckResult = Schema.Literals(Object.values(CHECK_RESULT));

export const ATTACHMENT_KIND = {
  SCREENSHOT: "screenshot",
  RECORDING: "recording",
  FILE: "file",
} as const;
export type AttachmentKind = (typeof ATTACHMENT_KIND)[keyof typeof ATTACHMENT_KIND];
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = Object.values(ATTACHMENT_KIND);
export const AttachmentKind = Schema.Literals(Object.values(ATTACHMENT_KIND));

export const ATTACHMENT_THEME = { LIGHT: "light", DARK: "dark" } as const;
export type AttachmentTheme = (typeof ATTACHMENT_THEME)[keyof typeof ATTACHMENT_THEME];
export const ATTACHMENT_THEMES: readonly AttachmentTheme[] = Object.values(ATTACHMENT_THEME);
export const AttachmentTheme = Schema.Literals(Object.values(ATTACHMENT_THEME));

/** Files above this size are refused: an artifact must stay reviewable in a snapshot. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** A screenshot is an image; a recording is a video. Other files take kind `file`. */
export const SCREENSHOT_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
export const RECORDING_EXTENSIONS: readonly string[] = [".webm", ".mp4", ".mov", ".mkv"];

const NullableString = Schema.NullOr(Schema.String);

export const AttemptCheck = Schema.Struct({
  position: Schema.Finite,
  command: Schema.String,
  result: CheckResult,
  detail: NullableString,
});
export type AttemptCheck = typeof AttemptCheck.Type;

export const Attempt = Schema.Struct({
  id: Schema.String,
  task_id: Schema.String,
  task_key: Schema.String,
  key: Schema.String,
  kind: AttemptKind,
  status: AttemptStatus,
  mechanism: Mechanism,
  environment_id: NullableString,
  thread_id: NullableString,
  thread_link: NullableString,
  t3_task_id: NullableString,
  client_request_id: NullableString,
  provider_instance_id: NullableString,
  model: NullableString,
  options: Schema.Unknown,
  executed_model: NullableString,
  profile: NullableString,
  /** How this attempt ran; inherited from the task when not given. */
  strategy: Schema.NullOr(Strategy),
  /** The coordinator thread whose turn started this attempt; NULL when unknown. */
  coordinator_thread_id: NullableString,
  /** The model of that coordinator thread's closest turn at attempt start. */
  coordinator_model: NullableString,
  reason: NullableString,
  fallbacks: Schema.Array(Schema.Unknown),
  context_mode: ContextMode,
  source_thread_id: NullableString,
  repair_of: NullableString,
  started_at: Schema.String,
  ended_at: NullableString,
  base_commit: NullableString,
  worktree: NullableString,
  branch: NullableString,
  /** Recorded with `nf attempt update --pr`; absent when no pull request is known. */
  pr_url: Schema.optionalKey(NullableString),
  commits: Schema.Array(Schema.String),
  diff_location: NullableString,
  outcome: NullableString,
  failure_class: NullableString,
  failure_detail: NullableString,
  retry_at: NullableString,
  last_verified: NullableString,
  remaining: NullableString,
  checks: Schema.Array(AttemptCheck),
});
export type Attempt = typeof Attempt.Type;

export const AttemptAttachment = Schema.Struct({
  id: Schema.String,
  attempt_id: Schema.String,
  attempt_key: Schema.String,
  kind: AttachmentKind,
  /** Set for a themed screenshot, so a light and a dark capture of the same screen pair up. */
  theme: Schema.NullOr(AttachmentTheme),
  name: Schema.String,
  /** Absolute path of the copied file in `$NF_HOME/artifacts`. */
  path: Schema.String,
  bytes: Schema.Finite,
  sha256: Schema.String,
  created_at: Schema.String,
});
export type AttemptAttachment = typeof AttemptAttachment.Type;

export const Report = Schema.Struct({
  id: Schema.String,
  attempt_id: Schema.String,
  attempt_key: Schema.String,
  kind: ReportKind,
  body: Schema.String,
  created_at: Schema.String,
});
export type Report = typeof Report.Type;

/** The thread and latest run an attempt's liveness was judged from. */
export const AttemptLivenessView = Schema.Struct({
  attempt: Schema.String,
  task: Schema.String,
  /** Attempt status when classified, before any `--apply` change. */
  status: AttemptStatus,
  liveness: Schema.NullOr(AttemptLiveness),
  thread_id: NullableString,
  run_id: NullableString,
  run_status: NullableString,
  run_requested_at: NullableString,
  last_activity_at: NullableString,
  /** The first unresolved question of the judged run, when there is one. */
  waiting_input: Schema.NullOr(Schema.Struct({ kind: Schema.String, created_at: Schema.String })),
  /** The run's terminal error, from its newest error turn item. */
  failure: Schema.NullOr(
    Schema.Struct({
      class: Schema.String,
      message: NullableString,
    }),
  ),
  /** One line of observable evidence for the class. */
  evidence: Schema.String,
  /** The same verdict in a person's terms, for the board's explanation. */
  reason: Schema.String,
  /** Status `--apply` moved the attempt to, or null when it changed nothing. */
  applied_status: NullableString,
});
export type AttemptLivenessView = typeof AttemptLivenessView.Type;

/** One attempt status change `--apply` made, or would make when read-only. */
export const AttemptLivenessChange = Schema.Struct({
  attempt: Schema.String,
  from: AttemptStatus,
  to: AttemptStatus,
  liveness: AttemptLiveness,
});
export type AttemptLivenessChange = typeof AttemptLivenessChange.Type;

export const AttemptLivenessReport = Schema.Struct({
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  applied: Schema.Boolean,
  stall_minutes: Schema.Finite,
  attempts: Schema.Array(AttemptLivenessView),
  /** What `--apply` changed; when read-only, what it would change. */
  changes: Schema.Array(AttemptLivenessChange),
  /** Missing or unreadable projections that limited the judgement. */
  warnings: Schema.Array(Schema.String),
});
export type AttemptLivenessReport = typeof AttemptLivenessReport.Type;

const TaskRef = Schema.Struct({ key: Schema.String, title: Schema.String });

export const StatusSummary = Schema.Struct({
  counts: Schema.Record(TaskStatus, Schema.Finite),
  total: Schema.Finite,
  live_attempts: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      task: Schema.String,
      kind: AttemptKind,
      status: AttemptStatus,
      thread_id: NullableString,
      started_at: Schema.String,
      /** From `statev2`; null when the source could not be read. */
      liveness: Schema.optionalKey(Schema.NullOr(AttemptLiveness)),
      last_activity_at: Schema.optionalKey(NullableString),
    }),
  ),
  ready: Schema.Array(TaskRef),
  proposals: Schema.Array(TaskRef),
});
export type StatusSummary = typeof StatusSummary.Type;
