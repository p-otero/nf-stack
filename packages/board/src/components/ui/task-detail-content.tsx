"use client"

import type { ComponentType } from "react"

import type { TaskView } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { agentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { TaskStatusIcon, TaskStatusPill } from "@/components/ui/task-status"
import type { TaskDisplayOptions } from "@/components/ui/task-card"
import {
  TaskDetailAcceptance,
  TaskDetailActivity,
  TaskDetailAttachments,
  TaskDetailAttempts,
  TaskDetailDecision,
  TaskDetailDependencies,
  TaskDetailDetails,
  TaskDetailGoal,
  TaskDetailLinks,
  TaskDetailLocation,
  TaskDetailUsage,
  taskDetailMainSections,
  taskDetailSideSections,
  type TaskDetailMainSection,
  type TaskDetailRow,
  type TaskDetailSection,
  type TaskDetailSectionProps,
  type TaskDetailSideSection,
} from "@/components/ui/task-detail-sections"

type TaskDetailContentProps = TaskDetailSectionProps & {
  /**
   * `"split"` sets the side column beside the main one once the content is 56rem wide, inside an
   * `@container/task-detail`; `"stack"` (default) keeps one column, the side after the main.
   */
  layout?: "stack" | "split"
  /** Lists the status among the details; turn it off where a header already shows it. */
  showStatus?: boolean
  /**
   * Sections and detail rows to leave out, like the ones a header already shows:
   * `hide={["status", "cost", "attemptsSummary", "acceptance"]}`.
   */
  hide?: readonly (TaskDetailSection | TaskDetailRow)[]
  /** The sections of each column, in order; a column you pass shows only those. Both default to every section. */
  sections?: {
    main?: readonly TaskDetailMainSection[]
    side?: readonly TaskDetailSideSection[]
  }
}

const nothingHidden: NonNullable<TaskDetailContentProps["hide"]> = []

const sectionComponents: Record<Exclude<TaskDetailSection, "details">, ComponentType<TaskDetailSectionProps>> = {
  goal: TaskDetailGoal,
  decision: TaskDetailDecision,
  acceptance: TaskDetailAcceptance,
  attachments: TaskDetailAttachments,
  activity: TaskDetailActivity,
  dependencies: TaskDetailDependencies,
  attemptsSummary: TaskDetailAttempts,
  usage: TaskDetailUsage,
  links: TaskDetailLinks,
  location: TaskDetailLocation,
}

function TaskDetailMeta({
  task,
  labels = agentTaskBoardLabels,
}: {
  task: TaskView
  labels?: TaskDisplayOptions["labels"]
}) {
  return (
    <div className="flex flex-wrap items-center gap-items text-xs">
      <span className="font-mono text-muted-foreground">{task.id}</span>
      <TaskStatusIcon status={task.status} />
      <TaskStatusPill status={task.status} labels={labels?.components.taskStatus} />
    </div>
  )
}

function TaskDetailContent({
  layout = "stack",
  showStatus = true,
  hide = nothingHidden,
  sections,
  headingLevel = 3,
  labels = agentTaskBoardLabels,
  ...props
}: TaskDetailContentProps) {
  const split = layout === "split"
  const shown = <T extends TaskDetailSection>(order: readonly T[]) => order.filter((section) => !hide.includes(section))
  const rows: TaskDetailRow[] = hide.filter((key): key is TaskDetailRow => key === "status" || key === "cost")
  if (!showStatus && !rows.includes("status")) rows.push("status")
  const section = (key: TaskDetailSection) => {
    if (key === "details") return <TaskDetailDetails key={key} {...props} labels={labels} hide={rows} />
    const Section = sectionComponents[key]
    return <Section key={key} {...props} labels={labels} headingLevel={headingLevel} />
  }

  return (
    <div
      data-slot="task-detail-content"
      data-layout={layout}
      className={cn(
        "flex min-w-0 flex-col gap-group",
        split &&
          "@4xl/task-detail:grid @4xl/task-detail:grid-cols-(--task-detail-columns) @4xl/task-detail:items-start @4xl/task-detail:gap-section",
      )}
    >
      <div data-slot="task-detail-main" className="flex min-w-0 flex-col gap-group">
        {shown(sections?.main ?? taskDetailMainSections).map(section)}
      </div>
      <div data-slot="task-detail-side" className="flex min-w-0 flex-col gap-group">
        {shown(sections?.side ?? taskDetailSideSections).map(section)}
      </div>
    </div>
  )
}

export {
  TaskDetailAcceptance,
  TaskDetailActivity,
  TaskDetailAttachments,
  TaskDetailAttempts,
  TaskDetailContent,
  TaskDetailDecision,
  TaskDetailDependencies,
  TaskDetailDetails,
  TaskDetailGoal,
  TaskDetailLinks,
  TaskDetailLocation,
  TaskDetailMeta,
  TaskDetailUsage,
  taskDetailMainSections,
  taskDetailSideSections,
}
export type {
  TaskDetailContentProps,
  TaskDetailMainSection,
  TaskDetailRow,
  TaskDetailSection,
  TaskDetailSectionProps,
  TaskDetailSideSection,
}
