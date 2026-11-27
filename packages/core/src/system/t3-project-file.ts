import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { NfError } from "@nf/contracts";
import { errorText } from "../domain/errors.ts";
import { formatIssuePaths } from "../domain/schema-errors.ts";
import { isRecord } from "../domain/validate.ts";

/** T3 Code's checked-in project configuration, at the root of the checkout. */
export const T3_PROJECT_FILE_NAME = "t3.json";
export const T3_PROJECT_FILE_SCHEMA_URL = "https://t3.codes/schema/t3.json";
export const BOARD_SCRIPT_NAME = "Board";

/** T3 Code's `ProjectScriptIcon`: it ignores the whole file when an icon is outside it. */
const T3_SCRIPT_ICONS = ["play", "test", "lint", "configure", "build", "debug"] as const;

/** One `scripts[]` entry of T3 Code's `t3ProjectFile.ts`. */
const T3ProjectScript = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  icon: Schema.optionalKey(Schema.Literals(T3_SCRIPT_ICONS)),
  runOnWorktreeCreate: Schema.optionalKey(Schema.Boolean),
  runOnSettle: Schema.optionalKey(Schema.Boolean),
  stopOnSettle: Schema.optionalKey(Schema.Boolean),
  async: Schema.optionalKey(Schema.Boolean),
  previewUrl: Schema.optionalKey(Schema.String),
  autoOpenPreview: Schema.optionalKey(Schema.Boolean),
});
export type T3ProjectScript = typeof T3ProjectScript.Type;

const T3ProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(Schema.String),
  iconPath: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(Schema.Array(T3ProjectScript)),
});

/** Validates only: the merge edits the parsed JSON, so keys T3 Code adds later survive. */
const decodeProjectFile = Schema.decodeUnknownResult(T3ProjectFile);

export interface BoardScriptOptions {
  /** What T3 Code runs, e.g. `nf serve`. */
  readonly command: string;
  /** The port the server listens on; the preview URL names it. */
  readonly port: number;
  /** The project prefix the preview URL selects. */
  readonly prefix: string;
}

/** A `scripts[]` entry as NF writes it: the preview URL is the part T3 Code opens. */
export type BoardScript = T3ProjectScript & { readonly previewUrl: string };

export interface InitBoardScriptOptions extends BoardScriptOptions {
  /** The registered project's checkout root. */
  readonly root: string;
}

export interface BoardScriptResult {
  readonly file: string;
  /** The file did not exist and was created. */
  readonly created: boolean;
  /** The file's text changed; an unchanged file is not rewritten. */
  readonly changed: boolean;
  readonly script: BoardScript;
}

const boardScript = (options: BoardScriptOptions): BoardScript => ({
  name: BOARD_SCRIPT_NAME,
  command: options.command,
  icon: "play",
  previewUrl: `http://localhost:${options.port}/?project=${options.prefix}`,
  autoOpenPreview: true,
  runOnWorktreeCreate: false,
});

const t3ProjectFilePath = (root: string): string => join(root, T3_PROJECT_FILE_NAME);

const invalidProjectFile = (file: string, issues: readonly string[]) =>
  new NfError({
    code: "invalid_t3_project_file",
    message: `invalid ${file}:\n  ${issues.join("\n  ")}`,
  });

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Array.isArray(value);

function mergeBoardScript(
  document: Record<string, unknown>,
  script: T3ProjectScript,
): Record<string, unknown> {
  const current = isUnknownArray(document["scripts"]) ? document["scripts"] : [];
  const scripts = [...current];
  const existing = scripts.findIndex((entry) => isRecord(entry) && entry["name"] === script.name);
  if (existing < 0) scripts.push(script);
  else scripts[existing] = script;
  const merged: Record<string, unknown> = { ...document, scripts };
  return merged["$schema"] === undefined
    ? { $schema: T3_PROJECT_FILE_SCHEMA_URL, ...merged }
    : merged;
}

const readProjectFile = Effect.fnUntraced(function* (file: string) {
  if (!existsSync(file)) return null;
  return yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (error) =>
      new NfError({
        code: "t3_project_file_unreadable",
        message: `${file} cannot be read: ${errorText(error)}`,
      }),
  });
});

const parseProjectFile = Effect.fnUntraced(function* (text: string, file: string) {
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: (error) => invalidProjectFile(file, [`json: ${errorText(error)}`]),
  });
  if (!isJsonObject(parsed)) return yield* invalidProjectFile(file, ["expected a JSON object"]);
  const decoded = decodeProjectFile(parsed);
  if (Result.isFailure(decoded)) {
    return yield* invalidProjectFile(file, formatIssuePaths(decoded.failure.issue));
  }
  return parsed;
});

const writeProjectFile = (file: string, text: string) =>
  Effect.try({
    try: () => writeFileSync(file, text, "utf8"),
    catch: (error) =>
      new NfError({
        code: "t3_project_file_unwritable",
        message: `${file} cannot be written: ${errorText(error)}`,
      }),
  });

/** Merge the live board script into the project's `t3.json`, creating the file when missing. */
export const initBoardScript = Effect.fn("T3ProjectFile.initBoardScript")(function* (
  options: InitBoardScriptOptions,
) {
  const file = t3ProjectFilePath(options.root);
  const existing = yield* readProjectFile(file);
  const document = existing === null ? {} : yield* parseProjectFile(existing, file);
  const script = boardScript(options);
  const text = `${JSON.stringify(mergeBoardScript(document, script), null, 2)}\n`;
  const created = existing === null;
  if (text === existing)
    return { file, created, changed: false, script } satisfies BoardScriptResult;
  yield* writeProjectFile(file, text);
  return { file, created, changed: true, script } satisfies BoardScriptResult;
});
