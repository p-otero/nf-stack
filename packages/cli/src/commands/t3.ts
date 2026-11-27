import * as Effect from "effect/Effect";
import { BOARD_SCRIPT_NAME, initBoardScript } from "@nf/core";
import { parse, portValue, UsageError } from "../args.ts";
import { Cli } from "../context.ts";
import { DEFAULT_BOARD_PORT } from "./serve.ts";

const IMPORT_HINT =
  "Import it in T3 Code: project Actions settings -> Import scripts -> Import from t3.json " +
  "(a thread's scripts menu lists it under From t3.json)";

const boardCommand = (port: number): string =>
  port === DEFAULT_BOARD_PORT ? "nf serve" : `nf serve --port ${port}`;

const init = Effect.fn("cli.t3.init")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { port: { type: "string" } }, 0);
  const port = yield* portValue(a.str("port"), DEFAULT_BOARD_PORT, 1);
  const project = yield* cli.project;
  const result = yield* initBoardScript({
    root: project.root_path,
    prefix: project.prefix,
    port,
    command: boardCommand(port),
  });
  const outcome = result.created ? "created" : result.changed ? "updated" : "unchanged";
  return yield* cli.emit(
    result,
    () =>
      `nf t3 init: ${outcome} ${result.file}\n` +
      `  ${BOARD_SCRIPT_NAME}: ${result.script.command} (preview ${result.script.previewUrl})\n` +
      IMPORT_HINT,
  );
});

export const t3 = Effect.fn("cli.t3")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  if (sub === "init") return yield* init(rest);
  return yield* new UsageError({ message: `unknown t3 command '${sub ?? ""}' (init)` });
});
