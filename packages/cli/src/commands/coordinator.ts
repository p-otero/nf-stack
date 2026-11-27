import * as Effect from "effect/Effect";
import { registerCoordinatorThread } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";

const register = Effect.fn("cli.coordinator.register")(function* (argv: string[]) {
  const cli = yield* Cli;
  // A bare --project means the current project, as `nf stats` reads it; the global selector
  // `--project <ref>` is already resolved by the CLI.
  const cleaned = argv.filter((arg, i) => {
    const next = argv[i + 1];
    return !(arg === "--project" && (next === undefined || next.startsWith("--")));
  });
  const a = yield* parse(cleaned, { thread: { type: "string" } }, 0);
  const project = yield* cli.project;
  const thread = a.str("thread") ?? project.coordinator_thread_id;
  if (thread === null) {
    return yield* new UsageError({
      message: "nf coordinator register needs --thread <id> (the project records no coordinator)",
    });
  }
  const result = yield* cli.withStore(registerCoordinatorThread(project.id, thread));
  return yield* cli.emit(
    { project: { id: project.id, prefix: project.prefix }, ...result },
    () =>
      `${result.created ? "registered" : "already registered"} ${result.thread} for ${project.name}`,
  );
});

export const coordinator = Effect.fn("cli.coordinator")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  if (sub === "register") return yield* register(rest);
  return yield* new UsageError({
    message: `unknown coordinator command '${sub ?? ""}' (register)`,
  });
});
