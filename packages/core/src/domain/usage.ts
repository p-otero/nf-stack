import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AGGREGATE_SOURCE_PREFIX, USAGE_STATUS } from "@nf/contracts";
import type { TokenFields, UsageStatus } from "@nf/contracts";

export function isAggregateSourceKey(key: string): boolean {
  return key.startsWith(AGGREGATE_SOURCE_PREFIX);
}

// Leaf decoders for untrusted source fields. A value that does not decode is unknown (null),
// never zero, so a malformed field can only make usage partial, not wrong.

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const decodeNonNegative = Schema.decodeUnknownOption(NonNegative);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

export type Obj = { readonly [key: string]: unknown };

/** A plain JSON object, or null for anything else (arrays, primitives, null). */
export function obj(value: unknown): Obj | null {
  if (Array.isArray(value)) return null;
  return Option.getOrNull(decodeObject(value));
}

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** JSON text holding an object, or null (not text, not JSON, or not an object). */
export function parseJsonObject(text: unknown): Obj | null {
  return Option.match(decodeJsonText(text), { onNone: () => null, onSome: obj });
}

/** Non-negative token count, truncated; anything else is unknown (null), never zero. */
export function tokenCount(value: unknown): number | null {
  return Option.match(decodeNonNegative(value), { onNone: () => null, onSome: Math.trunc });
}

export function money(value: unknown): number | null {
  return Option.getOrNull(decodeNonNegative(value));
}

/** Canonical UTC ISO string, or null when the value is not a usable timestamp. */
export function utcTimestamp(value: unknown): string | null {
  return Option.match(decodeString(value), {
    onNone: () => null,
    onSome: (text) => {
      const ms = Date.parse(text);
      return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    },
  });
}

export function textId(value: unknown): string | null {
  return Option.match(decodeString(value), {
    onNone: () => null,
    onSome: (text) => (text.trim().length > 0 ? text.trim() : null),
  });
}

const decodeReportedStatus = Schema.decodeUnknownOption(
  Schema.Literals(Object.values(USAGE_STATUS)),
);

/**
 * Whether all priced consumption is known. Reasoning is an optional subset of output, so its
 * absence does not make otherwise complete usage partial.
 */
export function usageStatus(tokens: TokenFields, reported: unknown): UsageStatus {
  const declared = decodeReportedStatus(reported);
  if (Option.isSome(declared)) return declared.value;
  const priced = [
    tokens.input_tokens,
    tokens.output_tokens,
    tokens.cache_read_tokens,
    tokens.cache_write_tokens,
  ].filter((value) => value !== null).length;
  if (priced === 0) return USAGE_STATUS.UNAVAILABLE;
  return priced === 4 ? USAGE_STATUS.COMPLETE : USAGE_STATUS.PARTIAL;
}

export function emptyTokens(): TokenFields {
  return {
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
  };
}
