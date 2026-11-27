import type { TaskStage, TelemetryView, TaskView } from "@nf/contracts";
import type { Writable } from "@/contract";

/** One project the page can switch to, as `nf serve` lists them. */
export type BoardProject = { prefix: string; name: string };

/** What `nf board` embeds: the validated views, the project's stages, the machine's zone and the snapshot time. */
export type BoardData = {
  tasks: Writable<TaskView>[];
  stages: Writable<TaskStage>[];
  telemetry: {
    strategy: Writable<TelemetryView>;
    model: Writable<TelemetryView>;
    coordinator: Writable<TelemetryView>;
  };
  /** The project the views belong to; `null` when they span every project in the store. */
  project: string | null;
  /** Every project in the store, for the selector. */
  projects: BoardProject[];
  generatedAt: string;
  timeZone: string;
};

/** What `nf serve` embeds instead of a snapshot: where the page reads its data per request. */
export type BoardSource = {
  kind: "live";
  api: string;
  /** Where a review decision is posted, `/api/tasks/<key>/<accept|reject>`. */
  actions: string;
  /** This server's own token; only the page it served writes. */
  token: string;
};

/** A page's data either came with it, or it polls the live API for it. */
export type BoardSession =
  | { kind: "snapshot"; snapshot: BoardData }
  | { kind: "live"; api: string; actions: string; token: string; project: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTask = (value: unknown): boolean => isRecord(value) && typeof value["id"] === "string";

const isStage = (value: unknown): boolean =>
  isRecord(value) && typeof value["id"] === "string" && typeof value["label"] === "string";

const isProject = (value: unknown): boolean =>
  isRecord(value) && typeof value["prefix"] === "string" && typeof value["name"] === "string";

const isTelemetryView = (value: unknown): boolean =>
  isRecord(value) && Array.isArray(value["rows"]) && isRecord(value["totals"]);

/**
 * Only the page envelope is checked: `nf` decoded every view against `@nf/contracts` before
 * writing it, so the browser needs to know the payload is complete, not to re-validate it.
 */
const isBoardData = (value: unknown): value is BoardData =>
  isRecord(value) &&
  Array.isArray(value["tasks"]) &&
  value["tasks"].every(isTask) &&
  Array.isArray(value["stages"]) &&
  value["stages"].every(isStage) &&
  isRecord(value["telemetry"]) &&
  isTelemetryView(value["telemetry"]["strategy"]) &&
  isTelemetryView(value["telemetry"]["model"]) &&
  isTelemetryView(value["telemetry"]["coordinator"]) &&
  (value["project"] === null || typeof value["project"] === "string") &&
  Array.isArray(value["projects"]) &&
  value["projects"].every(isProject) &&
  typeof value["generatedAt"] === "string" &&
  typeof value["timeZone"] === "string";

const parseJson = (text: string | undefined): unknown => {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
};

/** Decode the snapshot `nf` wrote into the page; `null` when it is missing or malformed. */
export const parseBoardData = (text: string | undefined): BoardData | null => {
  const parsed = parseJson(text);
  return isBoardData(parsed) ? parsed : null;
};

/** Decode the live marker `nf serve` wrote into the page; `null` when there is none. */
export const parseBoardSource = (text: string | undefined): BoardSource | null => {
  const parsed = parseJson(text);
  return isRecord(parsed) &&
    parsed["kind"] === "live" &&
    typeof parsed["api"] === "string" &&
    typeof parsed["actions"] === "string" &&
    typeof parsed["token"] === "string"
    ? {
        kind: "live",
        api: parsed["api"],
        actions: parsed["actions"],
        token: parsed["token"],
      }
    : null;
};

/** The project the page was opened for, from its own URL (a query string). */
export const projectOf = (search: string): string | null => {
  const project = new URLSearchParams(search).get("project");
  return project === null || project === "" ? null : project;
};

/** The page's session: the embedded snapshot, or the live API and the project it starts on. */
export const boardSession = (
  snapshot: BoardData | null,
  source: BoardSource | null,
  search: string,
): BoardSession | null => {
  if (source !== null) {
    return {
      kind: "live",
      api: source.api,
      actions: source.actions,
      token: source.token,
      project: projectOf(search),
    };
  }
  return snapshot === null ? null : { kind: "snapshot", snapshot };
};

const apiHref = (api: string, project: string | null): string =>
  project === null ? api : `${api}?project=${encodeURIComponent(project)}`;

const errorMessage = (body: unknown): string | null =>
  isRecord(body) && typeof body["error"] === "string" ? body["error"] : null;

/**
 * One board payload from `nf serve`. A failed request throws with the server's message so the
 * page can show it as it is; a malformed one names what was expected.
 */
export const readBoard = async (api: string, project: string | null): Promise<BoardData> => {
  const response = await fetch(apiHref(api, project), { headers: { Accept: "application/json" } });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(body) ?? `the board API answered ${response.status}`);
  }
  if (!isBoardData(body)) throw new Error("the board API answered with an unexpected shape");
  return body;
};

/** The page's own address for a project, so the selector's choice survives a reload or a share. */
export const boardHref = (href: string, project: string | null): string => {
  const url = new URL(href);
  if (project === null) url.searchParams.delete("project");
  else url.searchParams.set("project", project);
  return `${url.pathname}${url.search}`;
};

/** A review task's decision, with the comment a rejection requires. */
export type ReviewDecision = "accept" | "reject";

/** What `nf serve` gives the page to post a decision: its task API and this server's token. */
export interface ReviewChannel {
  readonly actions: string;
  readonly token: string;
}

/**
 * Posts one review decision. The server refuses anything but its own page and answers a gate
 * rejection with its message, which becomes this request's error.
 */
export const reviewTask = async (
  channel: ReviewChannel,
  taskId: string,
  decision: ReviewDecision,
  comment: string | null,
): Promise<void> => {
  const response = await fetch(`${channel.actions}/${encodeURIComponent(taskId)}/${decision}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-NF-Board-Token": channel.token,
    },
    body: JSON.stringify(comment === null ? {} : { comment }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(body) ?? `the review action answered ${response.status}`);
  }
};
