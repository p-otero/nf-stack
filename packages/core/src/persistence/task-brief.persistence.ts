import * as Effect from "effect/Effect";
import { ACCEPTANCE_RESULT, ACTOR_ROLE } from "@nf/contracts";
import type { AcceptanceItem, ActorRole } from "@nf/contracts";
import { isClosedStatus } from "../domain/transitions.ts";
import { text } from "../domain/validate.ts";
import { decodeAcceptance, fail, type StoreContext } from "./store-rows.ts";
import type { TaskStoreFamily } from "./tasks.persistence.ts";

export interface BriefEdit {
  title?: string | undefined;
  goal?: string | undefined;
  /** The whole acceptance list, replacing the current one. */
  acceptance?: readonly string[] | undefined;
  addAcceptance?: readonly string[] | undefined;
  /** 1-based positions in the current list, or in `acceptance` when it replaces it. */
  removeAcceptance?: readonly number[] | undefined;
}

export interface BriefEditOptions {
  actor?: ActorRole | undefined;
  /** The caller reopens the task in the same operation, so its closed brief may change. */
  allowClosed?: boolean | undefined;
}

const carryAcceptance = (
  before: readonly AcceptanceItem[],
  texts: readonly string[],
): AcceptanceItem[] => {
  const kept = new Map<string, AcceptanceItem[]>();
  for (const item of before) {
    const unchanged = kept.get(item.text);
    if (unchanged === undefined) kept.set(item.text, [item]);
    else unchanged.push(item);
  }
  return texts.map((item, i) => {
    const unchanged = kept.get(item)?.shift();
    return {
      position: i + 1,
      text: item,
      result: unchanged?.result ?? ACCEPTANCE_RESULT.UNVERIFIED,
      evidence: unchanged?.evidence ?? null,
    };
  });
};

/** Position, text, result and evidence of every item, for comparing before and after. */
const acceptanceShape = (items: readonly AcceptanceItem[]): string =>
  JSON.stringify(items.map((item) => [item.text, item.result, item.evidence]));

const fieldNote = (field: string, before: string, after: string): string =>
  `${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;

export const taskBriefStore = (
  ctx: StoreContext,
  tasks: Pick<TaskStoreFamily, "findTaskRow" | "getTask" | "event" | "touch">,
) => {
  const { sql, now } = ctx;
  const { findTaskRow, getTask, event, touch } = tasks;

  const editBrief = Effect.fn("TaskStore.editBrief")(function* (
    projectId: string,
    ref: string,
    edit: BriefEdit,
    opts: BriefEditOptions = {},
  ) {
    const row = yield* findTaskRow(projectId, ref);
    if (isClosedStatus(row.status) && opts.allowClosed !== true) {
      return yield* fail(
        "illegal_transition",
        `${row.key} is ${row.status}; pass --reopen to edit its title, goal or acceptance`,
      );
    }
    const actor = opts.actor ?? ACTOR_ROLE.COORDINATOR;
    const sets: Record<string, string> = {};
    const notes: { kind: string; note: string }[] = [];
    if (edit.title !== undefined) {
      const title = yield* text("title", edit.title);
      if (title !== row.title) {
        sets["title"] = title;
        notes.push({ kind: "update", note: fieldNote("title", row.title, title) });
      }
    }
    if (edit.goal !== undefined) {
      const goal = yield* text("goal", edit.goal);
      if (goal !== row.goal) {
        sets["goal"] = goal;
        notes.push({ kind: "update", note: fieldNote("goal", row.goal, goal) });
      }
    }
    let acceptanceEdit: { before: AcceptanceItem[]; after: AcceptanceItem[] } | null = null;
    const editedAcceptance =
      edit.acceptance !== undefined ||
      edit.addAcceptance !== undefined ||
      edit.removeAcceptance !== undefined;
    if (editedAcceptance) {
      const before = (yield* sql`SELECT position, text, result, evidence FROM task_acceptance
          WHERE task_id = ${row.id} ORDER BY position`).map((item) => decodeAcceptance(item));
      let base = before.map((item) => item.text);
      if (edit.acceptance !== undefined) {
        base = yield* Effect.forEach(edit.acceptance, (item) => text("acceptance item", item));
      }
      const removed = new Set<number>();
      for (const position of edit.removeAcceptance ?? []) {
        if (!Number.isInteger(position) || position < 1 || position > base.length) {
          return yield* fail("not_found", `${row.key} has no acceptance item #${position}`);
        }
        removed.add(position);
      }
      const added = yield* Effect.forEach(edit.addAcceptance ?? [], (item) =>
        text("acceptance item", item),
      );
      const texts = [...base.filter((_text, i) => !removed.has(i + 1)), ...added];
      if (texts.length === 0) {
        return yield* fail("invalid_value", "acceptance must keep at least one item");
      }
      const after = carryAcceptance(before, texts);
      if (acceptanceShape(after) !== acceptanceShape(before)) acceptanceEdit = { before, after };
    }
    if (Object.keys(sets).length === 0 && acceptanceEdit === null)
      return yield* getTask(projectId, ref);
    const at = yield* now;
    if (Object.keys(sets).length > 0) {
      yield* sql`UPDATE tasks SET ${sql.update({ ...sets, updated_at: at })} WHERE id = ${row.id}`;
    } else {
      yield* touch(row.id);
    }
    if (acceptanceEdit !== null) {
      yield* sql`DELETE FROM task_acceptance WHERE task_id = ${row.id}`;
      for (const item of acceptanceEdit.after) {
        yield* sql`INSERT INTO task_acceptance ${sql.insert({
          task_id: row.id,
          position: item.position,
          text: item.text,
          result: item.result,
          evidence: item.evidence,
        })}`;
      }
      notes.push({
        kind: "acceptance",
        note: `acceptance: ${JSON.stringify(acceptanceEdit.before.map((item) => item.text))} -> ${JSON.stringify(acceptanceEdit.after.map((item) => item.text))}`,
      });
    }
    for (const entry of notes) yield* event(row.id, entry.kind, actor, { note: entry.note });
    return yield* getTask(projectId, ref);
  }, sql.withTransaction);

  return { editBrief };
};

export type TaskBriefStoreFamily = ReturnType<typeof taskBriefStore>;
