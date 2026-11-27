import { basename, extname, join } from "node:path";
import * as Effect from "effect/Effect";
import {
  ATTACHMENT_KIND,
  ATTACHMENT_KINDS,
  ATTACHMENT_THEMES,
  NfError,
  RECORDING_EXTENSIONS,
  SCREENSHOT_EXTENSIONS,
} from "@nf/contracts";
import type { ActorRole, AttachmentKind, AttachmentTheme, AttemptAttachment } from "@nf/contracts";
import {
  artifactDirectory,
  attachmentExtension,
  attachmentFileName,
  isRecordingFile,
  isScreenshotFile,
} from "../domain/attachment.ts";
import { oneOf, text } from "../domain/validate.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import { readArtifactSource, writeArtifact } from "../system/artifacts.ts";
import { loadProjectConfig, projectConfigFile } from "../system/project-config.ts";

export interface AttachArtifactInput {
  /** `$NF_HOME`, where the artifact tree lives. */
  home: string;
  file: string;
  kind?: string | undefined;
  theme?: string | undefined;
  name?: string | undefined;
  actor?: ActorRole | undefined;
}

const refuseMedia = (kind: AttachmentKind, file: string) =>
  new NfError({
    code: "invalid_value",
    message: `--kind ${kind} needs ${kind === ATTACHMENT_KIND.SCREENSHOT ? `an image (${SCREENSHOT_EXTENSIONS.join(", ")})` : `a video (${RECORDING_EXTENSIONS.join(", ")})`}; ${file} is not one`,
  });

export const attachArtifact = Effect.fn("Attachments.attachArtifact")(function* (
  projectId: string,
  attemptKey: string,
  input: AttachArtifactInput,
) {
  const store = yield* TaskStore;
  const attempt = yield* store.getAttempt(projectId, attemptKey);
  const project = yield* store.getProject(projectId);
  const config = yield* loadProjectConfig(input.home, project.prefix);
  const kind: AttachmentKind = yield* oneOf(
    "attachment kind",
    input.kind ?? ATTACHMENT_KIND.FILE,
    ATTACHMENT_KINDS,
  );
  const theme: AttachmentTheme | null =
    input.theme === undefined
      ? null
      : yield* oneOf("attachment theme", input.theme, ATTACHMENT_THEMES);
  if (kind === ATTACHMENT_KIND.SCREENSHOT && !isScreenshotFile(input.file)) {
    return yield* refuseMedia(kind, input.file);
  }
  if (kind === ATTACHMENT_KIND.RECORDING && !isRecordingFile(input.file)) {
    return yield* refuseMedia(kind, input.file);
  }
  if (kind === ATTACHMENT_KIND.SCREENSHOT && theme === null) {
    return yield* new NfError({
      code: "invalid_value",
      message: `a screenshot needs --theme ${config.themes.join("|")} so each project theme captures the same screen`,
    });
  }
  if (theme !== null && !config.themes.includes(theme)) {
    return yield* new NfError({
      code: "invalid_value",
      message: `--theme ${theme} is not declared for this project (ui.themes: ${config.themes.join(", ")}); set it in ${projectConfigFile(input.home, project.prefix)}`,
    });
  }
  const name = yield* text(
    "attachment name",
    input.name ?? basename(input.file, extname(input.file)),
  );
  const source = yield* readArtifactSource(input.file);
  const extension = attachmentExtension(input.file);
  const target = join(
    artifactDirectory(input.home, project.name, attempt.task_key, attempt.key),
    attachmentFileName(name, extension, source.sha256),
  );
  yield* writeArtifact(target, source.bytes);
  const attachment: AttemptAttachment = yield* store.addAttachment(projectId, attemptKey, {
    kind,
    theme,
    name,
    path: target,
    bytes: source.size,
    sha256: source.sha256,
    actor: input.actor,
  });
  return attachment;
});
