"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"

import {
  FILTER_CONTROLS,
  NO_STAGE,
  activeFilters,
  countByStage,
  filterOptions,
  filterTasks,
  groupByStatus,
  moveTask,
  summarize,
  type ColumnConfig,
  type TaskFilters,
  type TaskMove,
} from "@/lib/agent-task-board-model"
import type { AgentTaskBoardProps, ColumnAccent } from "@/components/ui/agent-task-board-props"
import type { TaskStatus, TaskView } from "@/lib/agent-task-types"
import { ActionRefusedError } from "@/lib/action-refusal"
import { useLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"
import {
  AgentTaskBoardRoot,
  AgentTaskMovesRoot,
  AgentTaskProposalsRoot,
  createAgentTaskBoardController,
} from "@/components/ui/agent-task-board-root"
import { AgentTaskBoardBacklog } from "@/components/ui/agent-task-board-backlog"
import { AgentTaskBoardColumns, withColumn } from "@/components/ui/agent-task-board-columns"
import { AgentTaskBoardDetail } from "@/components/ui/agent-task-board-detail"
import { AgentTaskBoardEmpty } from "@/components/ui/agent-task-board-empty"
import { AgentTaskBoardSummary } from "@/components/ui/agent-task-board-summary"
import { AgentTaskBoardTable } from "@/components/ui/agent-task-board-table"
import { AgentTaskBoardToolbar, clearedFilters } from "@/components/ui/agent-task-board-toolbar"
import { agentTaskBoardLabels, agentTaskBoardLabelsEs, resolveLabels } from "@/components/ui/agent-task-labels"
import { useNow } from "@/components/ui/relative-time"
import type { TaskDisplayOptions } from "@/components/ui/task-card"
import { taskStatusAccentTones } from "@/components/ui/task-status"
import { useBoardFocus } from "@/components/ui/use-board-focus"

const NO_FILTERS: TaskFilters = {}

type BoardController = ReturnType<typeof createAgentTaskBoardController>
type PanelCloseReason = "close-press" | "escape-key" | "outside-press" | "imperative"

// The detail dialog also closes on its own (an action inside it, unmount). A refusal then keeps the task selected and
// the dialog follows the selection, so there is no one to tell.
function deselect(controller: BoardController, reason: PanelCloseReason) {
  if (reason !== "imperative") return controller.selectTask(null, { reason })
  try {
    return controller.selectTask(null, { reason })
  } catch (error) {
    if (error instanceof ActionRefusedError) return false
    throw error
  }
}

function defaultCanMoveTask(task: TaskView, to: TaskStatus) {
  return task.status === to || (task.status !== "proposed" && to !== "proposed")
}
const NO_COLUMNS: ColumnConfig[] = []

function useControllable<T>(value: T | undefined, initial: T) {
  const [own, setOwn] = useState(initial)
  return [value === undefined ? own : value, setOwn] as const
}

function AgentTaskBoard(props: AgentTaskBoardProps) {
  const { tasks, mode, generatedAt, formatCurrency, timeZone, agentApproval = "confirm" } = props
  const { onApproveProposal, onRejectProposal, renderThreadLink, onOpenThread } = props
  const { detailPresentation = "dialog", density = "auto", agentAvatars, columnAccent = "tint" } = props
  const { renderLink, onOpenLink, renderAttachments, renderLocation, stages } = props
  const { renderBacklogActions, renderCardActions, filterControls = FILTER_CONTROLS } = props
  const { onMoveTask, canMoveTask = defaultCanMoveTask } = props
  const tones = useMemo(() => ({ ...taskStatusAccentTones, ...props.columnTones }), [props.columnTones])
  const labels = useMemo(() => resolveLabels(props.labels), [props.labels])
  const now = useNow({ now: mode === "snapshot" ? generatedAt : props.now })
  const locale = useLocale(props.locale)
  const [controller] = useState(createAgentTaskBoardController)
  const [view, setView] = useControllable(props.view, props.defaultView ?? "board")
  const [filters, setFilters] = useControllable(props.filters, props.defaultFilters ?? NO_FILTERS)
  const [columns, setColumns] = useControllable(props.columns, NO_COLUMNS)
  const [selectedId, setSelectedId] = useControllable(props.selectedTaskId, props.defaultSelectedTaskId ?? null)

  const options = useMemo(() => filterOptions(tasks), [tasks])
  const ids = useMemo(() => new Set(tasks.map((task) => task.id)), [tasks])
  const filtered = useMemo(() => filterTasks(tasks, filters), [tasks, filters])
  const stageIds = useMemo(() => stages?.map((stage) => stage.id), [stages])
  const someWithoutStage = useMemo(() => tasks.some((task) => !task.location), [tasks])
  const noStage = Boolean(stages) && (props.stageFilterNone ?? someWithoutStage)
  const stageCounts = useMemo(() => {
    if (!stages) return undefined
    const counts = countByStage(filterTasks(tasks, { ...filters, stage: undefined }))
    return Object.fromEntries([...stages.map((stage) => stage.id), NO_STAGE].map((id) => [id, counts[id] ?? 0]))
  }, [stages, tasks, filters])
  const grouped = useMemo(() => groupByStatus(filtered, columns), [filtered, columns])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const movableStatuses = useMemo(
    () => grouped.filter((column) => !column.collapsed).map((column) => column.status),
    [grouped],
  )
  const selected = selectedId === null ? undefined : tasks.find((task) => task.id === selectedId)
  const live = mode === "live"

  const { bodyRef, focusPanelNext, focusCardNext, cardOfLastTask } = useBoardFocus(selectedId, {
    modal: detailPresentation !== "side",
  })
  const selectTask = useCallback(
    (id: string) => {
      focusPanelNext()
      controller.selectTask(id, { reason: "item-press" })
    },
    [controller, focusPanelNext],
  )
  const closePanel = useCallback(
    (reason: PanelCloseReason) => {
      focusCardNext()
      deselect(controller, reason)
    },
    [controller, focusCardNext],
  )

  const display = useMemo<TaskDisplayOptions & { labels: typeof labels }>(
    () => ({
      mode,
      now,
      locale,
      timeZone,
      formatCurrency,
      labels,
      agentApproval,
      onApproveProposal: live ? onApproveProposal : undefined,
      onRejectProposal: live ? onRejectProposal : undefined,
      onSelectTask: selectTask,
      canSelect: (id: string) => ids.has(id),
      agentAvatars,
      statusTones: tones,
      onOpenLink,
      stages,
    }),
    [
      mode,
      now,
      locale,
      timeZone,
      formatCurrency,
      labels,
      agentApproval,
      live,
      onApproveProposal,
      onRejectProposal,
      selectTask,
      ids,
      agentAvatars,
      tones,
      onOpenLink,
      stages,
    ],
  )

  const clearFilters = () => controller.filter(clearedFilters(filterControls), { reason: "clear-press" })

  let content: ReactNode
  if (filtered.length === 0) {
    content = (
      <AgentTaskBoardEmpty
        labels={labels}
        filtered={tasks.length > 0}
        canClear={activeFilters(filters, filterControls).length > 0}
        onClear={clearFilters}
      />
    )
  } else if (view === "table") {
    content = <AgentTaskBoardTable tasks={filtered} selectedTaskId={selectedId} display={display} />
  } else if (view === "backlog") {
    content = (
      <AgentTaskBoardBacklog
        tasks={filtered}
        selectedTaskId={selectedId}
        display={display}
        renderActions={renderBacklogActions}
      />
    )
  } else {
    content = (
      <AgentTaskBoardColumns
        columns={grouped}
        selectedTaskId={selectedId}
        display={display}
        tones={columnAccent === "tint" ? tones : undefined}
        renderCardActions={renderCardActions}
        onMoveTask={onMoveTask}
        canMoveTask={canMoveTask}
        onCollapsedChange={(status, collapsed) => {
          const next = withColumn(columns, status, { collapsed })
          setColumns(next)
          props.onColumnsChange?.(next)
        }}
      />
    )
  }

  return (
    <AgentTaskBoardRoot
      aria-label={labels.board}
      data-slot="agent-task-board"
      data-mode={mode}
      controller={controller}
      tasks={tasks}
      stageIds={stageIds}
      noStageLabel={labels.filters.noStage}
      view={view}
      onViewChange={(next) => {
        setView(next)
        props.onViewChange?.(next)
      }}
      filters={filters}
      onFiltersChange={(next) => {
        setFilters(next)
        props.onFiltersChange?.(next)
      }}
      selectedTaskId={selectedId}
      onSelectTask={(id) => {
        setSelectedId(id)
        props.onSelectTask?.(id)
      }}
      onOpenThread={onOpenThread && ((thread) => onOpenThread(thread))}
      onOpenLink={
        onOpenLink &&
        ((link, details) => {
          const task = tasks.find((candidate) => candidate.id === details.taskId)
          if (task) onOpenLink(link, task)
        })
      }
      className={cn("@container/agent-task-board min-w-0", props.className)}
    >
      <div data-slot="agent-task-board-density" data-board-density={density} className="flex flex-col gap-section">
        <AgentTaskBoardDetail
          header={
            <>
              <AgentTaskBoardToolbar
                options={options}
                filters={filters}
                view={view}
                labels={labels}
                controller={controller}
                generatedAt={mode === "snapshot" ? generatedAt : undefined}
                locale={locale}
                timeZone={timeZone}
                stages={stages}
                stageCounts={stageCounts}
                noStage={noStage}
                controls={filterControls}
              />
              <AgentTaskBoardSummary
                summary={summary}
                labels={labels}
                locale={locale}
                formatCurrency={formatCurrency}
              />
            </>
          }
          presentation={detailPresentation}
          bodyRef={bodyRef}
          selected={selected}
          display={display}
          onClose={closePanel}
          returnFocus={cardOfLastTask}
          renderThreadLink={renderThreadLink}
          onOpenThread={onOpenThread}
          renderLink={renderLink}
          renderAttachments={renderAttachments}
          renderLocation={renderLocation}
        >
          {content}
        </AgentTaskBoardDetail>
        <AgentTaskProposalsRoot
          aria-label={labels.proposals.group}
          className="sr-only"
          tasks={tasks}
          mode={mode}
          agentApproval={agentApproval}
          agentConfirm={labels.proposals.agentConfirm}
          onApproveProposal={live && onApproveProposal ? (id) => onApproveProposal(id) : undefined}
          onRejectProposal={live && onRejectProposal ? (id) => onRejectProposal(id) : undefined}
        />
        <AgentTaskMovesRoot
          aria-label={labels.moves.group}
          className="sr-only"
          tasks={filtered}
          statuses={view === "board" ? movableStatuses : undefined}
          canMove={canMoveTask}
          agentApproval={agentApproval}
          agentConfirm={labels.moves.agentConfirm}
          onMoveTask={onMoveTask}
        />
      </div>
    </AgentTaskBoardRoot>
  )
}

export { AgentTaskBoard, NO_STAGE, agentTaskBoardLabels, moveTask, agentTaskBoardLabelsEs, taskStatusAccentTones }
export type { AgentTaskBoardProps, ColumnAccent, TaskMove }
