import * as Effect from "effect/Effect";
import { REPORT_KINDS } from "@nf/contracts";
import type { Report, ReportKind } from "@nf/contracts";
import { ulid } from "../domain/ids.ts";
import { oneOf } from "../domain/validate.ts";
import { decodeReport, fail, type StoreContext } from "./store-rows.ts";
import type { AttemptStoreFamily } from "./attempts.persistence.ts";

const MAX_REPORT_BYTES = 512 * 1024;

export const reportStore = (
  ctx: StoreContext,
  attempts: Pick<AttemptStoreFamily, "findAttemptRow">,
) => {
  const { sql, machine, now } = ctx;
  const { findAttemptRow } = attempts;

  const addReport = Effect.fn("TaskStore.addReport")(function* (
    projectId: string,
    attemptKey: string,
    kind: string,
    body: string,
  ) {
    const reportKind: ReportKind = yield* oneOf("report kind", kind, REPORT_KINDS);
    const text = body.replace(/\r\n/g, "\n").trim();
    if (text.length === 0) return yield* fail("invalid_value", "report body is empty");
    if (Buffer.byteLength(text, "utf8") > MAX_REPORT_BYTES) {
      return yield* fail("invalid_value", `report body exceeds ${MAX_REPORT_BYTES} bytes`);
    }
    const row = yield* findAttemptRow(projectId, attemptKey);
    const id = ulid();
    const at = yield* now;
    yield* sql`INSERT INTO attempt_reports ${sql.insert({
      id,
      machine_id: machine,
      attempt_id: row.id,
      kind: reportKind,
      body: text,
      created_at: at,
    })}`;
    const report: Report = {
      id,
      attempt_id: row.id,
      attempt_key: row.key,
      kind: reportKind,
      body: text,
      created_at: at,
    };
    return report;
  }, sql.withTransaction);

  const listReports = Effect.fn("TaskStore.listReports")(function* (
    projectId: string,
    attemptKey: string,
  ) {
    const row = yield* findAttemptRow(projectId, attemptKey);
    const rows = yield* sql`SELECT id, attempt_id, kind, body, created_at FROM attempt_reports
      WHERE attempt_id = ${row.id} ORDER BY id`;
    return rows.map((stored): Report => {
      const report = decodeReport(stored);
      return {
        id: report.id,
        attempt_id: report.attempt_id,
        attempt_key: row.key,
        kind: report.kind,
        body: report.body,
        created_at: report.created_at,
      };
    });
  });

  return { addReport, listReports };
};

export type ReportStoreFamily = ReturnType<typeof reportStore>;
