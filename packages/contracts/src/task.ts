import * as Schema from "effect/Schema";

export const TASK_STATUS = {
  PROPOSED: "proposed",
  TODO: "todo",
  WORKING: "working",
  REVIEW: "review",
  BLOCKED: "blocked",
  DONE: "done",
  CANCELLED: "cancelled",
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];
export const TASK_STATUSES: readonly TaskStatus[] = Object.values(TASK_STATUS);
export const TaskStatus = Schema.Literals(Object.values(TASK_STATUS));

export const ANALYSIS_MODE = { REVIEW: "review", AUTONOMOUS: "autonomous" } as const;
export type AnalysisMode = (typeof ANALYSIS_MODE)[keyof typeof ANALYSIS_MODE];
export const ANALYSIS_MODES: readonly AnalysisMode[] = Object.values(ANALYSIS_MODE);
export const AnalysisMode = Schema.Literals(Object.values(ANALYSIS_MODE));

/** How the coordinator runs a task; `auto` lets it choose per task. */
export const STRATEGY = {
  DIRECT: "direct",
  PLAN: "plan",
  CHEAP: "cheap",
  REVIEW: "review",
  AUTO: "auto",
} as const;
export type Strategy = (typeof STRATEGY)[keyof typeof STRATEGY];
export const STRATEGIES: readonly Strategy[] = Object.values(STRATEGY);
export const Strategy = Schema.Literals(Object.values(STRATEGY));

export const ACCEPTANCE_RESULT = { PASS: "pass", FAIL: "fail", UNVERIFIED: "unverified" } as const;
export type AcceptanceResult = (typeof ACCEPTANCE_RESULT)[keyof typeof ACCEPTANCE_RESULT];
export const ACCEPTANCE_RESULTS: readonly AcceptanceResult[] = Object.values(ACCEPTANCE_RESULT);
export const AcceptanceResult = Schema.Literals(Object.values(ACCEPTANCE_RESULT));

export const ACTOR_ROLE = {
  COORDINATOR: "coordinator",
  WORKER: "worker",
  REVIEWER: "reviewer",
  USER: "user",
  SYSTEM: "system",
} as const;
export type ActorRole = (typeof ACTOR_ROLE)[keyof typeof ACTOR_ROLE];
export const ACTOR_ROLES: readonly ActorRole[] = Object.values(ACTOR_ROLE);
export const ActorRole = Schema.Literals(Object.values(ACTOR_ROLE));

/** How large a `ui` task's interface change is; `large` needs the user's approval. */
export const UI_CHANGE_SIZE = { SMALL: "small", LARGE: "large" } as const;
export type UiChangeSize = (typeof UI_CHANGE_SIZE)[keyof typeof UI_CHANGE_SIZE];

const NullableString = Schema.NullOr(Schema.String);

export const Project = Schema.Struct({
  id: Schema.String,
  machine_id: Schema.String,
  name: Schema.String,
  /** Key prefix of this project, e.g. `NF`; unique per store. */
  prefix: Schema.String,
  root_path: Schema.String,
  remote_url: NullableString,
  coordinator_environment_id: NullableString,
  coordinator_thread_id: NullableString,
  coordinator_thread_link: NullableString,
  created_at: Schema.String,
});
export type Project = typeof Project.Type;

export const AcceptanceItem = Schema.Struct({
  position: Schema.Finite,
  text: Schema.String,
  result: AcceptanceResult,
  evidence: NullableString,
});
export type AcceptanceItem = typeof AcceptanceItem.Type;

export const Task = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  key: Schema.String,
  title: Schema.String,
  goal: Schema.String,
  status: TaskStatus,
  profile: NullableString,
  analysis_mode: Schema.NullOr(AnalysisMode),
  /** NULL for tasks recorded before strategies existed. */
  strategy: Schema.NullOr(Strategy),
  /** A UI change: review needs screenshots and, when the change is large, the user's approval. */
  ui: Schema.Boolean,
  authorization: NullableString,
  decision_needed: NullableString,
  /** Free-form JSON describing the blocker (identity, cycles, checkpoint, ...). */
  blocker: Schema.Unknown,
  evidence: NullableString,
  accepted_first_pass: Schema.NullOr(Schema.Boolean),
  human_interventions: Schema.Finite,
  source: NullableString,
  design_ref: NullableString,
  /** Task key of the superseding task. */
  superseded_by: NullableString,
  created_at: Schema.String,
  updated_at: Schema.String,
  acceptance: Schema.Array(AcceptanceItem),
  depends_on: Schema.Array(Schema.String),
});
export type Task = typeof Task.Type;

export const TaskEvent = Schema.Struct({
  id: Schema.String,
  task_id: Schema.String,
  attempt_id: NullableString,
  kind: Schema.String,
  actor_role: ActorRole,
  from_status: NullableString,
  to_status: NullableString,
  note: NullableString,
  created_at: Schema.String,
});
export type TaskEvent = typeof TaskEvent.Type;

export const ImportResult = Schema.Struct({
  schema_version: Schema.Finite,
  tasks_created: Schema.Finite,
  tasks_skipped: Schema.Finite,
  attempts_created: Schema.Finite,
  attempts_skipped: Schema.Finite,
  warnings: Schema.Array(Schema.String),
});
export type ImportResult = typeof ImportResult.Type;
