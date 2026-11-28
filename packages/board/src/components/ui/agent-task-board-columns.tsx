"use client"

import type { ChangeDetails, TransferLists, TransferReason } from "@ui-sdk/core"
import { useMemo, type ReactNode } from "react"

import {
  TASK_STATUSES,
  columnOrder,
  isReady,
  type ColumnConfig,
  type StatusColumn,
  type TaskMove,
} from "@/lib/agent-task-board-model"
import type { TaskStatus, TaskView } from "@/lib/agent-task-types"
import type { Tone } from "@/lib/tone"
import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Board, BoardItem, BoardColumn, BoardColumnGroup, BoardList, useBoardLists } from "@/components/ui/board"
import { TaskCard, type TaskDisplayOptions } from "@/components/ui/task-card"
import { isOneOf } from "@/lib/narrow"

type AgentTaskBoardColumnsProps = {
  columns: StatusColumn[]
  selectedTaskId: string | null
  display: TaskDisplayOptions & { labels: AgentTaskBoardLabels }
  onCollapsedChange: (status: TaskStatus, collapsed: boolean) => void
  /** Each column's accent tone; none leaves the columns plain. */
  tones?: Record<TaskStatus, Tone>
  renderCardActions?: (task: TaskView) => ReactNode
  /** Cards move between columns and within one; the host applies the move to its tasks. */
  onMoveTask?: (move: TaskMove, details: ChangeDetails<TransferReason>) => void
  canMoveTask?: (task: TaskView, to: TaskStatus) => boolean
}

type Group = "ready" | "waiting"

const groupList = (group: Group) => `todo:${group}`
const statusOf = (list: string) => {
  const status = list.split(":")[0]
  return isOneOf(TASK_STATUSES, status) ? status : undefined
}

function withColumn(columns: readonly ColumnConfig[], status: TaskStatus, change: Partial<ColumnConfig>) {
  const config = new Map(columns.map((column) => [column.status, column]))
  const fullOrder = columnOrder(columns)
  return fullOrder.map((each) => {
    const column = config.get(each) ?? { status: each }
    return each === status ? { ...column, ...change } : column
  })
}

function listsOf(columns: readonly StatusColumn[]): TransferLists {
  const lists: TransferLists = {}
  for (const column of columns) {
    if (column.collapsed) continue
    if (column.groups) {
      lists[groupList("ready")] = column.groups.ready.map((task) => task.id)
      lists[groupList("waiting")] = column.groups.waiting.map((task) => task.id)
    } else {
      lists[column.status] = column.tasks.map((task) => task.id)
    }
  }
  return lists
}

function GroupCards({ group, render }: { group: Group; render: (id: string) => ReactNode }) {
  const ids = useBoardLists()?.[groupList(group)] ?? []
  return <BoardList value={groupList(group)}>{ids.map(render)}</BoardList>
}

function AgentTaskBoardColumns({
  columns,
  selectedTaskId,
  display,
  onCollapsedChange,
  tones,
  renderCardActions,
  onMoveTask,
  canMoveTask,
}: AgentTaskBoardColumnsProps) {
  const { labels } = display
  const movable = onMoveTask !== undefined
  const byId = useMemo(
    () => new Map(columns.flatMap((column) => column.tasks.map((task) => [task.id, task]))),
    [columns],
  )
  const lists = useMemo(() => (movable ? listsOf(columns) : undefined), [movable, columns])

  const card = (task: TaskView) => (
    <TaskCard
      key={task.id}
      task={task}
      selected={task.id === selectedTaskId}
      renderActions={renderCardActions}
      movable={movable}
      {...display}
    />
  )
  const movableCard = (id: string) => {
    const task = byId.get(id)
    if (!task) return null
    return (
      <BoardItem key={id} value={id} variant="plain">
        {card(task)}
      </BoardItem>
    )
  }

  const accepts = (id: string, list: string) => {
    const task = byId.get(id)
    if (!task || !lists || !(list in lists)) return false
    const to = statusOf(list)
    if (!to) return false
    if (to === "todo" && list !== to && list !== groupList(isReady(task) ? "ready" : "waiting")) return false
    return task.status === to || (canMoveTask ? canMoveTask(task, to) : task.status !== "proposed" && to !== "proposed")
  }

  const move = (
    next: TransferLists,
    details: ChangeDetails<TransferReason> & { key: string; from: string; to: string; index: number },
  ) => {
    const task = byId.get(details.key)
    const to = statusOf(details.to)
    if (!task || !onMoveTask || !to) return
    const before = next[details.to]?.[details.index + 1] ?? null
    onMoveTask({ id: task.id, from: task.status, to, index: details.index, before }, details)
  }

  const board = columns.map((column) => {
    let content: ReactNode | ((ids: string[]) => ReactNode)
    if (column.groups) {
      const { ready, waiting } = column.groups
      const groups: { group: Group; title: string; tasks: TaskView[] }[] = [
        { group: "ready", title: labels.ready, tasks: ready },
        { group: "waiting", title: labels.waiting, tasks: waiting },
      ]
      content = groups
        .filter(({ tasks }) => movable || tasks.length > 0)
        .map(({ group, title, tasks }) => (
          <BoardColumnGroup key={group} title={title} count={tasks.length}>
            {movable ? <GroupCards group={group} render={movableCard} /> : tasks.map(card)}
          </BoardColumnGroup>
        ))
    } else {
      content = movable ? (ids: string[]) => ids.map(movableCard) : column.tasks.map(card)
    }
    return (
      <BoardColumn
        key={column.status}
        value={movable && !column.groups ? column.status : undefined}
        data-status={column.status}
        title={labels.columns[column.status]}
        tone={tones?.[column.status]}
        count={column.tasks.length}
        collapsed={column.collapsed}
        onCollapsedChange={(collapsed) => onCollapsedChange(column.status, collapsed)}
        empty={<p className="text-sm text-muted-foreground">{labels.empty.column}</p>}
        labels={labels.components.boardColumn}
      >
        {content}
      </BoardColumn>
    )
  })

  if (!lists) return <Board aria-label={labels.views.board}>{board}</Board>
  return (
    <Board
      aria-label={labels.views.board}
      value={lists}
      onValueChange={move}
      order={Object.keys(lists)}
      accepts={accepts}
      handle
      handleFocus="card"
      agentMoves={false}
      itemLabel={(id) => byId.get(id)?.title}
      listLabel={(list) => {
        const status = statusOf(list)
        return status && labels.columns[status]
      }}
      labels={labels.moves}
    >
      {board}
    </Board>
  )
}

export { AgentTaskBoardColumns, withColumn }
export type { AgentTaskBoardColumnsProps }
