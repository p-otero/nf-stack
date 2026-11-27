import { useCallback, useMemo, useState } from "react";

import type { TaskStage, TaskView as NfTaskView } from "@nf/contracts";
import type { ColumnConfig, FilterControl, TaskFilters } from "@/lib/agent-task-board-model";
import type { TaskLink, TaskView, ThreadRef } from "@/lib/agent-task-types";
import type { BoardView } from "@/components/ui/agent-task-board-primitive";
import { Button } from "@/components/ui/button";
import { TaskLinkIcon } from "@/components/ui/task-links";
import type { Writable } from "@/contract";
import { AgentTaskBoard } from "@/components/ui/agent-task-board";
import { useColorScheme } from "@/components/nf/color-scheme";
import { withAgentLogos } from "@/components/nf/agent-logos";
import { ApproveCommand } from "@/components/nf/approve-command";
import { boardStages } from "@/components/nf/board-stages";
import { NfTaskDetailDialog } from "@/components/nf/task-detail-dialog";
import { useProviderAvatars } from "@/components/nf/provider-logo";
import { ReviewActions, awaitsApproval, type ReviewLive } from "@/components/nf/review-actions";
import { T3Logo } from "@/components/nf/t3-logo";
import { TaskEvidence } from "@/components/nf/task-evidence";

/** The Eskais labels are English already; only the thread link and the stage filter say where. */
const BOARD_LABELS = {
  openThread: "Open in T3",
  filters: { noStage: "No code" },
};

/** NF renders its own project selector, so the board's built-in one would be a second choice. */
const FILTER_CONTROLS: readonly FilterControl[] = ["query", "profile", "model", "stage"];

/** Proposals live in the backlog view; the columns are the tasks an attempt can start on. */
const BOARD_COLUMNS: ColumnConfig[] = [{ status: "proposed", hidden: true }];

/** A proposal is approved from a terminal; the same command sits at the end of its backlog row. */
const renderBacklogActions = (task: Pick<TaskView, "id">) => <ApproveCommand taskId={task.id} />;

const LINK_CLASS =
  "h-auto min-w-0 justify-start px-0 py-inline text-start whitespace-normal wrap-anywhere";

/** PR, branch and commit links leave the board in a new tab, never in the board's own tab. */
const renderLink = (link: TaskLink) => (
  <Button
    variant="link"
    size="sm"
    render={<a href={link.href} target="_blank" rel="noopener noreferrer" />}
    title={`${link.kind}: ${link.href}`}
    className={LINK_CLASS}
  >
    <TaskLinkIcon kind={link.kind} className="text-muted-foreground" />
    <span className="min-w-0">{link.label}</span>
  </Button>
);

/** The same for the card's pull-request icon, whose default anchor has no target of its own. */
const openLinkInNewTab = (link: TaskLink): void => {
  globalThis.open(link.href, "_blank", "noopener,noreferrer");
};

/** T3's deep link is a plain anchor: no target, no handler, so T3's browser asks before it opens. */
const renderThreadLink = (thread: ThreadRef) =>
  thread.href === undefined ? null : (
    <Button
      data-slot="attempt-thread"
      variant="outline"
      size="sm"
      render={<a href={thread.href} title={thread.id} />}
      className="h-control-sm self-start"
    >
      <T3Logo />
      <span>{BOARD_LABELS.openThread}</span>
    </Button>
  );

function TaskBoard({
  tasks,
  stages,
  view,
  filters,
  onViewChange,
  onFiltersChange,
  generatedAt,
  timeZone,
  live,
  review,
}: {
  tasks: Writable<NfTaskView>[];
  stages: readonly TaskStage[];
  view: BoardView;
  filters: TaskFilters;
  onViewChange: (view: BoardView) => void;
  onFiltersChange: (filters: TaskFilters) => void;
  generatedAt: string;
  timeZone: string;
  /** A live board reads "now" from the browser and drops the snapshot banner. */
  live: boolean;
  /** The live board's review channel; absent on a snapshot, which shows the CLI commands. */
  review?: ReviewLive | undefined;
}) {
  const theme = useColorScheme();
  const avatars = useProviderAvatars();
  const track = useMemo(() => boardStages(stages), [stages]);
  const taskViews = useMemo(() => tasks.map((task) => withAgentLogos(task, theme)), [tasks, theme]);
  const [columns, setColumns] = useState<ColumnConfig[]>(BOARD_COLUMNS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const renderCardActions = useCallback(
    (task: TaskView) =>
      awaitsApproval(task) ? <ReviewActions taskId={task.id} live={review} /> : null,
    [review],
  );
  const renderAttachments = useCallback(
    (task: TaskView) => <TaskEvidence task={task} live={review} />,
    [review],
  );
  return (
    <>
      <AgentTaskBoard
        tasks={taskViews}
        agentAvatars={avatars}
        mode={live ? "live" : "snapshot"}
        generatedAt={generatedAt}
        timeZone={timeZone}
        locale="en"
        labels={BOARD_LABELS}
        columnAccent="tint"
        columns={columns}
        onColumnsChange={setColumns}
        filterControls={FILTER_CONTROLS}
        view={view}
        onViewChange={onViewChange}
        filters={filters}
        onFiltersChange={onFiltersChange}
        stages={track}
        renderBacklogActions={renderBacklogActions}
        renderCardActions={renderCardActions}
        renderAttachments={renderAttachments}
        renderLink={renderLink}
        onOpenLink={openLinkInNewTab}
        renderThreadLink={renderThreadLink}
        selectedTaskId={null}
        onSelectTask={(id) => {
          if (id !== null) setOpenTaskId(id);
        }}
      />
      <NfTaskDetailDialog
        task={openTaskId === null ? undefined : taskViews.find((task) => task.id === openTaskId)}
        live={live}
        mode={live ? "live" : "snapshot"}
        now={live ? undefined : generatedAt}
        timeZone={timeZone}
        locale="en"
        labels={BOARD_LABELS}
        agentAvatars={avatars}
        renderAttachments={renderAttachments}
        renderLink={renderLink}
        onOpenLink={(link) => openLinkInNewTab(link)}
        renderThreadLink={renderThreadLink}
        onSelectTask={(id) => setOpenTaskId(id)}
        canSelect={(id) => tasks.some((task) => task.id === id)}
        onClose={() => setOpenTaskId(null)}
      />
    </>
  );
}

export { TaskBoard };
