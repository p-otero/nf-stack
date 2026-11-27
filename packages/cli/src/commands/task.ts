import * as Effect from "effect/Effect";
import {
  TASK_STATUS,
  TASK_STATUSES,
  isClosedStatus,
  loadProjectConfig,
  oneOf,
  taskUiChange,
  uiChangeOf,
} from "@nf/core";
import type { BriefEdit, Task, TaskPatch } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import type { Args } from "../args.ts";
import { Cli } from "../context.ts";
import { taskDetail, taskLine } from "../format.ts";

const FIELD_FLAGS = {
  profile: { type: "string" },
  "analysis-mode": { type: "string" },
  strategy: { type: "string" },
  ui: { type: "boolean" },
  "no-ui": { type: "boolean" },
  authorization: { type: "string" },
  source: { type: "string" },
  "design-ref": { type: "string" },
} as const;

const uiFlag = (a: Args): Effect.Effect<boolean | undefined, UsageError> =>
  a.bool("ui") && a.bool("no-ui")
    ? Effect.fail(new UsageError({ message: "pass either --ui or --no-ui" }))
    : Effect.succeed(a.bool("ui") ? true : a.bool("no-ui") ? false : undefined);

const acceptancePositions = (values: readonly string[]): Effect.Effect<number[], UsageError> =>
  Effect.forEach(values, (value) =>
    /^\d+$/.test(value)
      ? Effect.succeed(Number(value))
      : Effect.fail(
          new UsageError({
            message: `--remove-acceptance needs an acceptance number, not '${value}'`,
          }),
        ),
  );

const add = Effect.fn("cli.task.add")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      title: { type: "string" },
      goal: { type: "string" },
      acceptance: { type: "string", multiple: true },
      "depends-on": { type: "string", multiple: true },
      status: { type: "string" },
      ...FIELD_FLAGS,
      "decision-needed": { type: "string" },
    },
    0,
  );
  const project = yield* cli.project;
  const created = yield* (yield* cli.store).addTask(project.id, {
    title: yield* a.need("title"),
    goal: yield* a.need("goal"),
    acceptance: a.strs("acceptance"),
    dependsOn: a.strs("depends-on"),
    status: a.str("status"),
    profile: a.str("profile"),
    analysisMode: a.str("analysis-mode"),
    strategy: a.str("strategy"),
    ui: yield* uiFlag(a),
    authorization: a.str("authorization"),
    source: a.str("source"),
    designRef: a.str("design-ref"),
    decisionNeeded: a.str("decision-needed"),
    actor: yield* a.actor("coordinator"),
  });
  yield* cli.emit(created, () => taskLine(created));
});

const list = Effect.fn("cli.task.list")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    { status: { type: "string" }, "all-projects": { type: "boolean" } },
    0,
  );
  const status = a.str("status")
    ? yield* oneOf("status", a.str("status"), TASK_STATUSES)
    : undefined;
  const store = yield* cli.store;
  const all = a.bool("all-projects");
  const tasks = yield* store.listTasks({
    projectId: all ? undefined : (yield* cli.project).id,
    status,
  });
  if (all) {
    const names = new Map((yield* store.listProjects()).map((p) => [p.id, p.name]));
    yield* cli.emit(
      tasks.map((t) => ({ ...t, project: names.get(t.project_id) ?? t.project_id })),
      () =>
        tasks.length === 0
          ? "no tasks"
          : tasks.map((t) => taskLine(t, `${names.get(t.project_id)}/`)).join("\n"),
    );
    return;
  }
  yield* cli.emit(tasks, () =>
    tasks.length === 0 ? "no tasks" : tasks.map((t) => taskLine(t)).join("\n"),
  );
});

const show = Effect.fn("cli.task.show")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { events: { type: "boolean" } });
  const project = yield* cli.project;
  const store = yield* cli.store;
  const key = yield* a.pos(0, "task");
  const t = yield* store.getTask(project.id, key);
  const attempts = yield* store.listAttempts(project.id, key);
  const events = a.bool("events") ? yield* store.listEvents(project.id, key) : undefined;
  const config = t.ui ? yield* loadProjectConfig(cli.home, project.prefix) : undefined;
  const uiChange =
    config === undefined
      ? null
      : yield* taskUiChange({
          root: project.root_path,
          attempts,
          review: config.uiReview,
          events: events ?? (yield* store.listEvents(project.id, key)),
        });
  yield* cli.emit(
    {
      ...t,
      attempts,
      ...(events ? { events } : {}),
      ...(uiChange === null ? {} : { ui_change: uiChange }),
    },
    () => taskDetail(t, attempts, events, uiChange),
  );
});

