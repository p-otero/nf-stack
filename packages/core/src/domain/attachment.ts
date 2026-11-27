import { extname, join } from "node:path";
import { RECORDING_EXTENSIONS, SCREENSHOT_EXTENSIONS } from "@nf/contracts";

const unsafePathCharacters = /[^A-Za-z0-9._-]+/g;
const edgeSeparators = /^[-.]+|[-.]+$/g;

export const attachmentExtension = (file: string): string => extname(file).toLowerCase();

export const isScreenshotFile = (file: string): boolean =>
  SCREENSHOT_EXTENSIONS.includes(attachmentExtension(file));

export const isRecordingFile = (file: string): boolean =>
  RECORDING_EXTENSIONS.includes(attachmentExtension(file));

const attachmentSlug = (name: string): string =>
  name.trim().toLowerCase().replace(unsafePathCharacters, "-").replace(edgeSeparators, "") ||
  "attachment";

/** Content-hashed: the same file attached twice lands on one path, so a copy never overwrites. */
export const attachmentFileName = (name: string, extension: string, sha256: string): string =>
  `${attachmentSlug(name)}-${sha256.slice(0, 12)}${extension}`;

export const artifactDirectory = (
  home: string,
  projectName: string,
  taskKey: string,
  attemptKey: string,
): string => join(home, "artifacts", attachmentSlug(projectName), taskKey, attemptKey);
