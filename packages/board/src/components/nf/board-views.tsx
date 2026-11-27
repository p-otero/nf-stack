import { useState } from "react";

import type { TaskFilters } from "@/lib/agent-task-board-model";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { BoardView } from "@/components/ui/agent-task-board-primitive";
import type { BoardData, BoardProject } from "@/board-data";
import { boardViewHref, parseBoardView, type BoardViewId } from "@/components/nf/git/git-model";
import { GitTab } from "@/components/nf/git/git-tab";
import { useGitLocation } from "@/components/nf/git/hooks/use-git-location";
import { ProjectSelect } from "@/components/nf/project-select";
import type { ReviewLive } from "@/components/nf/review-actions";
import { TaskBoard } from "@/components/nf/task-board";
import { TelemetryTab } from "@/components/nf/telemetry-tab";

/** The page's views: the board with its own board/table/backlog switch, and its telemetry. */
const VIEWS = [
  { id: "tasks", label: "Tasks" },
  { id: "telemetry", label: "Telemetry" },
  { id: "git", label: "Git" },
] as const;

function BoardViews({
  data,
  project,
  projects,
  live,
  api,
  review,
  onProjectChange,
}: {
  data: BoardData;
  project: string | null;
  projects: readonly BoardProject[];
  live: boolean;
  /** The live board API's address; the Git tab reads the git routes beside it. */
  api?: string | undefined;
  /** Where a live board records a review decision; a snapshot has none. */
  review?: ReviewLive | undefined;
  /** Only a live board switches projects: it refetches, while a snapshot holds one project. */
  onProjectChange?: ((project: string | null) => void) | undefined;
}) {
  const git = live && api !== undefined ? api : null;
  const views = git === null ? VIEWS.filter((item) => item.id !== "git") : VIEWS;
  const [view, setView] = useState<BoardViewId>(() => {
    const parsed = parseBoardView(window.location.search);
    return parsed === "git" && git === null ? "tasks" : parsed;
  });
  const [gitLocation, changeGitLocation] = useGitLocation(project);
  const [boardView, setBoardView] = useState<BoardView>("board");
  const [filters, setFilters] = useState<TaskFilters>({});

  const changeView = (next: BoardViewId) => {
    history.replaceState(null, "", boardViewHref(window.location.href, next, gitLocation));
    setView(next);
  };

  return (
    <div className="flex flex-col gap-group">
      {onProjectChange === undefined ? null : (
        <ProjectSelect projects={projects} value={project} onChange={onProjectChange} />
      )}
      <Tabs
        value={view}
        onValueChange={(next) => {
          const known = views.find((item) => item.id === next);
          if (known !== undefined) changeView(known.id);
        }}
      >
        <TabsList aria-label="Board views">
          {views.map((item) => (
            <TabsTab key={item.id} value={item.id}>
              {item.label}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel value="tasks" className="flex flex-col gap-group pt-group">
          <TaskBoard
            tasks={data.tasks}
            stages={data.stages}
            view={boardView}
            filters={filters}
            onViewChange={setBoardView}
            onFiltersChange={setFilters}
            generatedAt={data.generatedAt}
            timeZone={data.timeZone}
            live={live}
            review={review}
          />
        </TabsPanel>
        <TabsPanel value="telemetry" className="pt-group">
          <TelemetryTab telemetry={data.telemetry} />
        </TabsPanel>
        {git === null ? null : (
          <TabsPanel value="git" className="pt-group">
            <GitTab
              api={git}
              project={project}
              timeZone={data.timeZone}
              location={gitLocation}
              onLocationChange={changeGitLocation}
            />
          </TabsPanel>
        )}
      </Tabs>
    </div>
  );
}

export { BoardViews };
