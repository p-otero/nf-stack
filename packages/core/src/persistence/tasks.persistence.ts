import * as Effect from "effect/Effect";
import type * as Statement from "effect/sql/Statement";
import { ACTOR_ROLE, ANALYSIS_MODES, STRATEGIES, TASK_STATUS } from "@nf/contracts";
import type {
  AcceptanceItem,
  ActorRole,
  StatusSummary,
  Task,
  TaskEvent,
  TaskStatus,
} from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { formatTaskKey, normalizeTaskKey } from "../domain/keys.ts";
import { fromJson, oneOf, optText, text, toJson } from "../domain/validate.ts";
import {
  decodeAcceptance,
  decodeDependency,
  decodeEvent,
  decodeKey,
  decodeLiveAttempt,
  decodeMax,
  decodeStatusCount,
  decodeTask,
  decodeTaskRef,
  fail,
  maxPlusOne,
  one,
  type EventExtra,
  type StoreContext,
  type TaskRow,
} from "./store-rows.ts";
import type { ProjectStore } from "./projects.persistence.ts";

export interface AddTaskInput {
  title: string;
  goal: string;
  acceptance: readonly string[];
  dependsOn?: readonly string[] | undefined;
  status?: string | undefined;
  profile?: string | null | undefined;
  analysisMode?: string | null | undefined;
  strategy?: string | null | undefined;
  ui?: boolean | undefined;
  authorization?: string | null | undefined;
  source?: string | null | undefined;
  designRef?: string | null | undefined;
  decisionNeeded?: string | null | undefined;
  actor?: ActorRole | undefined;
}

export interface TaskPatch {
  profile?: string | null | undefined;
  analysis_mode?: string | null | undefined;
  strategy?: string | null | undefined;
  ui?: boolean | undefined;
  authorization?: string | null | undefined;
  decision_needed?: string | null | undefined;
  blocker?: unknown;
  evidence?: string | null | undefined;
  source?: string | null | undefined;
  design_ref?: string | null | undefined;
  superseded_by?: string | null | undefined;
}

export interface TransitionOptions {
  reason?: string | null | undefined;
  actor?: ActorRole | undefined;
  reopen?: boolean | undefined;
  kind?: string | undefined;
  /** A `ui` change verdict to record beside the transition, e.g. `small (42 lines, 2 files)`. */
  uiChange?: string | undefined;
}

