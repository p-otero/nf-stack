"use client"

import { Button } from "@ui-sdk/react/button"
import { useMemo, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from "lucide-react"

import {
  activeAttempt,
  attemptCount,
  sortTasks,
  taskCost,
  type SortDirection,
  type SortKey,
} from "@/lib/agent-task-board-model"
import type { TableColumn } from "@/lib/agent-task-board-labels"
import { effectiveAgent, type TaskView } from "@/lib/agent-task-types"
import { AgentBadge } from "@/components/ui/agent-badge"
import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { QuantityValue } from "@/components/ui/quantity-value"
import { RelativeTime } from "@/components/ui/relative-time"
import { NavigableRow, RowNavigationProvider, useRowNavigation } from "@/components/ui/row-navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TaskStatusIcon, TaskStatusPill } from "@/components/ui/task-status"
import type { TaskDisplayOptions } from "@/components/ui/task-card"
import { usageFormatter } from "@/components/ui/usage"

type AgentTaskBoardTableProps = {
  tasks: TaskView[]
  selectedTaskId: string | null
  display: TaskDisplayOptions & { labels: AgentTaskBoardLabels }
}

const columns: { key: TableColumn; sort?: SortKey; end?: boolean }[] = [
  { key: "id", sort: "id" },
  { key: "title", sort: "title" },
  { key: "status", sort: "status" },
  { key: "profile" },
  { key: "agent" },
  { key: "attempts", sort: "attempts", end: true },
  { key: "cost", sort: "cost", end: true },
  { key: "updatedAt", sort: "updatedAt" },
]

const headerButtonClassName =
  "-mx-(--chip-padding-x) inline-flex cursor-pointer items-center gap-inline rounded-control px-inset-chip py-inset-chip font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"

function SortIcon({ direction }: { direction?: SortDirection }) {
  if (direction === "ascending") return <ChevronUpIcon />
  if (direction === "descending") return <ChevronDownIcon />
  return <ChevronsUpDownIcon />
}

function AgentTaskBoardTable({ tasks, selectedTaskId, display }: AgentTaskBoardTableProps) {
  const { labels, onSelectTask, now, locale, timeZone, formatCurrency, agentAvatars } = display
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "status",
    direction: "ascending",
  })
  const rows = useMemo(() => sortTasks(tasks, sort.key, sort.direction), [tasks, sort])
  const navigation = useRowNavigation({ ids: rows.map((task) => task.id) })
  const formatCost = usageFormatter("cost", { locale, formatCurrency })
  const text = labels.table

  function toggle(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending",
    }))
  }

  return (
    <Table aria-label={text.name} data-slot="agent-task-board-table">
      <TableHeader>
        <TableRow>
          {columns.map((column) => {
            const sorted = sort.key === column.sort ? sort.direction : undefined
            const label = text.columns[column.key]
            return (
              <TableHead
                key={column.key}
                scope="col"
                aria-sort={sorted}
                className={column.end ? "text-end" : undefined}
              >
                {column.sort ? (
                  <Button
                    aria-label={text.sortBy(label)}
                    className={headerButtonClassName}
                    onClick={() => column.sort && toggle(column.sort)}
                  >
                    {label}
                    <SortIcon direction={sorted} />
                  </Button>
                ) : (
                  label
                )}
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        <RowNavigationProvider handle={navigation}>
          {rows.map((task) => {
            const attempt = activeAttempt(task)
            const selected = task.id === selectedTaskId
            return (
              <TableRow
                key={task.id}
                data-task-id={task.id}
                data-selected={selected ? "" : undefined}
                className="data-selected:bg-muted"
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{task.id}</TableCell>
                <TableCell className="max-w-96">
                  <NavigableRow
                    id={task.id}
                    render={
                      <Button
                        data-task-select=""
                        data-task-id={task.id}
                        aria-label={labels.card.open(task.id, task.title)}
                        aria-current={selected ? "true" : undefined}
                        title={task.title}
                        onClick={() => onSelectTask?.(task.id)}
                        className="max-w-full cursor-pointer truncate rounded-control text-start font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {task.title}
                      </Button>
                    }
                  />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-inline">
                    <TaskStatusIcon status={task.status} tone={display.statusTones?.[task.status]} />
                    <TaskStatusPill status={task.status} labels={labels.components.taskStatus} />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{task.profile ?? "—"}</TableCell>
                <TableCell className="max-w-56">
                  {attempt ? (
                    <AgentBadge
                      agent={effectiveAgent(attempt)}
                      requested={attempt.configured}
                      labels={labels.components.agentBadge}
                      avatars={agentAvatars}
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums">{attemptCount(task)}</TableCell>
                <TableCell className="text-end">
                  <QuantityValue
                    value={taskCost(task)}
                    format={formatCost}
                    labels={labels.components.usage?.quantity}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime value={task.updatedAt} now={now} locale={locale} timeZone={timeZone} />
                </TableCell>
              </TableRow>
            )
          })}
        </RowNavigationProvider>
      </TableBody>
    </Table>
  )
}

export { AgentTaskBoardTable }
export type { AgentTaskBoardTableProps }
