import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";
import {
  AcceptanceResult,
  ActorRole,
  AnalysisMode,
  AttemptKind,
  AttemptStatus,
  AttachmentKind,
  AttachmentTheme,
  CheckResult,
  ContextMode,
  Mechanism,
  NfError,
  ReportKind,
  Strategy,
  TaskStatus,
} from "@nf/contracts";

export type StoreError = NfError | SqlError;

/** What every store family needs: the client, this machine's id and the wall clock. */
export interface StoreContext {
  readonly sql: SqlClient.SqlClient;
  readonly machine: string;
  readonly now: Effect.Effect<string>;
}

export interface EventExtra {
  attemptId?: string | null;
  from?: string | null;
  to?: string | null;
  note?: string | null;
}

export type Row = Record<string, unknown>;

export const fail = (code: string, message: string) => Effect.fail(new NfError({ code, message }));

export const first = <A>(rows: ReadonlyArray<A>): A | undefined => rows[0];

export const one = <A extends object = Row>(statement: Statement.Statement<A>) =>
  Effect.map(statement, first);

export const maxPlusOne = (rows: ReadonlyArray<{ m: number | null }>) => (rows[0]?.m ?? 0) + 1;

const NullableString = Schema.NullOr(Schema.String);
const Flag = Schema.NullOr(Schema.Finite);

const ProjectRow = Schema.Struct({
  id: Schema.String,
  machine_id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  root_path: Schema.String,
  remote_url: NullableString,
  coordinator_environment_id: NullableString,
  coordinator_thread_id: NullableString,
  coordinator_thread_link: NullableString,
  created_at: Schema.String,
});
export const decodeProject = Schema.decodeUnknownSync(ProjectRow);

const ProjectIdentityRow = Schema.Struct({ id: Schema.String, name: Schema.String });
export const decodeProjectIdentity = Schema.decodeUnknownSync(ProjectIdentityRow);

const ProjectPrefixRow = Schema.Struct({ prefix: Schema.String });
export const decodeProjectPrefix = Schema.decodeUnknownSync(ProjectPrefixRow);

const TaskRow = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  key: Schema.String,
  title: Schema.String,
  goal: Schema.String,
  status: TaskStatus,
  profile: NullableString,
  analysis_mode: Schema.NullOr(AnalysisMode),
  strategy: Schema.NullOr(Strategy),
  ui: Flag,
  authorization: NullableString,
  decision_needed: NullableString,
  blocker: NullableString,
  evidence: NullableString,
  accepted_first_pass: Flag,
  human_interventions: Schema.Finite,
  source: NullableString,
  design_ref: NullableString,
  superseded_by: NullableString,
  created_at: Schema.String,
  updated_at: Schema.String,
});
export const decodeTask = Schema.decodeUnknownSync(TaskRow);
export type TaskRow = typeof TaskRow.Type;

const AttemptRow = Schema.Struct({
  id: Schema.String,
  task_id: Schema.String,
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
  options: NullableString,
  executed_model: NullableString,
  profile: NullableString,
  strategy: Schema.NullOr(Strategy),
  coordinator_thread_id: NullableString,
  coordinator_model: NullableString,
  reason: NullableString,
  fallbacks: NullableString,
  context_mode: ContextMode,
  source_thread_id: NullableString,
  repair_of: NullableString,
  started_at: Schema.String,
  ended_at: NullableString,
  base_commit: NullableString,
  worktree: NullableString,
  branch: NullableString,
  pr_url: NullableString,
  diff_location: NullableString,
  outcome: NullableString,
  failure_class: NullableString,
  failure_detail: NullableString,
  retry_at: NullableString,
  last_verified: NullableString,
  remaining: NullableString,
});
export const decodeAttempt = Schema.decodeUnknownSync(AttemptRow);
export type AttemptRow = typeof AttemptRow.Type;

const AcceptanceRow = Schema.Struct({
  position: Schema.Finite,
  text: Schema.String,
  result: AcceptanceResult,
  evidence: NullableString,
});
export const decodeAcceptance = Schema.decodeUnknownSync(AcceptanceRow);

const CheckRow = Schema.Struct({
  position: Schema.Finite,
  command: Schema.String,
  result: CheckResult,
  detail: NullableString,
});
export const decodeCheck = Schema.decodeUnknownSync(CheckRow);

const CommitRow = Schema.Struct({ sha: Schema.String });
export const decodeCommit = Schema.decodeUnknownSync(CommitRow);

const EventRow = Schema.Struct({
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
export const decodeEvent = Schema.decodeUnknownSync(EventRow);

const ReportRow = Schema.Struct({
  id: Schema.String,
  attempt_id: Schema.String,
  kind: ReportKind,
  body: Schema.String,
  created_at: Schema.String,
});
export const decodeReport = Schema.decodeUnknownSync(ReportRow);

const AttachmentRow = Schema.Struct({
  id: Schema.String,
  attempt_id: Schema.String,
  kind: AttachmentKind,
  theme: Schema.NullOr(AttachmentTheme),
  name: Schema.String,
  path: Schema.String,
  bytes: Schema.Finite,
  sha256: Schema.String,
  created_at: Schema.String,
});
export const decodeAttachment = Schema.decodeUnknownSync(AttachmentRow);

const AttachmentAttemptKeyRow = Schema.Struct({ attempt_key: Schema.String });
export const decodeAttachmentAttemptKey = Schema.decodeUnknownSync(AttachmentAttemptKeyRow);

const AttachmentThemeRow = Schema.Struct({ theme: AttachmentTheme });
export const decodeAttachmentTheme = Schema.decodeUnknownSync(AttachmentThemeRow);

const AttemptIdentityRow = Schema.Struct({ id: Schema.String, key: Schema.String });
export const decodeAttemptIdentity = Schema.decodeUnknownSync(AttemptIdentityRow);

const StatusCountRow = Schema.Struct({ status: TaskStatus, n: Schema.Finite });
export const decodeStatusCount = Schema.decodeUnknownSync(StatusCountRow);

const LiveAttemptRow = Schema.Struct({
  key: Schema.String,
  task: Schema.String,
  kind: AttemptKind,
  status: AttemptStatus,
  thread_id: NullableString,
  started_at: Schema.String,
});
export const decodeLiveAttempt = Schema.decodeUnknownSync(LiveAttemptRow);

const KeyRow = Schema.Struct({ key: Schema.String });
export const decodeKey = Schema.decodeUnknownSync(KeyRow);

const TaskRefRow = Schema.Struct({ key: Schema.String, title: Schema.String });
export const decodeTaskRef = Schema.decodeUnknownSync(TaskRefRow);

const MaxRow = Schema.Struct({ m: Flag });
export const decodeMax = Schema.decodeUnknownSync(MaxRow);

const AttemptRefRow = Schema.Struct({ key: Schema.String, status: AttemptStatus });
export const decodeAttemptRef = Schema.decodeUnknownSync(AttemptRefRow);

const AttemptStatusRow = Schema.Struct({ status: AttemptStatus });
export const decodeAttemptStatus = Schema.decodeUnknownSync(AttemptStatusRow);

const DependencyRow = Schema.Struct({ d: Schema.String });
export const decodeDependency = Schema.decodeUnknownSync(DependencyRow);

const AcceptanceFailureRow = Schema.Struct({ position: Schema.Finite, result: AcceptanceResult });
export const decodeAcceptanceFailure = Schema.decodeUnknownSync(AcceptanceFailureRow);

const AttemptTaskKeyRow = Schema.Struct({ task_key: Schema.String });
export const decodeAttemptTaskKey = Schema.decodeUnknownSync(AttemptTaskKeyRow);
