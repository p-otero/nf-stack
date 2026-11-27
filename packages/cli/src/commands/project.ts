import * as Effect from "effect/Effect";
import { NfError, attemptLiveness, gitInfo, t3StatePath } from "@nf/core";
import type { AttemptLivenessView, StatusSummary } from "@nf/core";
import { parse, UsageError } from "../args.ts";
import { Cli } from "../context.ts";
import { statusText } from "../format.ts";

type LiveAttempt = StatusSummary["live_attempts"][number];

const withVerdict = (
  attempt: LiveAttempt,
  verdict: AttemptLivenessView | undefined,
): LiveAttempt => ({
  ...attempt,
  liveness: verdict?.liveness ?? null,
  last_activity_at: verdict?.last_activity_at ?? null,
});

export const init = Effect.fn("cli.init")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      name: { type: "string" },
      prefix: { type: "string" },
      "coordinator-environment-id": { type: "string" },
      "coordinator-thread-id": { type: "string" },
      "coordinator-thread-link": { type: "string" },
    },
    0,
  );
  const git = yield* Effect.sync(() => gitInfo(cli.cwd));
  if (!git) {
    return yield* new NfError({
      code: "no_git",
      message: "not inside a Git repository; run 'nf init' from the project checkout",
    });
  }
  const store = yield* cli.store;
  const { project, created } = yield* store.registerProject({
    name: a.str("name"),
    prefix: a.str("prefix"),
    rootPath: git.root,
    remoteUrl: git.remoteUrl,
    coordinatorEnvironmentId: a.str("coordinator-environment-id"),
    coordinatorThreadId: a.str("coordinator-thread-id"),
    coordinatorThreadLink: a.str("coordinator-thread-link"),
  });
  return yield* cli.emit(
    { project, created },
    () =>
      `${created ? "registered" : "already registered"} ${project.name} [${project.prefix}] (${project.root_path})` +
      (project.remote_url ? ` origin ${project.remote_url}` : ""),
  );
});

const set = Effect.fn("cli.project.set")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { prefix: { type: "string" } }, 0);
  const store = yield* cli.store;
  const project = yield* store.setProjectPrefix((yield* cli.project).id, yield* a.need("prefix"));
  return yield* cli.emit(project, () => `${project.name}  prefix ${project.prefix}`);
});

export const projectCommand = Effect.fn("cli.project")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  if (sub === "set") return yield* set(rest);
  return yield* new UsageError({
    message: `unknown project command '${sub ?? ""}' (set)`,
  });
});

export const status = Effect.fn("cli.status")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const project = yield* cli.project;
  const summary = yield* (yield* cli.store).summary(project.id);
  const report = yield* cli.withStore(
    attemptLiveness(project.id, { t3State: t3StatePath(cli.env), bestEffort: true }),
  );
  const verdicts = new Map(report.attempts.map((attempt) => [attempt.attempt, attempt]));
  const merged: StatusSummary = {
    ...summary,
    live_attempts: summary.live_attempts.map((attempt) =>
      withVerdict(attempt, verdicts.get(attempt.key)),
    ),
  };
  yield* cli.emit({ project, ...merged }, () => statusText(project, merged));
});
