import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  ACCEPTANCE_RESULTS,
  ACTOR_ROLE,
  ANALYSIS_MODES,
  ATTEMPT_KIND,
  ATTEMPT_KINDS,
  ATTEMPT_STATUS,
  ATTEMPT_STATUSES,
  CONTEXT_MODE,
  CONTEXT_MODES,
  MECHANISM,
  MECHANISMS,
  NfError,
  TASK_STATUS,
  TASK_STATUSES,
} from "@nf/contracts";
import type { ImportResult } from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { formatAttemptKey, normalizeTaskKey, splitAttemptKey, taskSeq } from "../domain/keys.ts";
import { obj } from "../domain/usage.ts";
import type { Obj } from "../domain/usage.ts";
import { oneOf } from "../domain/validate.ts";
import { TaskStore } from "./task-store.persistence.ts";

const bad = (message: string) => Effect.fail(new NfError({ code: "bad_import", message }));

function s(v: unknown): string | null {
  if (typeof v === "string") return v.trim().length > 0 ? v : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Free-text field that older files sometimes hold as a list or object. */
function flat(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim().length > 0 ? v : null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return JSON.stringify(v);
}

function json(v: unknown): string | null {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

/**
 * Import a parsed `.nf/tasks.json` (schema v1 or v2) into the store. Idempotent by
 * project + task key + attempt key: existing records are left untouched. All or nothing.
 */
const firstRow = <A>(rows: ReadonlyArray<A>): A | undefined => rows[0];

export const importTasksJson = Effect.fn("TaskImport.importTasksJson")(function* (
  projectId: string,
  input: unknown,
) {
  const store = yield* TaskStore;
  const sql = yield* SqlClient.SqlClient;
  const doc = obj(input);
  if (!doc) return yield* bad("tasks.json must be a JSON object");
  const version = Number(doc["schema_version"]);
  if (version !== 1 && version !== 2) {
    return yield* bad(
      `unsupported schema_version '${String(doc["schema_version"])}' (expected 1 or 2)`,
    );
  }
  const tasks = doc["tasks"];
  if (!Array.isArray(tasks)) return yield* bad("tasks.json has no 'tasks' array");
  const project = yield* store.getProject(projectId);
  const prefix = project.prefix;

  const warnings: string[] = [];
  const result = {
    schema_version: version,
    tasks_created: 0,
    tasks_skipped: 0,
    attempts_created: 0,
    attempts_skipped: 0,
    warnings,
  };

  return yield* store.transaction(
    Effect.gen(function* () {
      const coord = obj(doc["coordinator"]);
      if (coord) {
        // Registering again only fills the coordinator fields the store does not know yet.
        const cur = yield* store.getProject(projectId);
        yield* store.registerProject({
          rootPath: cur.root_path,
          coordinatorEnvironmentId: cur.coordinator_environment_id
            ? null
            : s(coord["environment_id"]),
          coordinatorThreadId: cur.coordinator_thread_id ? null : s(coord["thread_id"]),
          coordinatorThreadLink: cur.coordinator_thread_link ? null : s(coord["thread_link"]),
        });
      }

      const pending: {
        taskId: string;
        key: string;
        deps: string[];
        supersededBy: string | null;
      }[] = [];

      for (const [index, rawTask] of (tasks as unknown[]).entries()) {
        const where = `tasks[${index}]`;
        const raw = obj(rawTask);
        if (!raw) return yield* bad(`${where} is not an object`);
        const rawId = s(raw["id"]);
        if (!rawId) return yield* bad(`${where} has no id`);
        const key = yield* normalizeTaskKey(prefix, rawId);
        const seq = taskSeq(key);
        if (seq === null) return yield* bad(`${where} has an invalid key '${key}'`);
        const attempts: unknown[] = Array.isArray(raw["attempts"]) ? raw["attempts"] : [];

        let row = firstRow(
          yield* sql<{ id: string; status: string }>`SELECT id, status FROM tasks
            WHERE project_id = ${projectId} AND key = ${key}`,
        );
        if (row) {
          result.tasks_skipped++;
        } else {
          const status = yield* oneOf(
            `${key} status`,
            s(raw["status"]) ?? TASK_STATUS.TODO,
            TASK_STATUSES,
          );
          const title = s(raw["title"]);
          if (!title) return yield* bad(`${key} has no title`);
          const goal = s(raw["goal"]) ?? title;
          const mode = s(raw["analysis_mode"]);
          const afp = raw["accepted_first_pass"];
          const id = ulid();
          const now = new Date().toISOString();
          yield* sql`INSERT INTO tasks ${sql.insert({
            id,
            machine_id: store.machine,
            project_id: projectId,
            seq,
            key,
            title,
            goal,
            status,
            profile: s(raw["profile"]),
            analysis_mode: mode ? yield* oneOf(`${key} analysis_mode`, mode, ANALYSIS_MODES) : null,
            authorization: flat(raw["authorization"]),
            decision_needed: flat(raw["decision_needed"]),
            blocker: json(raw["blocker"]),
            evidence: flat(raw["evidence"]),
            accepted_first_pass: typeof afp === "boolean" ? (afp ? 1 : 0) : null,
            human_interventions: Number.isInteger(raw["human_interventions"])
              ? Math.max(0, Number(raw["human_interventions"]))
              : 0,
            source: s(raw["source"]),
            design_ref: s(raw["design_ref"]),
            created_at: s(raw["created_at"]) ?? now,
            updated_at: s(raw["updated_at"]) ?? s(raw["created_at"]) ?? now,
          })}`;
          const acceptance: unknown[] = Array.isArray(raw["acceptance"]) ? raw["acceptance"] : [];
          for (const [i, a] of acceptance.entries()) {
            const item: Obj = obj(a) ?? { text: a };
            const itemText = flat(item["text"] ?? item["check"] ?? item["description"]);
            if (!itemText) return yield* bad(`${key} acceptance #${i + 1} is empty`);
            let itemResult = s(item["result"]);
            let evidence = flat(item["evidence"]);
            if (!itemResult) {
              // a done task was accepted under the old contract; keep the done invariant
              itemResult = status === TASK_STATUS.DONE ? "pass" : "unverified";
              if (status === TASK_STATUS.DONE)
                evidence = evidence ?? "imported: task was done in the source file";
            }
            yield* sql`INSERT INTO task_acceptance ${sql.insert({
              task_id: id,
              position: i + 1,
              text: itemText,
              result: yield* oneOf(`${key} acceptance result`, itemResult, ACCEPTANCE_RESULTS),
              evidence,
            })}`;
          }
          yield* store.event(id, "imported", ACTOR_ROLE.SYSTEM, {
            to: status,
            note: "from tasks.json",
          });
          const deps = Array.isArray(raw["depends_on"])
            ? yield* Effect.forEach(raw["depends_on"] as unknown[], (d) =>
                normalizeTaskKey(prefix, String(d)),
              )
            : [];
          const sup = s(raw["superseded_by"]);
          pending.push({
            taskId: id,
            key,
            deps,
            supersededBy: sup ? yield* normalizeTaskKey(prefix, sup) : null,
          });
          result.tasks_created++;
          row = { id, status };
        }

        const taskId = row.id;
        const repairs: { attemptId: string; akey: string; repair: string }[] = [];
        for (const [ai, rawAttemptValue] of attempts.entries()) {
          const aw = `${key} attempts[${ai}]`;
          const rawAttempt = obj(rawAttemptValue);
          if (!rawAttempt) return yield* bad(`${aw} is not an object`);
          const aid = s(rawAttempt["id"]);
          let aseq: number;
          if (aid) {
            const parsed = yield* splitAttemptKey(aid);
            const attemptTaskKey = yield* normalizeTaskKey(prefix, parsed.taskRef);
            if (attemptTaskKey !== key)
              return yield* bad(`${aw}: id ${aid} does not belong to ${key}`);
            aseq = parsed.seq;
          } else {
            aseq = ai + 1;
          }
          const akey = formatAttemptKey(key, aseq);
          const existing =
            yield* sql`SELECT 1 AS ok FROM attempts WHERE task_id = ${taskId} AND seq = ${aseq}`;
          if (existing.length > 0) {
            result.attempts_skipped++;
            continue;
          }
          const routing = obj(rawAttempt["routing"]) ?? {};
          const failure = rawAttempt["failure"];
          const failureObj = obj(failure);
          let mechanism =
            s(rawAttempt["mechanism"]) ??
            s(routing["mechanism"]) ??
            s(routing["mode"]) ??
            s(routing["delegated_mode"]);
          if (!mechanism || !(MECHANISMS as readonly string[]).includes(mechanism)) {
            if (mechanism)
              warnings.push(`${akey}: unknown mechanism '${mechanism}', recorded as delegate_task`);
            else warnings.push(`${akey}: no mechanism in source, recorded as delegate_task`);
            mechanism = MECHANISM.DELEGATE_TASK;
          }
          const kind = yield* oneOf(
            `${akey} kind`,
            s(rawAttempt["kind"]) ?? ATTEMPT_KIND.IMPLEMENTATION,
            ATTEMPT_KINDS,
          );
          const status = yield* oneOf(
            `${akey} status`,
            s(rawAttempt["status"]) ?? ATTEMPT_STATUS.UNKNOWN,
            ATTEMPT_STATUSES,
          );
          const started = s(rawAttempt["started_at"]) ?? new Date().toISOString();
          const fallbacks: unknown = Array.isArray(rawAttempt["fallbacks"])
            ? rawAttempt["fallbacks"]
            : Array.isArray(routing["considered"])
              ? routing["considered"]
              : [];
          const commits = Array.isArray(rawAttempt["commits"])
            ? (rawAttempt["commits"] as unknown[]).map(String)
            : [];
          const attemptId = ulid();
          yield* sql`INSERT INTO attempts ${sql.insert({
            id: attemptId,
            machine_id: store.machine,
            task_id: taskId,
            seq: aseq,
            key: akey,
            kind,
            status,
            mechanism,
            environment_id: s(rawAttempt["environment_id"]),
            thread_id: s(rawAttempt["thread_id"]),
            thread_link: s(rawAttempt["thread_link"]),
            t3_task_id: s(rawAttempt["t3_task_id"]) ?? s(rawAttempt["task_id"]),
            client_request_id: s(rawAttempt["client_request_id"]),
            provider_instance_id: s(rawAttempt["provider_instance_id"]),
            model: s(rawAttempt["model"]),
            options: json(rawAttempt["options"]),
            executed_model: s(rawAttempt["executed_model"]),
            profile: s(rawAttempt["profile"]) ?? s(routing["profile"]),
            reason:
              flat(rawAttempt["reason"]) ??
              flat(routing["reason"]) ??
              flat(routing["selection_reason"]),
            fallbacks: JSON.stringify(fallbacks),
            context_mode: yield* oneOf(
              `${akey} context_mode`,
              s(rawAttempt["context_mode"]) ?? CONTEXT_MODE.FRESH,
              CONTEXT_MODES,
            ),
            source_thread_id: s(rawAttempt["source_thread_id"]),
            started_at: started,
            ended_at: s(rawAttempt["ended_at"]),
            base_commit: s(rawAttempt["base_commit"]),
            worktree: s(rawAttempt["worktree"]),
            branch: s(rawAttempt["branch"]),
            pr_url: s(rawAttempt["pr_url"]) ?? s(rawAttempt["pr"]),
            diff_location: s(rawAttempt["diff_location"]) ?? s(rawAttempt["diff"]),
            outcome: flat(rawAttempt["outcome"]),
            failure_class: failureObj ? s(failureObj["class"]) : null,
            failure_detail: failureObj
              ? flat(failureObj["evidence"] ?? failureObj["detail"])
              : flat(failure),
            retry_at: s(rawAttempt["retry_at"]),
            last_verified: flat(rawAttempt["last_verified"]),
            remaining: flat(rawAttempt["remaining"]),
            updated_at: started,
          })}`;
          for (const [i, sha] of commits.entries()) {
            yield* sql`INSERT INTO attempt_commits ${sql.insert({ attempt_id: attemptId, position: i + 1, sha })}`;
          }
          const repair = s(rawAttempt["repair_of"]);
          if (repair) repairs.push({ attemptId, akey, repair });
          result.attempts_created++;
        }
        for (const r of repairs) {
          const { seq: repairSeq } = yield* splitAttemptKey(r.repair);
          const target = firstRow(
            yield* sql<{
              id: string;
            }>`SELECT id FROM attempts WHERE task_id = ${taskId} AND seq = ${repairSeq}`,
          );
          if (target)
            yield* sql`UPDATE attempts SET repair_of = ${target.id} WHERE id = ${r.attemptId}`;
          else warnings.push(`${r.akey}: repair_of ${r.repair} not found, dropped`);
        }
      }

      // dependencies and supersession need every task to exist first
      for (const p of pending) {
        for (const dep of p.deps) {
          const target = firstRow(
            yield* sql<{
              id: string;
            }>`SELECT id FROM tasks WHERE project_id = ${projectId} AND key = ${dep}`,
          );
          if (!target) return yield* bad(`${p.key} depends on unknown task ${dep}`);
          yield* store.insertDependency(p.taskId, target.id, p.key, dep);
        }
        if (p.supersededBy) {
          const target = firstRow(
            yield* sql<{
              id: string;
            }>`SELECT id FROM tasks WHERE project_id = ${projectId} AND key = ${p.supersededBy}`,
          );
          if (target)
            yield* sql`UPDATE tasks SET superseded_by = ${target.id} WHERE id = ${p.taskId}`;
          else warnings.push(`${p.key}: superseded_by ${p.supersededBy} not found, dropped`);
        }
      }
      const imported: ImportResult = result;
      return imported;
    }),
  );
});
