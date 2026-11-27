import type { TelemetryView } from "@nf/contracts";

type TelemetryRow = TelemetryView["rows"][number];

/** The coordinator's own row is no strategy and no model: the task charts leave it to the table. */
export const taskRows = (view: TelemetryView): TelemetryRow[] =>
  view.rows
    .filter((row) => row.entity.kind !== "coordination")
    .toSorted((a, b) => (b.costToAcceptance.value ?? 0) - (a.costToAcceptance.value ?? 0));
