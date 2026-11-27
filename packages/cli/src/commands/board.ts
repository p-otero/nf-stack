import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import { boardData, boardViews, renderBoardSnapshot, t3StatePath } from "@nf/core";
import { parse } from "../args.ts";
import { boardTemplate } from "../board-page.ts";
import { Cli } from "../context.ts";
import { loadBoardPrices } from "../prices.ts";

/** `2026-11-15T22:50:00.000Z` -> `20261115T225000Z`, safe on every filesystem. */
function stamp(at: string): string {
  return at.replaceAll(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export const board = Effect.fn("cli.board")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { out: { type: "string" }, "json-only": { type: "boolean" } });
  const project = yield* cli.project;
  const at = new Date().toISOString();
  const jsonOnly = a.bool("json-only");
  const prices = yield* loadBoardPrices(cli.home, cli.env);
  const extension = jsonOnly ? "json" : "html";
  const out = a.str("out") ?? join(cli.home, "boards", `${project.name}-${stamp(at)}.${extension}`);
  let text: string;
  let count: number;
  if (jsonOnly) {
    const tasks = yield* cli.withStore(
      boardViews(project.id, at, { t3State: t3StatePath(cli.env), home: cli.home }),
    );
    text = JSON.stringify(tasks, null, 2) + "\n";
    count = tasks.length;
  } else {
    const data = yield* cli.withStore(
      boardData({
        projectId: project.id,
        at,
        home: cli.home,
        t3State: t3StatePath(cli.env),
        prices,
      }),
    );
    text = renderBoardSnapshot(yield* boardTemplate, data);
    count = data.tasks.length;
  }
  yield* Effect.sync(() => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  });
  yield* cli.emit({ path: out, tasks: count, bytes: Buffer.byteLength(text) }, () => out);
});
