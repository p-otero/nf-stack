import * as Effect from "effect/Effect";
import { TELEMETRY_GROUP_BY } from "@nf/contracts";
import type { TaskStage } from "@nf/contracts";
import type { Project } from "@nf/contracts";
import type { PriceFile } from "../domain/prices.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import { DEFAULT_PROJECT_CONFIG, loadProjectConfig } from "../system/project-config.ts";
import type { ResolvedProjectConfig } from "../system/project-config.ts";
import { telemetryView } from "../usage/telemetry.ts";
import { boardViews } from "./board-view.ts";
import { boardStages } from "./code-location.ts";
import type { GitProbe } from "./code-location.ts";
import type { PullRequestSource } from "./pull-request-source.ts";
import type { BoardPageData, BoardProject } from "../system/board-page.ts";

/** The machine's IANA zone: every relative time on the page is computed the way the machine reads a clock. */
export function machineTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Projects derived at once: every repository's `gh` batch and git questions run in parallel. */
const PROJECT_CONCURRENCY = 3;

export interface BoardDataOptions {
  /** The project to show, or `null` for every project in the store. */
  readonly projectId: string | null;
  /** The views' "now": it dates liveness, telemetry and the banner. */
  readonly at: string;
  /** `$NF_HOME` for the project config. */
  readonly home?: string | undefined;
  /** T3 Code's `statev2.sqlite`, for T3's own liveness of live attempts. */
  readonly t3State?: string | undefined;
  /** URL prefix the page reads attachment bytes from; without it images are inlined. */
  readonly artifactBase?: string | undefined;
  /** The price chain a caller already loaded; cache savings stay unknown without it. */
  readonly prices?: PriceFile | undefined;
  /** PR state from an earlier derivation, for a caller that polls. */
  readonly readPullRequest?: PullRequestSource | undefined;
  /** Git answers per repository root, for a caller that polls. */
  readonly gitProbe?: ((root: string) => GitProbe | undefined) | undefined;
}

const projectConfig = (options: BoardDataOptions) => (project: Project) =>
  options.home === undefined
    ? Effect.succeed(DEFAULT_PROJECT_CONFIG)
    : loadProjectConfig(options.home, project.prefix);

/** The stages of the projects on the page, in order, one per id: a stage shared by two appears once. */
function stageUnion(configs: readonly ResolvedProjectConfig[]): TaskStage[] {
  const seen = new Set<string>();
  const stages: TaskStage[] = [];
  for (const stage of configs.flatMap(boardStages)) {
    if (seen.has(stage.id)) continue;
    seen.add(stage.id);
    stages.push(stage);
  }
  return stages;
}

const projectChoice = (project: Project): BoardProject => ({
  prefix: project.prefix,
  name: project.name,
});

/**
 * Everything the board page shows, for one project or every project in the store. `nf board`
 * embeds it in a snapshot and `nf serve` answers it per request, so both render the same page.
 */
export const boardData = Effect.fn("Board.boardData")(function* (options: BoardDataOptions) {
  const store = yield* TaskStore;
  const projects = yield* store.listProjects();
  const selected = options.projectId === null ? null : yield* store.getProject(options.projectId);
  const included = selected === null ? projects : [selected];
  const views = yield* Effect.forEach(
    included,
    (project) =>
      boardViews(project.id, options.at, {
        t3State: options.t3State,
        home: options.home,
        artifactBase: options.artifactBase,
        ...(options.readPullRequest === undefined
          ? {}
          : { readPullRequest: options.readPullRequest }),
        ...(options.gitProbe === undefined
          ? {}
          : { gitProbe: options.gitProbe(project.root_path) }),
      }),
    { concurrency: PROJECT_CONCURRENCY },
  );
  const configs = yield* Effect.forEach(included, projectConfig(options));
  const strategy = yield* telemetryView({
    projectId: options.projectId,
    groupBy: TELEMETRY_GROUP_BY.STRATEGY,
    at: options.at,
    prices: options.prices,
  });
  const model = yield* telemetryView({
    projectId: options.projectId,
    groupBy: TELEMETRY_GROUP_BY.MODEL,
    at: options.at,
    prices: options.prices,
  });
  const coordinator = yield* telemetryView({
    projectId: options.projectId,
    groupBy: TELEMETRY_GROUP_BY.COORDINATOR,
    at: options.at,
    prices: options.prices,
  });
  const data: BoardPageData = {
    tasks: views.flat(),
    stages: stageUnion(configs),
    telemetry: { strategy, model, coordinator },
    project: selected?.prefix ?? null,
    projects: projects.map(projectChoice),
    generatedAt: options.at,
    timeZone: machineTimeZone(),
  };
  return data;
});
