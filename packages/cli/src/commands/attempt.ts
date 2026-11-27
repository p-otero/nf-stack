import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  attachArtifact,
  attemptLiveness,
  loadProjectConfig,
  pullRequestHref,
  t3StatePath,
} from "@nf/core";
import type { AttemptAttachment, AttemptPatch } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";
import { attachmentLine, attemptDetail, livenessText, uiEvidenceHint } from "../format.ts";

/** `--add-check` JSON: command and result are required text. */
const CheckInput = Schema.Struct({
  command: Schema.String,
  result: Schema.String,
  detail: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeCheck = Schema.decodeUnknownOption(CheckInput);

const start = Effect.fn("cli.attempt.start")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    kind: { type: "string" },
    mechanism: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    options: { type: "string" },
    profile: { type: "string" },
    strategy: { type: "string" },
    "coordinator-model": { type: "string" },
    reason: { type: "string" },
    "context-mode": { type: "string" },
    "source-thread": { type: "string" },
    "repair-of": { type: "string" },
    "client-request-id": { type: "string" },
    "base-commit": { type: "string" },
    "environment-id": { type: "string" },
  });
  const store = yield* cli.store;
  const project = yield* cli.project;
  const taskRef = yield* a.pos(0, "task");
  const task = yield* store.getTask(project.id, taskRef);
  const evidenceThemes = task.ui
    ? (yield* loadProjectConfig(cli.home, project.prefix)).themes
    : null;
  const created = yield* store.startAttempt(project.id, taskRef, {
    kind: yield* a.need("kind"),
    mechanism: yield* a.need("mechanism"),
    provider: a.str("provider"),
    model: a.str("model"),
    options: yield* a.json("options"),
    profile: a.str("profile"),
    strategy: a.str("strategy"),
    coordinatorModel: a.str("coordinator-model"),
    reason: a.str("reason"),
    contextMode: a.str("context-mode"),
    sourceThread: a.str("source-thread"),
    repairOf: a.str("repair-of"),
    clientRequestId: a.str("client-request-id"),
    baseCommit: a.str("base-commit"),
    environmentId: a.str("environment-id"),
    actor: yield* a.actor("coordinator"),
  });
  // human output is the key and the client request id the coordinator may pass on dispatch
  yield* cli.emit(created, () => `${created.key}  ${created.client_request_id ?? "—"}`);
  if (evidenceThemes !== null) {
    yield* Effect.sync(() => cli.io.err(uiEvidenceHint(created.key, evidenceThemes)));
  }
});

const update = Effect.fn("cli.attempt.update")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    status: { type: "string" },
    "thread-id": { type: "string" },
    "thread-link": { type: "string" },
    "t3-task-id": { type: "string" },
    "environment-id": { type: "string" },
    "executed-model": { type: "string" },
    worktree: { type: "string" },
    branch: { type: "string" },
    pr: { type: "string" },
    "diff-location": { type: "string" },
    "add-fallback": { type: "string", multiple: true },
    "add-commit": { type: "string", multiple: true },
    "add-check": { type: "string", multiple: true },
  });
  const patch: AttemptPatch = { actor: yield* a.actor("coordinator") };
  const project = yield* cli.project;
  if (a.has("status")) patch.status = a.str("status");
  const map = [
    ["thread-id", "thread_id"],
    ["thread-link", "thread_link"],
    ["t3-task-id", "t3_task_id"],
    ["environment-id", "environment_id"],
    ["executed-model", "executed_model"],
    ["worktree", "worktree"],
    ["branch", "branch"],
    ["diff-location", "diff_location"],
  ] as const;
  for (const [flag, col] of map) if (a.has(flag)) patch[col] = a.str(flag);
  if (a.has("pr")) {
    const raw = a.str("pr") ?? "";
    if (raw.trim().length === 0) {
      patch.pr_url = null;
    } else {
      const href = pullRequestHref(raw, project.remote_url);
      if (href === null) {
        return yield* new UsageError({
          message: "--pr needs a pull request URL, or a number and a GitHub origin remote",
        });
      }
      patch.pr_url = href;
    }
  }
  patch.addFallback = yield* a.jsons("add-fallback");
  patch.addCommits = a.strs("add-commit");
  patch.addChecks = yield* Effect.forEach(yield* a.jsons("add-check"), (c) =>
    Option.match(decodeCheck(c), {
      onNone: () =>
        Effect.fail(
          new UsageError({
            message: '--add-check needs JSON like {"command":"bun test","result":"pass"}',
          }),
        ),
      onSome: (o) =>
        Effect.succeed({ command: o.command, result: o.result, detail: o.detail ?? null }),
    }),
  );
  const store = yield* cli.store;
  const updated = yield* store.updateAttempt(project.id, yield* a.pos(0, "attempt"), patch);
  return yield* cli.emit(updated, () => `${updated.key}  ${updated.status}`);
});