export const taskStore = (ctx: StoreContext, projects: Pick<ProjectStore, "getProject">) => {
  const { sql, machine, now } = ctx;
  const { getProject } = projects;

  const findTaskRow = Effect.fnUntraced(function* (projectId: string, ref: string) {
    const project = yield* getProject(projectId);
    const key = yield* normalizeTaskKey(project.prefix, ref);
    const row = yield* one(
      sql`SELECT * FROM tasks WHERE project_id = ${projectId} AND key = ${key}`,
    );
    if (row === undefined) return yield* fail("not_found", `task ${key} not found`);
    return decodeTask(row);
  });

  const loadTask = Effect.fnUntraced(function* (row: TaskRow) {
    const acceptanceRows = yield* sql`SELECT position, text, result, evidence FROM task_acceptance
        WHERE task_id = ${row.id} ORDER BY position`;
    const acceptance: AcceptanceItem[] = acceptanceRows.map((item) => decodeAcceptance(item));
    const deps =
      (yield* sql`SELECT t.key FROM task_deps d JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ${row.id} ORDER BY t.seq`).map((r) => decodeKey(r).key);
    const supersededRow =
      row.superseded_by === null
        ? undefined
        : yield* one(sql`SELECT key FROM tasks WHERE id = ${row.superseded_by}`);
    const task: Task = {
      id: row.id,
      project_id: row.project_id,
      key: row.key,
      title: row.title,
      goal: row.goal,
      status: row.status,
      profile: row.profile,
      analysis_mode: row.analysis_mode,
      strategy: row.strategy,
      ui: row.ui === 1,
      authorization: row.authorization,
      decision_needed: row.decision_needed,
      blocker: fromJson(row.blocker),
      evidence: row.evidence,
      accepted_first_pass: row.accepted_first_pass === null ? null : row.accepted_first_pass === 1,
      human_interventions: row.human_interventions,
      source: row.source,
      design_ref: row.design_ref,
      superseded_by: supersededRow === undefined ? null : decodeKey(supersededRow).key,
      created_at: row.created_at,
      updated_at: row.updated_at,
      acceptance,
      depends_on: deps,
    };
    return task;
  });

  const getTask = Effect.fn("TaskStore.getTask")(function* (projectId: string, ref: string) {
    return yield* loadTask(yield* findTaskRow(projectId, ref));
  });

  /** One task of any project by its canonical key, `null` when no project holds it. */
  const findTaskByKey = Effect.fn("TaskStore.findTaskByKey")(function* (key: string) {
    const row = yield* one(sql`SELECT * FROM tasks WHERE key = ${key.trim().toUpperCase()}`);
    return row === undefined ? null : yield* loadTask(decodeTask(row));
  });

  const listTasks = Effect.fn("TaskStore.listTasks")(function* (
    opts: { projectId?: string | undefined; status?: TaskStatus | undefined } = {},
  ) {
    const where: Statement.Fragment[] = [];
    if (opts.projectId) where.push(sql`project_id = ${opts.projectId}`);
    if (opts.status) where.push(sql`status = ${opts.status}`);
    const rows = yield* sql`SELECT * FROM tasks ${
      where.length > 0 ? sql`WHERE ${sql.and(where)}` : sql.literal("")
    } ORDER BY project_id, seq`;
    return yield* Effect.forEach(rows, (row) => loadTask(decodeTask(row)));
  });

  const touch = (taskId: string) =>
    Effect.flatMap(now, (at) => sql`UPDATE tasks SET updated_at = ${at} WHERE id = ${taskId}`);

  const event = Effect.fn("TaskStore.event")(function* (
    taskId: string,
    kind: string,
    actor: ActorRole,
    extra: EventExtra = {},
  ) {
    yield* sql`INSERT INTO task_events ${sql.insert({
      id: ulid(),
      machine_id: machine,
      task_id: taskId,
      attempt_id: extra.attemptId ?? null,
      kind,
      actor_role: actor,
      from_status: extra.from ?? null,
      to_status: extra.to ?? null,
      note: extra.note ?? null,
      created_at: yield* now,
    })}`;
  });

  const reaches = Effect.fnUntraced(function* (from: string, target: string) {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.pop();
      if (cur === undefined) return false;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const next = yield* sql`SELECT depends_on_task_id AS d FROM task_deps WHERE task_id = ${cur}`;
      for (const row of next) queue.push(decodeDependency(row).d);
    }
    return false;
  });

  const insertDependency = Effect.fn("TaskStore.insertDependency")(function* (
    taskId: string,
    dependsOnId: string,
    taskKey: string = taskId,
    depKey: string = dependsOnId,
  ) {
    if (taskId === dependsOnId) return yield* fail("cycle", `${taskKey} cannot depend on itself`);
    const exists = yield* one(sql`SELECT 1 AS ok FROM task_deps
      WHERE task_id = ${taskId} AND depends_on_task_id = ${dependsOnId}`);
    if (exists) return yield* Effect.void;
    if (yield* reaches(dependsOnId, taskId)) {
      return yield* fail("cycle", `dependency ${taskKey} -> ${depKey} would create a cycle`);
    }
    yield* sql`INSERT INTO task_deps ${sql.insert({ task_id: taskId, depends_on_task_id: dependsOnId })}`;
    return yield* Effect.void;
  });

  const addTask = Effect.fn("TaskStore.addTask")(function* (
    projectId: string,
    input: AddTaskInput,
  ) {
    const project = yield* getProject(projectId);
    const title = yield* text("title", input.title);
    const goal = yield* text("goal", input.goal);
    const acceptance = (input.acceptance ?? []).map((a) => a.trim()).filter((a) => a.length > 0);
    if (acceptance.length === 0) {
      return yield* fail("invalid_value", "at least one acceptance item is required");
    }
    const status = yield* oneOf("status", input.status ?? TASK_STATUS.TODO, [
      TASK_STATUS.PROPOSED,
      TASK_STATUS.TODO,
    ]);
    const mode = input.analysisMode
      ? yield* oneOf("analysis mode", input.analysisMode, ANALYSIS_MODES)
      : null;
    const strategy = input.strategy ? yield* oneOf("strategy", input.strategy, STRATEGIES) : null;
    const deps = [
      ...new Set(
        yield* Effect.forEach(input.dependsOn ?? [], (ref) =>
          normalizeTaskKey(project.prefix, ref),
        ),
      ),
    ];
    const depRows = yield* Effect.forEach(deps, (k) => findTaskRow(projectId, k));
    const seq = maxPlusOne(
      (yield* sql`SELECT MAX(seq) AS m FROM tasks WHERE project_id = ${projectId}`).map((row) =>
        decodeMax(row),
      ),
    );
    const key = formatTaskKey(project.prefix, seq);
    const id = ulid();
    const at = yield* now;
    yield* sql`INSERT INTO tasks ${sql.insert({
      id,
      machine_id: machine,
      project_id: projectId,
      seq,
      key,
      title,
      goal,
      status,
      profile: optText(input.profile),
      analysis_mode: mode,
      strategy,
      ui: input.ui === true ? 1 : 0,
      authorization: optText(input.authorization),
      decision_needed: optText(input.decisionNeeded),
      source: optText(input.source),
      design_ref: optText(input.designRef),
      created_at: at,
      updated_at: at,
    })}`;
    for (const [i, a] of acceptance.entries()) {
      yield* sql`INSERT INTO task_acceptance ${sql.insert({ task_id: id, position: i + 1, text: a })}`;
    }
    for (const dep of depRows) {
      yield* sql`INSERT INTO task_deps ${sql.insert({ task_id: id, depends_on_task_id: dep.id })}`;
    }
    yield* event(id, "created", input.actor ?? ACTOR_ROLE.COORDINATOR, { to: status });
    return yield* getTask(projectId, key);
  }, sql.withTransaction);

  const readyTasks = Effect.fn("TaskStore.readyTasks")(function* (projectId: string) {
    const rows = yield* sql`SELECT * FROM tasks t
      WHERE t.project_id = ${projectId} AND t.status = 'todo'
        AND (t.decision_needed IS NULL OR t.decision_needed = '')
        AND NOT EXISTS (
          SELECT 1 FROM task_deps d JOIN tasks dt ON dt.id = d.depends_on_task_id
          WHERE d.task_id = t.id AND dt.status <> 'done')
        AND NOT EXISTS (
          SELECT 1 FROM attempts a
          WHERE a.task_id = t.id AND a.status IN ('dispatching','active','unknown'))
      ORDER BY t.seq`;
    return yield* Effect.forEach(rows, (row) => loadTask(decodeTask(row)));
  });

  const addDependency = Effect.fn("TaskStore.addDependency")(function* (
    projectId: string,
    ref: string,
    dependsOnRef: string,
    actor: ActorRole = ACTOR_ROLE.COORDINATOR,
  ) {
    const task = yield* findTaskRow(projectId, ref);
    const dep = yield* findTaskRow(projectId, dependsOnRef);
    yield* insertDependency(task.id, dep.id, task.key, dep.key);
    yield* touch(task.id);
    yield* event(task.id, "dependency", actor, {
      note: `depends on ${dep.key}`,
    });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  const updateTask = Effect.fn("TaskStore.updateTask")(function* (
    projectId: string,
    ref: string,
    patch: TaskPatch,
    actor: ActorRole = ACTOR_ROLE.COORDINATOR,
  ) {
    const row = yield* findTaskRow(projectId, ref);
    const sets: Record<string, string | number | null> = {};
    const changed: string[] = [];
    const set = (col: string, v: string | number | null) => {
      sets[col] = v;
      changed.push(col);
    };
    for (const col of [
      "profile",
      "authorization",
      "decision_needed",
      "evidence",
      "source",
      "design_ref",
    ] as const) {
      if (col in patch) set(col, optText(patch[col]));
    }
    if ("analysis_mode" in patch) {
      set(
        "analysis_mode",
        patch.analysis_mode
          ? yield* oneOf("analysis mode", patch.analysis_mode, ANALYSIS_MODES)
          : null,
      );
    }
    if ("strategy" in patch) {
      set("strategy", patch.strategy ? yield* oneOf("strategy", patch.strategy, STRATEGIES) : null);
    }
    if (patch.ui !== undefined) set("ui", patch.ui ? 1 : 0);
    if ("blocker" in patch) set("blocker", toJson(patch.blocker));
    if ("superseded_by" in patch) {
      const target = patch.superseded_by
        ? yield* findTaskRow(projectId, patch.superseded_by)
        : null;
      if (target?.id === row.id)
        return yield* fail("invalid_value", "a task cannot supersede itself");
      set("superseded_by", target ? target.id : null);
    }
    if (changed.length === 0) return yield* loadTask(row);
    sets["updated_at"] = yield* now;
    yield* sql`UPDATE tasks SET ${sql.update(sets)} WHERE id = ${row.id}`;
    yield* event(row.id, "update", actor, { note: changed.join(", ") });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  const listEvents = Effect.fn("TaskStore.listEvents")(function* (projectId: string, ref: string) {
    const row = yield* findTaskRow(projectId, ref);
    const rows = yield* sql`SELECT e.id, e.task_id, e.attempt_id, e.kind, e.actor_role,
        e.from_status, e.to_status, e.note, e.created_at
      FROM task_events e WHERE e.task_id = ${row.id} ORDER BY e.id`;
    return rows.map((stored): TaskEvent => decodeEvent(stored));
  });

  const summary = Effect.fn("TaskStore.summary")(function* (projectId: string) {
    const counts: Record<TaskStatus, number> = {
      [TASK_STATUS.PROPOSED]: 0,
      [TASK_STATUS.TODO]: 0,
      [TASK_STATUS.WORKING]: 0,
      [TASK_STATUS.REVIEW]: 0,
      [TASK_STATUS.BLOCKED]: 0,
      [TASK_STATUS.DONE]: 0,
      [TASK_STATUS.CANCELLED]: 0,
    };
    const countRows =
      yield* sql`SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ${projectId} GROUP BY status`;
    for (const countRow of countRows.map((row) => decodeStatusCount(row))) {
      counts[countRow.status] = countRow.n;
    }
    const liveRows =
      yield* sql`SELECT a.key, t.key AS task, a.kind, a.status, a.thread_id, a.started_at
      FROM attempts a JOIN tasks t ON t.id = a.task_id
      WHERE t.project_id = ${projectId} AND a.status IN ('dispatching','active','unknown')
      ORDER BY a.started_at, a.key`;
    const live = liveRows.map((row) => decodeLiveAttempt(row));
    const proposalRows = yield* sql`SELECT key, title FROM tasks
      WHERE project_id = ${projectId} AND status = 'proposed' ORDER BY seq`;
    const proposals = proposalRows.map((row) => decodeTaskRef(row));
    const ready = (yield* readyTasks(projectId)).map((t) => ({ key: t.key, title: t.title }));
    const result: StatusSummary = {
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      live_attempts: live,
      ready,
      proposals,
    };
    return result;
  });

  return {
    getTask,
    findTaskByKey,
    listTasks,
    addTask,
    readyTasks,
    insertDependency,
    addDependency,
    updateTask,
    listEvents,
    event,
    findTaskRow,
    touch,
    summary,
  };
};

export type TaskStoreFamily = ReturnType<typeof taskStore>;