const next = Effect.fn("cli.task.next")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const first = (yield* (yield* cli.store).readyTasks((yield* cli.project).id))[0] ?? null;
  yield* cli.emit(first, () => (first ? taskLine(first) : "no ready tasks"));
});

const set = Effect.fn("cli.task.set")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    status: { type: "string" },
    reason: { type: "string" },
    reopen: { type: "boolean" },
    blocker: { type: "string" },
    "decision-needed": { type: "string" },
    evidence: { type: "string" },
    "superseded-by": { type: "string" },
    title: { type: "string" },
    goal: { type: "string" },
    acceptance: { type: "string", multiple: true },
    "add-acceptance": { type: "string", multiple: true },
    "remove-acceptance": { type: "string", multiple: true },
    ...FIELD_FLAGS,
  });
  const project = yield* cli.project;
  const store = yield* cli.store;
  const key = yield* a.pos(0, "task");
  const patch: TaskPatch = {};
  if (a.has("profile")) patch.profile = a.str("profile");
  if (a.has("analysis-mode")) patch.analysis_mode = a.str("analysis-mode") || null;
  if (a.has("strategy")) patch.strategy = a.str("strategy") || null;
  const ui = yield* uiFlag(a);
  if (ui !== undefined) patch.ui = ui;
  if (a.has("authorization")) patch.authorization = a.str("authorization");
  if (a.has("source")) patch.source = a.str("source");
  if (a.has("design-ref")) patch.design_ref = a.str("design-ref");
  if (a.has("decision-needed")) patch.decision_needed = a.str("decision-needed");
  if (a.has("evidence")) patch.evidence = a.str("evidence");
  if (a.has("superseded-by")) patch.superseded_by = a.str("superseded-by") || null;
  if (a.has("blocker")) patch.blocker = a.str("blocker") === "" ? null : yield* a.json("blocker");
  if (a.has("acceptance") && (a.has("add-acceptance") || a.has("remove-acceptance"))) {
    return yield* new UsageError({
      message: "pass either --acceptance or --add-acceptance/--remove-acceptance, not both",
    });
  }
  const brief: BriefEdit = {};
  if (a.has("title")) brief.title = a.str("title");
  if (a.has("goal")) brief.goal = a.str("goal");
  if (a.has("acceptance")) brief.acceptance = a.strs("acceptance");
  if (a.has("add-acceptance")) brief.addAcceptance = a.strs("add-acceptance");
  const removed = yield* acceptancePositions(a.strs("remove-acceptance"));
  if (removed.length > 0) brief.removeAcceptance = removed;
  const edited = Object.keys(brief).length > 0;
  const to = a.str("status");
  if (to === undefined && Object.keys(patch).length === 0 && !edited) {
    return yield* new UsageError({
      message: "nothing to set (use --status, --blocker, --evidence, ...)",
    });
  }
  const actor = yield* a.actor("coordinator");
  const reopen = a.bool("reopen");
  const updated = yield* store.transaction(
    Effect.gen(function* () {
      const before = yield* store.getTask(project.id, key);
      if (Object.keys(patch).length > 0) yield* store.updateTask(project.id, key, patch, actor);
      if (edited) yield* store.editBrief(project.id, key, brief, { actor, allowClosed: reopen });
      if (to !== undefined) {
        return yield* store.setStatus(project.id, key, to, {
          reason: a.str("reason"),
          actor,
          reopen,
        });
      }
      if (reopen && isClosedStatus(before.status)) {
        return yield* store.setStatus(project.id, key, TASK_STATUS.TODO, {
          reason: a.str("reason"),
          actor,
          reopen: true,
        });
      }
      return yield* store.getTask(project.id, key);
    }),
  );
  return yield* cli.emit(updated, () => taskLine(updated));
});

