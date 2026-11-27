import { parseArgs } from "node:util";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ACTOR_ROLES } from "@nf/core";
import type { ActorRole } from "@nf/core";

/** Bad command line (exit code 2), as opposed to a rejected operation (exit code 1). */
export class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()(
  "UsageError",
  {
    message: Schema.String,
  },
) {}

/** The command succeeded but its result requires this process exit code (stale catalog: 3). */
export class ExitStatus extends Schema.TaggedError<ExitStatus, { readonly brand: unique symbol }>()(
  "ExitStatus",
  {
    code: Schema.Int,
  },
) {}

const usage = (message: string) => Effect.fail(new UsageError({ message }));

export interface OptDef {
  type: "string" | "boolean";
  multiple?: boolean;
}

export type Spec = Record<string, OptDef>;

export const COMMON: Spec = {
  json: { type: "boolean" },
  project: { type: "string" },
  actor: { type: "string" },
  help: { type: "boolean" },
};

type Raw = Record<string, string | boolean | (string | boolean)[] | undefined>;

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeActor = Schema.decodeUnknownOption(Schema.Literals(ACTOR_ROLES));

function parseJson(name: string, text: string): Effect.Effect<unknown, UsageError> {
  return Option.match(decodeJson(text), {
    onNone: () => usage(`--${name} is not valid JSON`),
    onSome: Effect.succeed,
  });
}

/** Parsed options and positionals of one command. Required values fail with `UsageError`. */
export class Args {
  readonly positionals: string[];
  private readonly values: Raw;

  constructor(values: Raw, positionals: string[]) {
    this.values = values;
    this.positionals = positionals;
  }

  has(name: string): boolean {
    return this.values[name] !== undefined;
  }

  str(name: string): string | undefined {
    const v = this.values[name];
    return typeof v === "string" ? v : undefined;
  }

  strs(name: string): string[] {
    const v = this.values[name];
    if (v === undefined) return [];
    return (Array.isArray(v) ? v : [v]).map(String);
  }

  bool(name: string): boolean {
    return this.values[name] === true;
  }

  /** Required string option. */
  need(name: string): Effect.Effect<string, UsageError> {
    const v = this.str(name);
    return v === undefined ? usage(`missing --${name}`) : Effect.succeed(v);
  }

  int(name: string): Effect.Effect<number | undefined, UsageError> {
    const v = this.str(name);
    if (v === undefined) return Effect.undefined;
    return /^\d+$/.test(v) ? Effect.succeed(Number(v)) : usage(`--${name} must be a number`);
  }

  json(name: string): Effect.Effect<unknown, UsageError> {
    const v = this.str(name);
    return v === undefined ? Effect.undefined : parseJson(name, v);
  }

  jsons(name: string): Effect.Effect<unknown[], UsageError> {
    return Effect.forEach(this.strs(name), (v) => parseJson(name, v));
  }

  /** Positional `i`, required. */
  pos(i: number, label: string): Effect.Effect<string, UsageError> {
    const v = this.positionals[i];
    return v === undefined ? usage(`missing <${label}>`) : Effect.succeed(v);
  }

  actor(fallback: ActorRole): Effect.Effect<ActorRole, UsageError> {
    const v = this.str("actor");
    if (v === undefined) return Effect.succeed(fallback);
    return Option.match(decodeActor(v), {
      onNone: () => usage(`invalid actor '${v}' (one of ${ACTOR_ROLES.join("|")})`),
      onSome: Effect.succeed,
    });
  }
}

/** A TCP port from `--port`; `min` is 0 when the caller may pick a free one. */
export const portValue = (
  text: string | undefined,
  fallback: number,
  min: 0 | 1,
): Effect.Effect<number, UsageError> => {
  if (text === undefined) return Effect.succeed(fallback);
  const port = Number(text);
  if (!Number.isInteger(port) || port < min || port > 65535) {
    return usage(`--port needs a number from ${min} to 65535, not '${text}'`);
  }
  return Effect.succeed(port);
};

export const parse = Effect.fn("cli.args.parse")(function* (
  argv: string[],
  spec: Spec,
  maxPositionals = 1,
) {
  const out = yield* Effect.try({
    try: () =>
      parseArgs({
        args: argv,
        options: { ...COMMON, ...spec },
        allowPositionals: true,
        strict: true,
      }),
    catch: (err) =>
      new UsageError({
        message:
          err instanceof Error ? (err.message.split("\n")[0] ?? "bad arguments") : "bad arguments",
      }),
  });
  if (out.positionals.length > maxPositionals) {
    return yield* usage(`unexpected argument '${out.positionals[maxPositionals]}'`);
  }
  return new Args(out.values, out.positionals);
});
