import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { errorText, isNfError } from "@nf/core";
import type { NfError } from "@nf/core";
import type { SchemaError } from "effect/Schema";
import type { SqlError } from "effect/sql/SqlError";
import { ExitStatus, UsageError } from "./args.ts";
import { attempt } from "./commands/attempt.ts";
import { board } from "./commands/board.ts";
import { coordinator } from "./commands/coordinator.ts";
import { backup, importCmd, skills } from "./commands/ops.ts";
import { policy } from "./commands/policy.ts";
import { init, projectCommand, status } from "./commands/project.ts";
import { route } from "./commands/route.ts";
import { serve } from "./commands/serve.ts";
import { setup } from "./commands/setup.ts";
import { stats } from "./commands/stats.ts";
import { sync } from "./commands/sync.ts";
import { t3 } from "./commands/t3.ts";
import { task } from "./commands/task.ts";
import * as Cli from "./context.ts";
import type { Io } from "./context.ts";
import { HELP } from "./help.ts";
import { version } from "./version.ts";

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const processIo: Io = {
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
  readStdin,
};

/** Every rejection a command may return; `main` maps it to one line and an exit code. */
type CommandError = UsageError | ExitStatus | NfError | SchemaError | SqlError;

const dispatch = (
  command: string,
  rest: string[],
): Effect.Effect<unknown, CommandError, Cli.Cli> => {
  switch (command) {
    case "init":
      return init(rest);
    case "project":
      return projectCommand(rest);
    case "coordinator":
      return coordinator(rest);
    case "status":
      return status(rest);
    case "task":
      return task(rest);
    case "attempt":
      return attempt(rest);
    case "import":
      return importCmd(rest);
    case "sync":
      return sync(rest);
    case "stats":
      return stats(rest);
    case "board":
      return board(rest);
    case "serve":
      return serve(rest);
    case "t3":
      return t3(rest);
    case "policy":
      return policy(rest);
    case "route":
      return route(rest);
    case "backup":
      return backup(rest);
    case "skills":
      return skills(rest);
    case "setup":
      return setup(rest);
    default:
      return Effect.fail(new UsageError({ message: `unknown command '${command}'` }));
  }
};

/** Run the CLI; resolves to the process exit code. */
export async function main(
  argv: string[],
  io: Io = processIo,
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.out(HELP + "\n");
    return command === undefined ? 2 : 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    io.out(`nf ${version()}\n`);
    return 0;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.out(HELP + "\n");
    return 0;
  }
  const program = dispatch(command, rest).pipe(
    // The CLI entry point owns the per-invocation context.
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    Effect.provide(Cli.layer({ io, env, cwd, globals: Cli.scanGlobals(rest) })),
  );
  const exit = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(exit)) return 0;
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    const error = failure.value;
    if (error instanceof ExitStatus) return error.code;
    if (error instanceof UsageError) {
      io.err(`nf: ${error.message} (see 'nf help')\n`);
      return 2;
    }
    if (isNfError(error)) {
      io.err(`nf: ${error.message}\n`);
      return 1;
    }
  }
  const error = Cause.squash(exit.cause);
  io.err(`nf: internal error: ${errorText(error)}\n`);
  if (env["NF_DEBUG"]) io.err(Cause.pretty(exit.cause) + "\n");
  return 1;
}
