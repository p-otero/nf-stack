import * as Schema from "effect/Schema";

/**
 * A rejected operation (invalid input, illegal transition, broken invariant, unavailable
 * source). `code` is a stable category for callers; `message` is the one line the CLI prints.
 */
export class NfError extends Schema.TaggedError<NfError, { readonly brand: unique symbol }>()(
  "NfError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

export const isNfError = Schema.is(NfError);
