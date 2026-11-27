import type { TaskStage, TaskView, TelemetryView } from "@nf/contracts";

/** The placeholder `bun run board:build` leaves in the prebuilt page for `nf` to replace. */
export const BOARD_DATA_MARKER = "<!-- nf-board-data -->";

/** One project the page can switch to. */
export interface BoardProject {
  readonly prefix: string;
  readonly name: string;
}

export interface BoardPageData {
  readonly tasks: readonly TaskView[];
  /** The project's stages, in order, for the location pill and the stage filter. */
  readonly stages: readonly TaskStage[];
  /** The telemetry groupings the tab and its charts switch between; NF computes each one. */
  readonly telemetry: {
    readonly strategy: TelemetryView;
    readonly model: TelemetryView;
    readonly coordinator: TelemetryView;
  };
  /** The project these views belong to; `null` when they span every project in the store. */
  readonly project: string | null;
  /** Every project in the store, for the page's project selector. */
  readonly projects: readonly BoardProject[];
  /** The snapshot's "now", shown in the board's banner. */
  readonly generatedAt: string;
  /** IANA zone of the machine that took the snapshot. */
  readonly timeZone: string;
}

/**
 * What `nf serve` embeds instead of a snapshot: where the page reads its data, per request.
 * `project` comes from the page's own `?project` query, never from this marker.
 */
export interface BoardSource {
  readonly kind: "live";
  readonly api: string;
  /** Where the page posts a review decision, under `/api/tasks/<key>`; per `nf serve`. */
  readonly actions: string;
  /** This server's own random token: one served page writes, and every other origin cannot. */
  readonly token: string;
}

const DATA_ID = "board-data";

const SOURCE_ID = "board-source";

function dataScript(id: string, payload: BoardPageData | BoardSource): string {
  // `<` cannot appear unescaped: a task title must not be able to close the script element.
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `<script type="application/json" id="${id}">${json}</script>`;
}

/** The self-contained snapshot page: the prebuilt template with its data embedded. */
export function renderBoardSnapshot(template: string, payload: BoardPageData): string {
  return template.replace(BOARD_DATA_MARKER, () => dataScript(DATA_ID, payload));
}

/** The live page: the same bundle, pointed at the API `nf serve` answers on. */
export function renderBoardSource(template: string, source: BoardSource): string {
  return template.replace(BOARD_DATA_MARKER, () => dataScript(SOURCE_ID, source));
}
