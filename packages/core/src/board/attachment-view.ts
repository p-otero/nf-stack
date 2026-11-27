import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as Effect from "effect/Effect";
import sharp from "sharp";
import { ATTACHMENT_KIND, ATTACHMENT_THEME, ATTACHMENT_VIEW_KIND } from "@nf/contracts";
import type { AttemptAttachment, AttachmentView } from "@nf/contracts";
import { isScreenshotFile } from "../domain/attachment.ts";

/** A snapshot's thumbnails are this wide at most: the strip shows them at 80 px, the lightbox links the file. */
export const THUMBNAIL_WIDTH = 320;

/** All thumbnails of one snapshot together stay under this, so the page is still one small file. */
export const MAX_THUMBNAILS_BYTES = 8 * 1024 * 1024;

export interface AttachmentBudget {
  remaining: number;
}

export const attachmentBudget = (): AttachmentBudget => ({ remaining: MAX_THUMBNAILS_BYTES });

/** How a view reaches an attachment's bytes: inlined for a snapshot, a URL for a live board. */
interface ImageSource {
  readonly src: string;
  readonly href: string;
  readonly thumbnail?: string;
}

type AttachmentSource = (attachment: AttemptAttachment) => ImageSource;

const fileUrl = (attachment: AttemptAttachment): string => pathToFileURL(attachment.path).href;

const readable = (attachment: AttemptAttachment): boolean => existsSync(attachment.path);

/**
 * A downscaled JPEG data URI for the snapshot's strip; `undefined` when the file is not an image,
 * cannot be decoded or no longer fits the snapshot's budget. The full-size image stays a file link.
 */
const thumbnail = Effect.fnUntraced(function* (
  attachment: AttemptAttachment,
  budget: AttachmentBudget,
) {
  if (!isScreenshotFile(attachment.path) || !readable(attachment)) return undefined;
  const bytes = yield* Effect.orElseSucceed(
    Effect.tryPromise({
      try: async (): Promise<Buffer> => {
        const image = sharp(attachment.path, { failOn: "none" }).rotate();
        const meta = await image.metadata();
        const width =
          meta.width === undefined ? THUMBNAIL_WIDTH : Math.min(meta.width, THUMBNAIL_WIDTH);
        return image.resize({ width, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
      },
      catch: () => "thumbnail_failed" as const,
    }),
    (): Buffer | undefined => undefined,
  );
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > budget.remaining) return undefined;
  budget.remaining -= bytes.byteLength;
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
});

const snapshotSource = (
  budget: AttachmentBudget,
): ((attachment: AttemptAttachment) => Effect.Effect<ImageSource>) => {
  return (attachment) =>
    Effect.map(thumbnail(attachment, budget), (embedded) => {
      const href = fileUrl(attachment);
      return embedded === undefined
        ? { src: href, href }
        : { src: href, href, thumbnail: embedded };
    });
};

const servedSource = (
  base: string,
): ((attachment: AttemptAttachment) => Effect.Effect<ImageSource>) => {
  return (attachment) => {
    const url = `${base}/${encodeURIComponent(attachment.id)}`;
    return Effect.succeed({ src: url, href: url });
  };
};

interface ScreenshotPair {
  light?: AttemptAttachment | undefined;
  dark?: AttemptAttachment | undefined;
}

const pairScreenshots = (
  attachments: readonly AttemptAttachment[],
): Map<string, ScreenshotPair> => {
  const pairs = new Map<string, ScreenshotPair>();
  for (const attachment of attachments) {
    if (attachment.kind !== ATTACHMENT_KIND.SCREENSHOT || attachment.theme === null) continue;
    const pair = pairs.get(attachment.name) ?? {};
    if (attachment.theme === ATTACHMENT_THEME.LIGHT && pair.light === undefined) {
      pair.light = attachment;
    }
    if (attachment.theme === ATTACHMENT_THEME.DARK && pair.dark === undefined) {
      pair.dark = attachment;
    }
    pairs.set(attachment.name, pair);
  }
  return pairs;
};

const missingView = (
  attachment: AttemptAttachment,
  name: string,
  source: AttachmentSource,
): AttachmentView => ({
  id: attachment.id,
  name,
  kind: ATTACHMENT_VIEW_KIND.FILE,
  src: source(attachment).src,
  alt: name,
});

const screenshotView = (
  name: string,
  pair: ScreenshotPair,
  source: AttachmentSource,
): AttachmentView | undefined => {
  const primary = pair.light ?? pair.dark;
  if (primary === undefined) return undefined;
  const light = pair.light !== undefined && readable(pair.light) ? source(pair.light) : undefined;
  const dark = pair.dark !== undefined && readable(pair.dark) ? source(pair.dark) : undefined;
  const first = light ?? dark;
  if (first === undefined) return missingView(primary, name, source);
  return {
    id: primary.id,
    name,
    kind: ATTACHMENT_VIEW_KIND.IMAGE,
    src: first.src,
    ...(dark === undefined ? {} : { srcDark: dark.src }),
    ...(first.thumbnail === undefined ? {} : { thumbnail: first.thumbnail }),
    ...(dark?.thumbnail === undefined ? {} : { thumbnailDark: dark.thumbnail }),
    alt: name,
    href: first.href,
  };
};

const singleView = (attachment: AttemptAttachment, source: AttachmentSource): AttachmentView => {
  const image = source(attachment);
  const present = readable(attachment);
  return {
    id: attachment.id,
    name: attachment.name,
    kind:
      present && isScreenshotFile(attachment.path)
        ? ATTACHMENT_VIEW_KIND.IMAGE
        : ATTACHMENT_VIEW_KIND.FILE,
    src: image.src,
    ...(present && image.thumbnail !== undefined ? { thumbnail: image.thumbnail } : {}),
    alt: attachment.name,
    ...(present ? { href: image.href } : {}),
  };
};

/**
 * Screenshots of one screen pair by name and theme; every other attachment stays on its own.
 * With `base`, images are addressed as `${base}/${id}` and served whole by `nf serve`; without it
 * the strip gets a downscaled data URI and the full-size image stays a `file://` link, so the
 * snapshot needs no embedded originals.
 */
export const attachmentViews = Effect.fn("Board.attachmentViews")(function* (
  attachments: readonly AttemptAttachment[],
  budget: AttachmentBudget,
  base?: string,
) {
  const resolve = base === undefined ? snapshotSource(budget) : servedSource(base);
  const sources = new Map<string, ImageSource>();
  for (const attachment of attachments) {
    sources.set(attachment.id, yield* resolve(attachment));
  }
  const source: AttachmentSource = (attachment) =>
    sources.get(attachment.id) ?? { src: fileUrl(attachment), href: fileUrl(attachment) };
  const pairs = pairScreenshots(attachments);
  const paired = new Set<string>();
  const views: AttachmentView[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === ATTACHMENT_KIND.SCREENSHOT && attachment.theme !== null) {
      if (paired.has(attachment.name)) continue;
      paired.add(attachment.name);
      const view = screenshotView(attachment.name, pairs.get(attachment.name) ?? {}, source);
      if (view !== undefined) views.push(view);
      continue;
    }
    views.push(singleView(attachment, source));
  }
  return views;
});
