import * as Effect from "effect/Effect";
import { ACTOR_ROLE, ATTACHMENT_KINDS, ATTACHMENT_THEMES } from "@nf/contracts";
import type { ActorRole, AttachmentKind, AttemptAttachment, AttachmentTheme } from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { oneOf, text } from "../domain/validate.ts";
import {
  decodeAttachment,
  decodeAttachmentAttemptKey,
  fail,
  one,
  type StoreContext,
} from "./store-rows.ts";
import type { AttemptStoreFamily } from "./attempts.persistence.ts";
import type { TaskStoreFamily } from "./tasks.persistence.ts";

export interface AddAttachmentInput {
  kind: string;
  theme?: string | null | undefined;
  name: string;
  path: string;
  bytes: number;
  sha256: string;
  actor?: ActorRole | undefined;
}

const SHA256 = /^[0-9a-f]{64}$/;

const withAttemptKey = (
  decoded: Omit<AttemptAttachment, "attempt_key">,
  attemptKey: string,
): AttemptAttachment => ({ ...decoded, attempt_key: attemptKey });

export const attachmentStore = (
  ctx: StoreContext,
  attempts: Pick<AttemptStoreFamily, "findAttemptRow">,
  tasks: Pick<TaskStoreFamily, "event">,
) => {
  const { sql, machine, now } = ctx;
  const { findAttemptRow } = attempts;
  const { event } = tasks;

  const addAttachment = Effect.fn("TaskStore.addAttachment")(function* (
    projectId: string,
    attemptKey: string,
    input: AddAttachmentInput,
  ) {
    const kind: AttachmentKind = yield* oneOf("attachment kind", input.kind, ATTACHMENT_KINDS);
    const theme: AttachmentTheme | null = input.theme
      ? yield* oneOf("attachment theme", input.theme, ATTACHMENT_THEMES)
      : null;
    const name = yield* text("attachment name", input.name);
    const path = yield* text("attachment path", input.path);
    if (!SHA256.test(input.sha256)) {
      return yield* fail("invalid_value", `attachment hash '${input.sha256}' is not a sha256`);
    }
    if (!Number.isInteger(input.bytes) || input.bytes < 0) {
      return yield* fail(
        "invalid_value",
        `attachment size ${String(input.bytes)} is not a byte count`,
      );
    }
    const row = yield* findAttemptRow(projectId, attemptKey);
    const existing = yield* one(
      sql`SELECT * FROM attempt_attachments
        WHERE attempt_id = ${row.id} AND kind = ${kind} AND name = ${name} AND path = ${path}
          AND theme IS ${theme}`,
    );
    if (existing !== undefined) {
      return withAttemptKey(decodeAttachment(existing), row.key);
    }
    const id = ulid();
    const at = yield* now;
    const stored = {
      id,
      machine_id: machine,
      attempt_id: row.id,
      kind,
      theme,
      name,
      path,
      bytes: input.bytes,
      sha256: input.sha256,
      created_at: at,
    };
    yield* sql`INSERT INTO attempt_attachments ${sql.insert(stored)}`;
    yield* event(row.task_id, "attachment", input.actor ?? ACTOR_ROLE.WORKER, {
      attemptId: row.id,
      note: `${row.key}: ${kind}${theme === null ? "" : ` ${theme}`} ${name}`,
    });
    const attachment: AttemptAttachment = {
      id,
      attempt_id: row.id,
      attempt_key: row.key,
      kind,
      theme,
      name,
      path,
      bytes: input.bytes,
      sha256: input.sha256,
      created_at: at,
    };
    return attachment;
  }, sql.withTransaction);

  const listAttachments = Effect.fn("TaskStore.listAttachments")(function* (
    projectId: string,
    attemptKey: string,
  ) {
    const row = yield* findAttemptRow(projectId, attemptKey);
    const rows = yield* sql`SELECT id, attempt_id, kind, theme, name, path, bytes, sha256,
        created_at FROM attempt_attachments WHERE attempt_id = ${row.id}
      ORDER BY created_at, id`;
    return rows.map((stored) => withAttemptKey(decodeAttachment(stored), row.key));
  });

  /** One recorded artifact by its id, `null` when no attachment of this store has it. */
  const findAttachment = Effect.fn("TaskStore.findAttachment")(function* (id: string) {
    const row = yield* one(sql`SELECT a.id, a.attempt_id, a.kind, a.theme, a.name, a.path, a.bytes,
        a.sha256, a.created_at, t.key AS attempt_key
      FROM attempt_attachments a JOIN attempts t ON t.id = a.attempt_id
      WHERE a.id = ${id}`);
    if (row === undefined) return null;
    return withAttemptKey(decodeAttachment(row), decodeAttachmentAttemptKey(row).attempt_key);
  });

  return { addAttachment, listAttachments, findAttachment };
};

export type AttachmentStoreFamily = ReturnType<typeof attachmentStore>;
