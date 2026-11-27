import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import { MAX_ATTACHMENT_BYTES, NfError } from "@nf/contracts";
import { attachmentExtension } from "../domain/attachment.ts";

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

/** The media type of an attachment file; `undefined` when the extension says nothing. */
export const artifactMimeType = (file: string): string | undefined =>
  MEDIA_TYPES[attachmentExtension(file)];

export interface ArtifactSource {
  readonly bytes: Buffer;
  readonly size: number;
  readonly sha256: string;
}

const unreadable = (file: string) =>
  new NfError({ code: "artifact_unreadable", message: `${file} cannot be read` });

const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

export const readArtifactSource = Effect.fn("Artifacts.readSource")(function* (file: string) {
  const size = yield* Effect.try({ try: () => statSync(file).size, catch: () => unreadable(file) });
  if (size > MAX_ATTACHMENT_BYTES) {
    return yield* new NfError({
      code: "artifact_too_large",
      message: `${file} is ${megabytes(size)} MB; attachments are capped at ${megabytes(MAX_ATTACHMENT_BYTES)} MB`,
    });
  }
  const bytes = yield* Effect.try({ try: () => readFileSync(file), catch: () => unreadable(file) });
  return {
    bytes,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  } satisfies ArtifactSource;
});

/** Write the bytes unless the content-hashed target already exists: an artifact is never overwritten. */
export const writeArtifact = (target: string, bytes: Buffer) =>
  Effect.sync(() => {
    mkdirSync(dirname(target), { recursive: true });
    if (!existsSync(target)) writeFileSync(target, bytes);
  });