const transition = Effect.fn("cli.task.transition")(function* (
  argv: string[],
  kind: "approve" | "accept",
) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    reason: { type: "string" },
    evidence: { type: "string" },
    "approved-by-user": { type: "boolean" },
  });
  const project = yield* cli.project;
  const store = yield* cli.store;
  const key = yield* a.pos(0, "task");
  const actor = yield* a.actor(kind === "approve" ? "user" : "coordinator");
  const config = kind === "accept" ? yield* loadProjectConfig(cli.home, project.prefix) : undefined;
  const task = config === undefined ? undefined : yield* store.getTask(project.id, key);
  const uiChange =
    config === undefined || task === undefined || !task.ui
      ? null
      : yield* uiChangeOf({
          root: project.root_path,
          attempts: yield* store.listAttempts(project.id, key),
          review: config.uiReview,
        });
  const done: Task = yield* store.transaction(
    Effect.gen(function* () {
      if (a.has("evidence"))
        yield* store.updateTask(project.id, key, { evidence: a.str("evidence") }, actor);
      return kind === "approve"
        ? yield* store.approveTask(project.id, key, { reason: a.str("reason"), actor })
        : yield* store.acceptTask(project.id, key, {
            reason: a.str("reason"),
            actor,
            approvedByUser: a.bool("approved-by-user"),
            ...(config === undefined ? {} : { themes: config.themes }),
            uiChange,
          });
    }),
  );
  yield* cli.emit(
    done,
    () =>
      taskLine(done) +
      (kind === "accept" ? `  first-pass=${String(done.accepted_first_pass)}` : ""),
  );
});

const reject = Effect.fn("cli.task.reject")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { comment: { type: "string" } });
  const project = yield* cli.project;
  const store = yield* cli.store;
  const key = yield* a.pos(0, "task");
  const rejected = yield* store.rejectReview(project.id, key, yield* a.need("comment"), {
    actor: yield* a.actor("user"),
  });
  yield* cli.emit(rejected, () => taskLine(rejected));
});

const intervene = Effect.fn("cli.task.intervene")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { note: { type: "string" } });
  const project = yield* cli.project;
  const t = yield* (yield* cli.store).intervene(
    project.id,
    yield* a.pos(0, "task"),
    yield* a.need("note"),
    yield* a.actor("user"),
  );
  yield* cli.emit(t, () => `${t.key}  interventions ${t.human_interventions}`);
});

const check = Effect.fn("cli.task.check")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    item: { type: "string" },
    result: { type: "string" },
    evidence: { type: "string" },
  });
  const item = yield* a.int("item");
  if (item === undefined) return yield* new UsageError({ message: "missing --item" });
  const project = yield* cli.project;
  const t = yield* (yield* cli.store).checkItem(
    project.id,
    yield* a.pos(0, "task"),
    item,
    yield* a.need("result"),
    a.str("evidence"),
    yield* a.actor("coordinator"),
  );
  const it = t.acceptance.find((x) => x.position === item);
  return yield* cli.emit(t, () => `${t.key} #${item} ${it?.result ?? ""}`);
});

const depend = Effect.fn("cli.task.depend")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { on: { type: "string" } });
  const project = yield* cli.project;
  const t = yield* (yield* cli.store).addDependency(
    project.id,
    yield* a.pos(0, "task"),
    yield* a.need("on"),
    yield* a.actor("coordinator"),
  );
  yield* cli.emit(t, () => taskLine(t));
});

export const task = Effect.fn("cli.task")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "add":
      return yield* add(rest);
    case "list":
      return yield* list(rest);
    case "show":
      return yield* show(rest);
    case "next":
      return yield* next(rest);
    case "set":
      return yield* set(rest);
    case "approve":
      return yield* transition(rest, "approve");
    case "accept":
      return yield* transition(rest, "accept");
    case "reject":
      return yield* reject(rest);
    case "intervene":
      return yield* intervene(rest);
    case "check":
      return yield* check(rest);
    case "depend":
      return yield* depend(rest);
    default:
      return yield* new UsageError({
        message: `unknown task command '${sub ?? ""}' (add|list|show|next|set|approve|accept|reject|intervene|check|depend)`,
      });
  }
});
