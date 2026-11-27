import * as Effect from "effect/Effect";
import {
  ACTOR_ROLE,
  ATTEMPT_KINDS,
  ATTEMPT_STATUS,
  CHECK_RESULTS,
  CONTEXT_MODE,
  CONTEXT_MODES,
  FINAL_ATTEMPT_STATUSES,
  LIVE_ATTEMPT_STATUSES,
  MECHANISMS,
  STRATEGIES,
  TASK_STATUS,
  WRITING_KINDS,
} from "@nf/contracts";
import type {
  ActorRole,
  AttemptStatus,
  FinalAttemptStatus,
  LiveAttemptStatus,
  TaskStatus,
} from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { formatAttemptKey, splitAttemptKey } from "../domain/keys.ts";
import { isLiveAttemptStatus } from "../domain/transitions.ts";
import { fromJson, oneOf, optText, text } from "../domain/validate.ts";
import { coordinatorTurnIn, selectCoordinatorThreadsIn } from "./coordinators.persistence.ts";
import {
  decodeAttempt,
  decodeAttemptRef,
  decodeAttemptTaskKey,
  decodeMax,
  fail,
  maxPlusOne,
  one,
  type StoreContext,
  type TaskRow,
} from "./store-rows.ts";
import type { TaskStoreFamily } from "./tasks.persistence.ts";
import type { ProjectStore } from "./projects.persistence.ts";
import { loadAttempt } from "./attempt-read.persistence.ts";

export interface StartAttemptInput {
  kind: string;
  mechanism: string;
  provider?: string | null | undefined;
  model?: string | null | undefined;
  options?: unknown;
  profile?: string | null | undefined;
  /** Defaults to the task's strategy. */
  strategy?: string | null | undefined;
  /** Overrides the model derived from the coordinator thread's closest turn. */
  coordinatorModel?: string | null | undefined;
  reason?: string | null | undefined;
  contextMode?: string | undefined;
  sourceThread?: string | null | undefined;
  repairOf?: string | null | undefined;
  /** Idempotency key of the dispatch; defaults to `<project name>-<attempt key>`. */
  clientRequestId?: string | null | undefined;
  baseCommit?: string | null | undefined;
  environmentId?: string | null | undefined;
  actor?: ActorRole | undefined;
}

export interface AttemptPatch {
  status?: string | undefined;
  thread_id?: string | null | undefined;
  thread_link?: string | null | undefined;
  t3_task_id?: string | null | undefined;
  environment_id?: string | null | undefined;
  executed_model?: string | null | undefined;
  worktree?: string | null | undefined;
  branch?: string | null | undefined;
  pr_url?: string | null | undefined;
  diff_location?: string | null | undefined;
  addFallback?: readonly unknown[] | undefined;
  addCommits?: readonly string[] | undefined;
  addChecks?:
    readonly { command: string; result: string; detail?: string | null | undefined }[] | undefined;
  actor?: ActorRole | undefined;
}

export interface FinishAttemptInput {
  status: string;
  outcome?: string | null | undefined;
  failure_class?: string | null | undefined;
  failure_detail?: string | null | undefined;
  retry_at?: string | null | undefined;
  last_verified?: string | null | undefined;
  remaining?: string | null | undefined;
  actor?: ActorRole | undefined;
}

