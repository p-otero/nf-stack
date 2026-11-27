import * as Effect from "effect/Effect";
import { NfError } from "@nf/contracts";

/** Keys recorded before project prefixes: `T-001`, `T-001-A1`, still accepted everywhere. */
export const LEGACY_TASK_PREFIX = "T";

const MAX_PREFIX_LENGTH = 8;
const PREFIX_PATTERN = /^[A-Z0-9]{1,8}$/;
const LEGACY_TASK_KEY = /^T-?(\d+)$/i;
const PREFIXED_TASK_KEY = /^([A-Z0-9]{1,8})-(\d+)$/i;
const ATTEMPT_KEY = /^(.+)-A(\d+)$/i;

export function formatTaskKey(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

export function formatAttemptKey(taskKey: string, seq: number): string {
  return `${taskKey}-A${seq}`;
}

const badKey = (message: string) => Effect.fail(new NfError({ code: "bad_key", message }));

/**
 * Accepts the project's own prefixed key (`NF-018`) and the legacy form (`t-18`, `T18`), and
 * returns the canonical prefixed key.
 */
export const normalizeTaskKey = (prefix: string, input: string): Effect.Effect<string, NfError> => {
  const text = input.trim();
  const legacy = LEGACY_TASK_KEY.exec(text);
  if (legacy?.[1] !== undefined) return Effect.succeed(formatTaskKey(prefix, Number(legacy[1])));
  const parsed = PREFIXED_TASK_KEY.exec(text);
  if (parsed?.[1]?.toUpperCase() === prefix && parsed[2] !== undefined) {
    return Effect.succeed(formatTaskKey(prefix, Number(parsed[2])));
  }
  return badKey(
    `invalid task key '${input}' (expected ${formatTaskKey(prefix, 1)} or ${formatTaskKey(LEGACY_TASK_PREFIX, 1)})`,
  );
};

export function taskSeq(key: string): number | null {
  const m = /^[A-Z0-9]{1,8}-(\d+)$/i.exec(key);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** `NF-018-A2` -> { taskRef: 'NF-018', seq: 2 }; the task part is normalized by the store. */
export const splitAttemptKey = (
  input: string,
): Effect.Effect<{ taskRef: string; seq: number }, NfError> => {
  const match = ATTEMPT_KEY.exec(input.trim());
  const taskRef = match?.[1];
  const seq = match?.[2];
  if (taskRef === undefined || seq === undefined) {
    return badKey(`invalid attempt key '${input}' (expected <prefix>-001-A1 or T-001-A1)`);
  }
  return Effect.succeed({ taskRef, seq: Number(seq) });
};

export function attemptSeq(key: string): number | null {
  const m = /-A(\d+)$/.exec(key);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** `xyz` -> `XYZ`; prefixes are uppercase letters and digits, unique per store. */
export const normalizePrefix = (input: string): Effect.Effect<string, NfError> => {
  const prefix = input.trim().toUpperCase();
  return PREFIX_PATTERN.test(prefix)
    ? Effect.succeed(prefix)
    : Effect.fail(
        new NfError({
          code: "bad_prefix",
          message: `invalid project prefix '${input}' (1-8 uppercase letters or digits)`,
        }),
      );
};

function nameWords(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter((word) => word.length > 0)
    .map((word) => word.toUpperCase());
}

/**
 * Letters a derived prefix may grow through. The first word comes first (up to two letters), then
 * the initials of the other words, then the remaining letters in reading order: `oxlint-rules`
 * yields `OXRLINTULES`, `nf-stack` yields `NFSTACK`.
 */
function prefixStream(name: string): string {
  const words = nameWords(name);
  const first = words[0] ?? "";
  const initials = words.slice(1).map((word) => word[0] ?? "");
  const rest = words.map((word, i) => (i === 0 ? word.slice(2) : word.slice(1))).join("");
  return (first.slice(0, 2) + initials.join("") + rest)
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, MAX_PREFIX_LENGTH);
}

/**
 * The documented derivation: a two-letter first word is already an abbreviation and becomes the
 * prefix (`nf-stack` -> `NF`); otherwise the first two letters of the first word plus the first
 * letter of the following words (`oxlint-rules` -> `OXR`, `demo` -> `DE`).
 */
export function deriveProjectPrefix(name: string): string {
  const stream = prefixStream(name);
  if (stream.length === 0) return "NF";
  const words = nameWords(name);
  const first = words[0] ?? "";
  const base = words.length === 1 || first.length <= 2 ? 2 : 3;
  return stream.slice(0, Math.min(base, stream.length));
}

function numbered(stem: string, n: number): string {
  const suffix = String(n);
  return `${stem.slice(0, MAX_PREFIX_LENGTH - suffix.length)}${suffix}`;
}

/** `name`'s prefix, extended with its following letters (then a number) until it is free. */
export function uniqueProjectPrefix(name: string, taken: ReadonlySet<string>): string {
  const stream = prefixStream(name);
  const base = deriveProjectPrefix(name);
  if (!taken.has(base)) return base;
  for (let length = base.length + 1; length <= stream.length; length++) {
    const candidate = stream.slice(0, length);
    if (!taken.has(candidate)) return candidate;
  }
  const stem = stream.length > 0 ? stream : base;
  let n = 2;
  while (taken.has(numbered(stem, n))) n++;
  return numbered(stem, n);
}
