import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type {
  ActorRole,
  Attempt,
  AttemptAttachment,
  AttachmentTheme,
  Project,
  Report,
  StatusSummary,
  Task,
  TaskEvent,
  TaskStatus,
} from "@nf/contracts";
import type { AddTaskInput, TaskPatch, TransitionOptions } from "./tasks.persistence.ts";
import type { BriefEdit, BriefEditOptions } from "./task-brief.persistence.ts";
import type { UiChange } from "../domain/ui-change.ts";
import type {
  AttemptPatch,
  FinishAttemptInput,
  StartAttemptInput,
} from "./attempts.persistence.ts";
import type { RegisterProjectInput } from "./projects.persistence.ts";
import type { EventExtra, StoreError } from "./store-rows.ts";
import type { AddAttachmentInput } from "./attachments.persistence.ts";
import { attachmentStore } from "./attachments.persistence.ts";
import { attemptStore } from "./attempts.persistence.ts";
import { projectStore } from "./projects.persistence.ts";
import { reportStore } from "./reports.persistence.ts";
import { taskStore } from "./tasks.persistence.ts";
import { taskBriefStore } from "./task-brief.persistence.ts";
import { taskTransitionStore } from "./task-transitions.persistence.ts";

export type { StoreError } from "./store-rows.ts";
export type { EventExtra, StoreContext } from "./store-rows.ts";
export type { AddTaskInput, TaskPatch, TransitionOptions } from "./tasks.persistence.ts";
export type { BriefEdit, BriefEditOptions } from "./task-brief.persistence.ts";
export type { TaskTransitionStoreFamily } from "./task-transitions.persistence.ts";
export type {
  AttemptPatch,
  FinishAttemptInput,
  StartAttemptInput,
} from "./attempts.persistence.ts";
export type { AddAttachmentInput } from "./attachments.persistence.ts";
export type { RegisterProjectInput } from "./projects.persistence.ts";

type Op<A, Args extends readonly unknown[]> = (...args: Args) => Effect.Effect<A, StoreError>;

/** Projects, tasks, attempts, reports and their audit trail. */
export class TaskStore extends Context.Service<
  TaskStore,
  {
    readonly machine: string;
    /** Run `effect` in one write transaction; nested store calls join it. */
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | SqlError, R>;
    readonly registerProject: Op<
      { project: Project; created: boolean },
      [input: RegisterProjectInput]
    >;
    readonly getProject: Op<Project, [id: string]>;
    readonly setProjectPrefix: Op<Project, [id: string, prefix: string]>;
    readonly listProjects: Op<Project[], []>;
    readonly findProjectByPath: Op<Project | null, [path: string]>;
    readonly resolveProject: Op<Project, [ref: string]>;
    readonly getTask: Op<Task, [projectId: string, ref: string]>;
    readonly findTaskByKey: Op<Task | null, [key: string]>;
    readonly listTasks: Op<
      Task[],
      [opts?: { projectId?: string | undefined; status?: TaskStatus | undefined }]
    >;
    readonly addTask: Op<Task, [projectId: string, input: AddTaskInput]>;
    readonly readyTasks: Op<Task[], [projectId: string]>;
    readonly addDependency: Op<
      Task,
      [projectId: string, ref: string, dependsOnRef: string, actor?: ActorRole]
    >;
    readonly insertDependency: Op<
      void,
      [taskId: string, dependsOnId: string, taskKey?: string, depKey?: string]
    >;
    readonly updateTask: Op<
      Task,
      [projectId: string, ref: string, patch: TaskPatch, actor?: ActorRole]
    >;
    readonly editBrief: Op<
      Task,
      [projectId: string, ref: string, edit: BriefEdit, opts?: BriefEditOptions]
    >;
    readonly setStatus: Op<
      Task,
      [projectId: string, ref: string, to: string, opts?: TransitionOptions]
    >;
    readonly approveTask: Op<
      Task,
      [
        projectId: string,
        ref: string,
        opts?: { reason?: string | null | undefined; actor?: ActorRole | undefined },
      ]
    >;
    readonly acceptTask: Op<
      Task,
      [
        projectId: string,
        ref: string,
        opts?: {
          reason?: string | null | undefined;
          actor?: ActorRole | undefined;
          approvedByUser?: boolean | undefined;
          themes?: readonly AttachmentTheme[] | undefined;
          uiChange?: UiChange | null | undefined;
        },
      ]
    >;
    readonly rejectReview: Op<
      Task,
      [projectId: string, ref: string, comment: string, opts?: { actor?: ActorRole | undefined }]
    >;
    readonly intervene: Op<Task, [projectId: string, ref: string, note: string, actor?: ActorRole]>;
    readonly checkItem: Op<
      Task,
      [
        projectId: string,
        ref: string,
        item: number,
        result: string,
        evidence?: string | null,
        actor?: ActorRole,
      ]
    >;
    readonly listEvents: Op<TaskEvent[], [projectId: string, ref: string]>;
    readonly event: Op<void, [taskId: string, kind: string, actor: ActorRole, extra?: EventExtra]>;
    readonly getAttempt: Op<Attempt, [projectId: string, attemptKey: string]>;
    readonly listAttempts: Op<Attempt[], [projectId: string, taskRef: string]>;
    /** Every attempt that may still be running in the project, oldest first. */
    readonly liveAttempts: Op<Attempt[], [projectId: string]>;
    readonly startAttempt: Op<
      Attempt,
      [projectId: string, taskRef: string, input: StartAttemptInput]
    >;
    readonly updateAttempt: Op<
      Attempt,
      [projectId: string, attemptKey: string, patch: AttemptPatch]
    >;
    readonly finishAttempt: Op<
      Attempt,
      [projectId: string, attemptKey: string, input: FinishAttemptInput]
    >;
    readonly addReport: Op<
      Report,
      [projectId: string, attemptKey: string, kind: string, body: string]
    >;
    readonly listReports: Op<Report[], [projectId: string, attemptKey: string]>;
    readonly addAttachment: Op<
      AttemptAttachment,
      [projectId: string, attemptKey: string, input: AddAttachmentInput]
    >;
    readonly listAttachments: Op<AttemptAttachment[], [projectId: string, attemptKey: string]>;
    readonly findAttachment: Op<AttemptAttachment | null, [id: string]>;
    readonly summary: Op<StatusSummary, [projectId: string]>;
  }
>()("nf/persistence/TaskStore") {}

const make = Effect.fn("TaskStore.make")(function* (options: { readonly machine: string }) {
  const sql = yield* SqlClient.SqlClient;
  const ctx = {
    sql,
    machine: options.machine,
    now: Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString()),
  };
  const projects = projectStore(ctx);
  const tasks = taskStore(ctx, projects);
  const brief = taskBriefStore(ctx, tasks);
  const transitions = taskTransitionStore(ctx, tasks);
  const attempts = attemptStore(ctx, tasks, projects);
  const reports = reportStore(ctx, attempts);
  const attachments = attachmentStore(ctx, attempts, tasks);
  return TaskStore.of({
    machine: options.machine,
    transaction: sql.withTransaction,
    ...projects,
    ...tasks,
    ...brief,
    ...transitions,
    ...attempts,
    ...reports,
    ...attachments,
  });
});

export const layer = (options: { readonly machine: string }) =>
  Layer.effect(TaskStore, make(options));
