import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NfError } from "@nf/contracts";

const decodeLiteralOption = <T extends string>(allowed: readonly T[]) =>
  Schema.decodeUnknownOption(Schema.Literals(allowed));

/** Decode `value` as one of `allowed`, or reject with the CLI's `invalid <what>` message. */
export const oneOf = <T extends string>(
  what: string,
  value: string | null | undefined,
  allowed: readonly T[],
): Effect.Effect<T, NfError> =>
  Effect.fromOption(
    decodeLiteralOption(allowed)(value),
    () =>
      new NfError({
        code: "invalid_value",
        message: `invalid ${what} '${value ?? ""}' (one of ${allowed.join("|")})`,
      }),
  );

/** Required, trimmed text. */
export const text = (
  what: string,
  value: string | null | undefined,
): Effect.Effect<string, NfError> => {
  const v = (value ?? "").trim();
  return v.length > 0
    ? Effect.succeed(v)
    : Effect.fail(new NfError({ code: "invalid_value", message: `${what} must not be empty` }));
};

/** Optional text: trimmed, empty becomes null. */
export function optText(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && v.length > 0 ? v : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Stored JSON text back to a value; text that is not JSON is returned as-is. */
export function fromJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
