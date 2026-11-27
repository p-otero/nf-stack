import { readFileSync } from "node:fs";
import * as Schema from "effect/Schema";

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.String,
      engines: Schema.optional(Schema.Struct({ node: Schema.optional(Schema.String) })),
    }),
  ),
);

export interface Manifest {
  readonly version: string;
  readonly engines?: { readonly node?: string } | undefined;
}

/** `nf`'s own manifest: `packages/cli` in a checkout, the published package after an npm install. */
export function manifest(): Manifest {
  return decodeManifest(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
}

/** The `nf` version, from this package's manifest. */
export function version(): string {
  return manifest().version;
}