const finish = Effect.fn("cli.attempt.finish")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    status: { type: "string" },
    outcome: { type: "string" },
    "failure-class": { type: "string" },
    "failure-detail": { type: "string" },
    "retry-at": { type: "string" },
    "last-verified": { type: "string" },
    remaining: { type: "string" },
  });
  const store = yield* cli.store;
  const project = yield* cli.project;
  const done = yield* store.finishAttempt(project.id, yield* a.pos(0, "attempt"), {
    status: yield* a.need("status"),
    outcome: a.str("outcome"),
    failure_class: a.str("failure-class"),
    failure_detail: a.str("failure-detail"),
    retry_at: a.str("retry-at"),
    last_verified: a.str("last-verified"),
    remaining: a.str("remaining"),
    actor: yield* a.actor("coordinator"),
  });
  yield* cli.emit(done, () => `${done.key}  ${done.status}`);
});

/** Worker-facing: append-only evidence for exactly one attempt; never changes task or attempt state. */
const report = Effect.fn("cli.attempt.report")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { kind: { type: "string" }, file: { type: "string" } });
  const key = yield* a.pos(0, "attempt");
  const kind = yield* a.need("kind");
  const file = a.str("file");
  let body: string;
  if (file !== undefined) {
    body = yield* Effect.try({
      try: () => readFileSync(file, "utf8"),
      catch: () => new UsageError({ message: `cannot read --file ${file}` }),
    });
  } else {
    const stdin = yield* Effect.promise(() => cli.io.readStdin());
    if (stdin === null) {
      return yield* new UsageError({ message: "no report body: pipe it on stdin or pass --file" });
    }
    body = stdin;
  }
  const store = yield* cli.store;
  const project = yield* cli.project;
  const r = yield* store.addReport(project.id, key, kind, body);
  return yield* cli.emit(r, () => `reported ${r.kind} for ${r.attempt_key}`);
});

/**
 * Judge the project's live attempts from T3's projections. Read-only by default; `--apply` only
 * records a gone thread as `unknown` and a finished failure as `failed`.
 */
const reconcile = Effect.fn("cli.attempt.reconcile")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    { "stall-minutes": { type: "string" }, apply: { type: "boolean" } },
    0,
  );
  const stallMinutes = yield* a.int("stall-minutes");
  if (stallMinutes === 0) {
    return yield* new UsageError({ message: "--stall-minutes must be positive" });
  }
  const project = yield* cli.project;
  const judged = yield* cli.withStore(
    attemptLiveness(project.id, {
      t3State: t3StatePath(cli.env),
      stallMinutes,
      apply: a.bool("apply"),
    }),
  );
  return yield* cli.emit(judged, () => livenessText(project, judged));
});

const show = Effect.fn("cli.attempt.show")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { reports: { type: "boolean" }, attachments: { type: "boolean" } });
  const key = yield* a.pos(0, "attempt");
  const store = yield* cli.store;
  const project = yield* cli.project;
  const at = yield* store.getAttempt(project.id, key);
  const reports = yield* store.listReports(project.id, key);
  const attachments = a.bool("attachments")
    ? yield* store.listAttachments(project.id, key)
    : undefined;
  yield* cli.emit(
    { ...at, reports, ...(attachments === undefined ? {} : { attachments }) },
    () =>
      attemptDetail(at, a.bool("reports") ? reports : null) +
      (attachments === undefined
        ? ""
        : `\nattachments:\n${attachments.map((item) => `  ${attachmentLine(item)}`).join("\n")}`),
  );
});

const attach = Effect.fn("cli.attempt.attach")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {
    file: { type: "string" },
    kind: { type: "string" },
    theme: { type: "string" },
    name: { type: "string" },
  });
  const project = yield* cli.project;
  const file = resolve(cli.cwd, yield* a.need("file"));
  const attachment: AttemptAttachment = yield* cli.withStore(
    attachArtifact(project.id, yield* a.pos(0, "attempt"), {
      home: cli.home,
      file,
      kind: a.str("kind"),
      theme: a.str("theme"),
      name: a.str("name"),
      actor: yield* a.actor("worker"),
    }),
  );
  yield* cli.emit(attachment, () => attachmentLine(attachment));
});

export const attempt = Effect.fn("cli.attempt")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "start":
      return yield* start(rest);
    case "update":
      return yield* update(rest);
    case "finish":
      return yield* finish(rest);
    case "report":
      return yield* report(rest);
    case "reconcile":
      return yield* reconcile(rest);
    case "attach":
      return yield* attach(rest);
    case "show":
      return yield* show(rest);
    default:
      return yield* new UsageError({
        message: `unknown attempt command '${sub ?? ""}' (start|update|finish|report|reconcile|attach|show)`,
      });
  }
});
