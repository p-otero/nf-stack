import * as Effect from "effect/Effect";
import {
  ACCEPTANCE_RESULTS,
  ACTOR_ROLE,
  ATTACHMENT_KIND,
  ATTACHMENT_THEME,
  ATTEMPT_STATUS,
  TASK_STATUS,
  TASK_STATUSES,
  UI_CHANGE_SIZE,
} from "@nf/contracts";
import type { ActorRole, AttachmentTheme } from "@nf/contracts";
import { isClosedStatus, isLegalTransition, legalTargets } from "../domain/transitions.ts";
import { UI_CHANGE_EVENT } from "../domain/ui-change.ts";
import type { UiChange } from "../domain/ui-change.ts";
import { oneOf, optText, text } from "../domain/validate.ts";
import {
  decodeAcceptanceFailure,
  decodeAttachmentTheme,
  decodeAttemptIdentity,
  decodeAttemptRef,
  decodeAttemptStatus,
  fail,
  one,
  type StoreContext,
  type TaskRow,
} from "./store-rows.ts";
import type { TaskStoreFamily } from "./tasks.persistence.ts";
import type { TransitionOptions } from "./tasks.persistence.ts";

export const taskTransitionStore = (
  ctx: StoreContext,
  tasks: Pick<TaskStoreFamily, "findTaskRow" | "getTask" | "event" | "touch">,
) => {
  const { sql, machine: _machine, now } = ctx;
  const { findTaskRow, getTask, event, touch } = tasks;
  const deriveFirstPass = Effect.fnUntraced(function* (taskId: string) {
    const impl = (yield* sql`SELECT status FROM attempts
        WHERE task_id = ${taskId} AND kind = 'implementation' ORDER BY seq`).map((row) =>
      decodeAttemptStatus(row),
    );
    if (impl.length === 0) return null;
    const repaired = yield* one(sql`SELECT 1 AS ok FROM attempts
      WHERE task_id = ${taskId} AND repair_of IS NOT NULL LIMIT 1`);
    return impl[0]?.status === ATTEMPT_STATUS.SUCCEEDED && !repaired ? 1 : 0;
  });

  /** UI evidence sits on the attempt whose result is accepted: the newest one that wrote code, since a review does not capture screens. */
  const requireUiEvidence = Effect.fnUntraced(function* (
    row: TaskRow,
    gate: {
      readonly approvedByUser: boolean;
      /** A large or unmeasured change needs the user; a small one does not. */
      readonly approvalRequired: boolean;
      readonly themes: readonly AttachmentTheme[];
      /** The classification the refusal reports back, e.g. `large (new screen src/Dialog.tsx)`. */
      readonly uiChange: string | null;
    },
  ) {
    const writing = yield* one(sql`SELECT id, key FROM attempts
      WHERE task_id = ${row.id} AND kind IN ('implementation','integration')
      ORDER BY seq DESC LIMIT 1`);
    const latest =
      writing ??
      (yield* one(sql`SELECT id, key FROM attempts
        WHERE task_id = ${row.id} ORDER BY seq DESC LIMIT 1`));
    const attempt = latest === undefined ? undefined : decodeAttemptIdentity(latest);
    const themes = new Set<AttachmentTheme>();
    if (attempt !== undefined) {
      const screenshots = yield* sql`SELECT DISTINCT theme FROM attempt_attachments
        WHERE attempt_id = ${attempt.id} AND kind = ${ATTACHMENT_KIND.SCREENSHOT}
          AND theme IS NOT NULL`;
      for (const screenshot of screenshots) themes.add(decodeAttachmentTheme(screenshot).theme);
    }
    const missing: string[] = [];
    if (attempt === undefined) {
      missing.push(`an attempt with a screenshot per project theme (${gate.themes.join(", ")})`);
    } else {
      for (const theme of gate.themes) {
        if (!themes.has(theme)) {
          missing.push(
            `a ${theme} screenshot on ${attempt.key} (nf attempt attach ${attempt.key} --file <png> --kind screenshot --theme ${theme} --name <screen>)`,
          );
        }
      }
    }
    if (gate.approvalRequired && !gate.approvedByUser) {
      missing.push(
        gate.uiChange === null
          ? "--approved-by-user"
          : `--approved-by-user (UI change: ${gate.uiChange})`,
      );
    }
    if (missing.length > 0) {
      return yield* fail(
        "ui_not_approved",
        `${row.key} is a UI task; acceptance is missing ${missing.join("; ")}`,
      );
    }
    return yield* Effect.void;
  });

  const setStatus = Effect.fn("TaskStore.setStatus")(function* (
    projectId: string,
    ref: string,
    to: string,
    opts: TransitionOptions = {},
  ) {
    const row = yield* findTaskRow(projectId, ref);
    const id = row.id;
    const key = row.key;
    const from = row.status;
    const target = yield* oneOf("status", to, TASK_STATUSES);
    const reopen = opts.reopen === true;
    if (!isLegalTransition(from, target, reopen)) {
      const hint = isClosedStatus(from)
        ? "; reopen only on explicit request (--reopen, to todo)"
        : `; allowed: ${legalTargets(from).join(", ") || "none"}`;
      return yield* fail(
        "illegal_transition",
        `${key}: ${from} -> ${target} is not allowed${hint}`,
      );
    }
    if (isClosedStatus(target)) {
      const live = yield* one(sql`SELECT key, status FROM attempts
          WHERE task_id = ${id} AND status IN ('dispatching','active','unknown') ORDER BY seq LIMIT 1`);
      if (live) {
        const attempt = decodeAttemptRef(live);
        return yield* fail(
          "live_attempt",
          `${key}: attempt ${attempt.key} is still ${attempt.status}; finish or reconcile it first`,
        );
      }
    }
    let firstPass: number | null | undefined;
    if (target === TASK_STATUS.DONE) {
      const bad = yield* sql`SELECT position, result FROM task_acceptance
          WHERE task_id = ${id} AND result <> 'pass' ORDER BY position`;
      if (bad.length > 0) {
        const list = bad
          .map((failure) => {
            const item = decodeAcceptanceFailure(failure);
            return `#${String(item.position)} ${item.result}`;
          })
          .join(", ");
        return yield* fail(
          "acceptance_incomplete",
          `${key}: cannot be done; acceptance not passing: ${list}`,
        );
      }
      firstPass = yield* deriveFirstPass(id);
    }
    const at = yield* now;
    if (firstPass !== undefined) {
      yield* sql`UPDATE tasks SET status = ${target}, accepted_first_pass = ${firstPass},
          updated_at = ${at} WHERE id = ${id}`;
    } else {
      yield* sql`UPDATE tasks SET status = ${target}, updated_at = ${at} WHERE id = ${id}`;
    }
    if (opts.uiChange !== undefined) {
      yield* event(id, UI_CHANGE_EVENT, opts.actor ?? ACTOR_ROLE.COORDINATOR, {
        from,
        to: target,
        note: opts.uiChange,
      });
    }
    yield* event(
      id,
      opts.kind ?? (reopen ? "reopen" : "status"),
      opts.actor ?? ACTOR_ROLE.COORDINATOR,
      {
        from,
        to: target,
        note: opts.reason ?? null,
      },
    );
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  const approveTask = Effect.fn("TaskStore.approveTask")(function* (
    projectId: string,
    ref: string,
    opts: { reason?: string | null | undefined; actor?: ActorRole | undefined } = {},
  ) {
    return yield* setStatus(projectId, ref, TASK_STATUS.TODO, {
      reason: opts.reason ?? null,
      actor: opts.actor ?? ACTOR_ROLE.USER,
      kind: "approval",
    });
  });

  const acceptTask = Effect.fn("TaskStore.acceptTask")(function* (
    projectId: string,
    ref: string,
    opts: {
      reason?: string | null | undefined;
      actor?: ActorRole | undefined;
      approvedByUser?: boolean | undefined;
      /** Themes the evidence must cover; the project config's `ui.themes`. */
      themes?: readonly AttachmentTheme[] | undefined;
      /** The project's `ui.review` verdict; null or absent keeps the change on the user. */
      uiChange?: UiChange | null | undefined;
    } = {},
  ) {
    const row = yield* findTaskRow(projectId, ref);
    const uiChange = opts.uiChange ?? null;
    if (row.ui === 1) {
      yield* requireUiEvidence(row, {
        approvedByUser: opts.approvedByUser === true,
        approvalRequired: uiChange === null || uiChange.size === UI_CHANGE_SIZE.LARGE,
        themes: opts.themes ?? [ATTACHMENT_THEME.LIGHT, ATTACHMENT_THEME.DARK],
        uiChange: uiChange?.text ?? null,
      });
    }
    return yield* setStatus(projectId, ref, TASK_STATUS.DONE, {
      reason: opts.reason ?? null,
      actor: opts.actor ?? ACTOR_ROLE.COORDINATOR,
      kind: "accept",
      ...(row.ui === 1 && uiChange !== null ? { uiChange: uiChange.text } : {}),
    });
  });

  /** A rejected review goes back to `working` with the comment as the repair note and event. */
  const rejectReview = Effect.fn("TaskStore.rejectReview")(function* (
    projectId: string,
    ref: string,
    comment: string,
    opts: { actor?: ActorRole | undefined } = {},
  ) {
    const note = yield* text("rejection comment", comment);
    const row = yield* findTaskRow(projectId, ref);
    if (!isLegalTransition(row.status, TASK_STATUS.WORKING)) {
      return yield* fail(
        "illegal_transition",
        `${row.key}: ${row.status} -> ${TASK_STATUS.WORKING} is not allowed; allowed: ${legalTargets(row.status).join(", ") || "none"}`,
      );
    }
    const at = yield* now;
    yield* sql`UPDATE tasks SET status = ${TASK_STATUS.WORKING}, decision_needed = ${note},
        updated_at = ${at} WHERE id = ${row.id}`;
    yield* event(row.id, "review_rejected", opts.actor ?? ACTOR_ROLE.USER, {
      from: row.status,
      to: TASK_STATUS.WORKING,
      note,
    });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  const intervene = Effect.fn("TaskStore.intervene")(function* (
    projectId: string,
    ref: string,
    note: string,
    actor: ActorRole = ACTOR_ROLE.USER,
  ) {
    const row = yield* findTaskRow(projectId, ref);
    const at = yield* now;
    yield* sql`UPDATE tasks SET human_interventions = human_interventions + 1, updated_at = ${at}
        WHERE id = ${row.id}`;
    yield* event(row.id, "intervention", actor, { note: yield* text("note", note) });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  const checkItem = Effect.fn("TaskStore.checkItem")(function* (
    projectId: string,
    ref: string,
    item: number,
    result: string,
    evidence?: string | null,
    actor: ActorRole = ACTOR_ROLE.COORDINATOR,
  ) {
    const checked = yield* oneOf("result", result, ACCEPTANCE_RESULTS);
    const row = yield* findTaskRow(projectId, ref);
    if (isClosedStatus(row.status)) {
      return yield* fail(
        "illegal_transition",
        `${row.key} is ${row.status}; reopen it before changing acceptance results`,
      );
    }
    const exists = yield* one(
      sql`SELECT 1 AS ok FROM task_acceptance WHERE task_id = ${row.id} AND position = ${item}`,
    );
    if (!exists) return yield* fail("not_found", `${row.key} has no acceptance item #${item}`);
    yield* sql`UPDATE task_acceptance SET result = ${checked}, evidence = ${optText(evidence)}
        WHERE task_id = ${row.id} AND position = ${item}`;
    yield* touch(row.id);
    yield* event(row.id, "check", actor, {
      note: `#${item} ${checked}${evidence ? `: ${evidence}` : ""}`,
    });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  return { setStatus, approveTask, acceptTask, rejectReview, intervene, checkItem };
};

export type TaskTransitionStoreFamily = ReturnType<typeof taskTransitionStore>;
