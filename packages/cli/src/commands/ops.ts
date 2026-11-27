import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NfError, backupKeep, backupStore, importTasksJson, linkSkills } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";
import { linkResultText } from "../format.ts";

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export const importCmd = Effect.fn("cli.import")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, {});
  const project = yield* cli.project;
  const given = a.positionals[0];
  const file = given ? resolve(cli.cwd, given) : join(project.root_path, ".nf", "tasks.json");
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () => new NfError({ code: "bad_import", message: `${file} cannot be read` }),
  });
  const doc = yield* Effect.fromOption(
    decodeJson(text),
    () => new NfError({ code: "bad_import", message: `${file} not valid JSON` }),
  );
  const r = yield* cli.withStore(importTasksJson(project.id, doc));
  yield* cli.emit({ file, ...r }, () => {
    const out = [
      `imported ${file} (schema v${r.schema_version})`,
      `tasks: ${r.tasks_created} created, ${r.tasks_skipped} skipped`,
      `attempts: ${r.attempts_created} created, ${r.attempts_skipped} skipped`,
      ...r.warnings.map((w) => `warning: ${w}`),
    ];
    return out.join("\n");
  });
});

export const backup = Effect.fn("cli.backup")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const file = yield* cli.withStore(backupStore(cli.home, { keep: backupKeep(cli.env) }));
  yield* cli.emit({ file }, () => file);
});

export const skills = Effect.fn("cli.skills")(function* (argv: string[]) {
  const cli = yield* Cli;
  const [sub, ...rest] = argv;
  if (sub !== "link")
    return yield* new UsageError({ message: `unknown skills command '${sub ?? ""}' (link)` });
  const a = yield* parse(
    rest,
    {
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      home: { type: "string" },
    },
    0,
  );
  const results = yield* Effect.sync(() =>
    linkSkills({
      home: a.str("home") ?? homedir(),
      dryRun: a.bool("dry-run"),
      force: a.bool("force"),
    }),
  );
  return yield* cli.emit(results, () => results.map(linkResultText).join("\n"));
});