export const attemptStore = (
  ctx: StoreContext,
  tasks: Pick<TaskStoreFamily, "findTaskRow" | "event">,
  projects: Pick<ProjectStore, "getProject">,
) => {
  const { sql, machine, now } = ctx;
  const { findTaskRow, event } = tasks;
  const { getProject } = projects;

  const findAttempt = Effect.fnUntraced(function* (projectId: string, attemptKey: string) {
    const { taskRef, seq } = yield* splitAttemptKey(attemptKey);
    const task = yield* findTaskRow(projectId, taskRef);
    const row = yield* one(sql`SELECT * FROM attempts WHERE task_id = ${task.id} AND seq = ${seq}`);
    if (row === undefined)
      return yield* fail("not_found", `attempt ${formatAttemptKey(task.key, seq)} not found`);
    return { task, row: decodeAttempt(row) };
  });

  const findAttemptRow = Effect.fnUntraced(function* (projectId: string, attemptKey: string) {
    return (yield* findAttempt(projectId, attemptKey)).row;
  });

  const getAttempt = Effect.fn("TaskStore.getAttempt")(function* (
    projectId: string,
    attemptKey: string,
  ) {
    const { task, row } = yield* findAttempt(projectId, attemptKey);
    return yield* loadAttempt(sql, row, task.key);
  });

  const listAttempts = Effect.fn("TaskStore.listAttempts")(function* (
    projectId: string,
    taskRef: string,
  ) {
    const task = yield* findTaskRow(projectId, taskRef);
    const rows = yield* sql`SELECT * FROM attempts WHERE task_id = ${task.id} ORDER BY seq`;
    return yield* Effect.forEach(rows, (row) => loadAttempt(sql, decodeAttempt(row), task.key));
  });

  const liveAttempts = Effect.fn("TaskStore.liveAttempts")(function* (projectId: string) {
    const rows = yield* sql`SELECT a.*, t.key AS task_key FROM attempts a
      JOIN tasks t ON t.id = a.task_id
      WHERE t.project_id = ${projectId} AND a.status IN ${sql.in(LIVE_ATTEMPT_STATUSES)}
      ORDER BY a.started_at, a.key`;
    return yield* Effect.forEach(rows, (row) =>
      loadAttempt(sql, decodeAttempt(row), decodeAttemptTaskKey(row).task_key),
    );
  });

  /** A writing attempt owns the task status: it steps from the status it was dispatched into. */
  const stepTaskStatus = Effect.fnUntraced(function* (
    task: TaskRow,
    expected: TaskStatus,
    to: TaskStatus,
    attempt: { readonly id: string; readonly key: string },
    actor: ActorRole,
  ) {
    if (task.status === expected) {
      const at = yield* now;
      yield* sql`UPDATE tasks SET status = ${to}, updated_at = ${at} WHERE id = ${task.id}`;
      yield* event(task.id, "status", actor, {
        attemptId: attempt.id,
        from: expected,
        to,
        note: attempt.key,
      });
    }
  });

  const startAttempt = Effect.fn("TaskStore.startAttempt")(function* (
    projectId: string,
    taskRef: string,
    input: StartAttemptInput,
  ) {
    const task = yield* findTaskRow(projectId, taskRef);
    const taskId = task.id;
    const taskKey = task.key;
    const kind = yield* oneOf("kind", input.kind, ATTEMPT_KINDS);
    const mechanism = yield* oneOf("mechanism", input.mechanism, MECHANISMS);
    const strategy = input.strategy
      ? yield* oneOf("strategy", input.strategy, STRATEGIES)
      : task.strategy;
    const contextMode = yield* oneOf(
      "context mode",
      input.contextMode ?? CONTEXT_MODE.FRESH,
      CONTEXT_MODES,
    );
    const requested = optText(input.clientRequestId);

    if (requested) {
      const duplicate = yield* one(
        sql`SELECT * FROM attempts WHERE task_id = ${taskId} AND client_request_id = ${requested}`,
      );
      if (duplicate) return yield* loadAttempt(sql, decodeAttempt(duplicate), taskKey);
    }

    const seq = maxPlusOne(
      (yield* sql`SELECT MAX(seq) AS m FROM attempts WHERE task_id = ${taskId}`).map((row) =>
        decodeMax(row),
      ),
    );
    const key = formatAttemptKey(taskKey, seq);
    const clientRequestId = requested ?? `${(yield* getProject(projectId)).name}-${key}`;

    const writing = WRITING_KINDS.includes(kind);
    const status: TaskStatus = task.status;
    if (
      writing &&
      status !== TASK_STATUS.TODO &&
      status !== TASK_STATUS.WORKING &&
      status !== TASK_STATUS.REVIEW
    ) {
      return yield* fail(
        "illegal_state",
        `${taskKey} is ${status}; a ${kind} attempt needs todo, working or review`,
      );
    }
    if (status === TASK_STATUS.CANCELLED)
      return yield* fail("illegal_state", `${taskKey} is cancelled`);
    if (writing) {
      const live = yield* one(sql`SELECT key, status FROM attempts
          WHERE task_id = ${taskId} AND status IN ('dispatching','active','unknown')
            AND kind IN ('implementation','integration') ORDER BY seq LIMIT 1`);
      if (live !== undefined) {
        const attempt = decodeAttemptRef(live);
        return yield* fail(
          "live_writer",
          `${taskKey} already has a writing attempt ${attempt.key} (${attempt.status}); finish or reconcile it first`,
        );
      }
    }
    let repairId: string | null = null;
    if (input.repairOf) {
      const repaired = yield* findAttemptRow(projectId, input.repairOf);
      if (repaired.task_id !== taskId) {
        return yield* fail("invalid_value", `repair-of ${input.repairOf} belongs to another task`);
      }
      repairId = repaired.id;
    }
    const options =
      input.options !== undefined && input.options !== null ? JSON.stringify(input.options) : null;
    const id = ulid();
    const at = yield* now;
    const coordinator = yield* coordinatorTurnIn(
      sql,
      yield* selectCoordinatorThreadsIn(sql, task.project_id),
      at,
    );
    yield* sql`INSERT INTO attempts ${sql.insert({
      id,
      machine_id: machine,
      task_id: taskId,
      seq,
      key,
      kind,
      status: ATTEMPT_STATUS.DISPATCHING,
      mechanism,
      environment_id: optText(input.environmentId),
      client_request_id: clientRequestId,
      provider_instance_id: optText(input.provider),
      model: optText(input.model),
      options,
      profile: optText(input.profile) ?? task.profile,
      strategy,
      coordinator_thread_id: coordinator?.thread ?? null,
      coordinator_model: optText(input.coordinatorModel) ?? coordinator?.model ?? null,
      reason: optText(input.reason),
      context_mode: contextMode,
      source_thread_id: optText(input.sourceThread),
      repair_of: repairId,
      started_at: at,
      base_commit: optText(input.baseCommit),
      updated_at: at,
    })}`;
    const actor = input.actor ?? ACTOR_ROLE.COORDINATOR;
    yield* event(taskId, "attempt_started", actor, {
      attemptId: id,
      note: key,
    });
    if (writing)
      yield* stepTaskStatus(task, TASK_STATUS.TODO, TASK_STATUS.WORKING, { id, key }, actor);
    return yield* getAttempt(projectId, key);
  }, sql.withTransaction);

  const updateAttempt = Effect.fn("TaskStore.updateAttempt")(function* (
    projectId: string,
    attemptKey: string,
    patch: AttemptPatch,
  ) {
    const row = yield* findAttemptRow(projectId, attemptKey);
    const id = row.id;
    const key = row.key;
    const cur = row.status;
    const sets: Record<string, string | null> = {};
    const changed: string[] = [];
    if (patch.status !== undefined) {
      const next: LiveAttemptStatus = yield* oneOf("status", patch.status, LIVE_ATTEMPT_STATUSES);
      if (!isLiveAttemptStatus(cur)) {
        return yield* fail(
          "illegal_transition",
          `${key} is ${cur} (final); its status cannot change`,
        );
      }
      if (next !== cur) {
        sets["status"] = next;
        changed.push(`status ${cur}->${next}`);
      }
    }
    for (const col of [
      "thread_id",
      "thread_link",
      "t3_task_id",
      "environment_id",
      "executed_model",
      "worktree",
      "branch",
      "pr_url",
      "diff_location",
    ] as const) {
      if (col in patch) {
        sets[col] = optText(patch[col]);
        changed.push(col);
      }
    }
    if (patch.addFallback && patch.addFallback.length > 0) {
      const stored = fromJson(row.fallbacks);
      const list = Array.isArray(stored) ? stored : [];
      sets["fallbacks"] = JSON.stringify([...list, ...patch.addFallback]);
      changed.push("fallbacks");
    }
    for (const sha of patch.addCommits ?? []) {
      const commit = yield* text("commit", sha);
      const have = yield* one(
        sql`SELECT 1 AS ok FROM attempt_commits WHERE attempt_id = ${id} AND sha = ${commit}`,
      );
      if (!have) {
        const position = maxPlusOne(
          (yield* sql`SELECT MAX(position) AS m FROM attempt_commits WHERE attempt_id = ${id}`).map(
            (positionRow) => decodeMax(positionRow),
          ),
        );
        yield* sql`INSERT INTO attempt_commits ${sql.insert({ attempt_id: id, position, sha: commit })}`;
        changed.push("commit");
      }
    }
    for (const check of patch.addChecks ?? []) {
      const position = maxPlusOne(
        (yield* sql`SELECT MAX(position) AS m FROM attempt_checks WHERE attempt_id = ${id}`).map(
          (positionRow) => decodeMax(positionRow),
        ),
      );
      yield* sql`INSERT INTO attempt_checks ${sql.insert({
        attempt_id: id,
        position,
        command: yield* text("check command", check.command),
        result: yield* oneOf("check result", check.result, CHECK_RESULTS),
        detail: optText(check.detail),
      })}`;
      changed.push("check");
    }
    if (changed.length > 0) {
      sets["updated_at"] = yield* now;
      yield* sql`UPDATE attempts SET ${sql.update(sets)} WHERE id = ${id}`;
      yield* event(row.task_id, "attempt_updated", patch.actor ?? ACTOR_ROLE.COORDINATOR, {
        attemptId: id,
        note: `${key}: ${changed.join(", ")}`,
      });
    }
    return yield* getAttempt(projectId, key);
  }, sql.withTransaction);

  const finishAttempt = Effect.fn("TaskStore.finishAttempt")(function* (
    projectId: string,
    attemptKey: string,
    input: FinishAttemptInput,
  ) {
    const { task, row } = yield* findAttempt(projectId, attemptKey);
    const id = row.id;
    const key = row.key;
    const status: FinalAttemptStatus = yield* oneOf("status", input.status, FINAL_ATTEMPT_STATUSES);
    const cur: AttemptStatus = row.status;
    if (!isLiveAttemptStatus(cur))
      return yield* fail("illegal_transition", `${key} is already ${cur}`);
    const actor = input.actor ?? ACTOR_ROLE.COORDINATOR;
    const at = yield* now;
    yield* sql`UPDATE attempts SET ${sql.update({
      status,
      ended_at: at,
      outcome: optText(input.outcome),
      failure_class: optText(input.failure_class),
      failure_detail: optText(input.failure_detail),
      retry_at: optText(input.retry_at),
      last_verified: optText(input.last_verified),
      remaining: optText(input.remaining),
      updated_at: at,
    })} WHERE id = ${id}`;
    yield* event(row.task_id, "attempt_finished", actor, {
      attemptId: id,
      from: cur,
      to: status,
      note: key,
    });
    if (status === ATTEMPT_STATUS.SUCCEEDED && WRITING_KINDS.includes(row.kind))
      yield* stepTaskStatus(task, TASK_STATUS.WORKING, TASK_STATUS.REVIEW, row, actor);
    return yield* getAttempt(projectId, key);
  }, sql.withTransaction);

  return {
    getAttempt,
    listAttempts,
    liveAttempts,
    startAttempt,
    updateAttempt,
    finishAttempt,
    findAttemptRow,
  };
};

export type AttemptStoreFamily = ReturnType<typeof attemptStore>;
