"use client"

import type { ReactNode } from "react"

import { attemptCount, needsDecision, taskCost } from "@/lib/agent-task-board-model"
import type { TaskLink, TaskView, ThreadRef } from "@/lib/agent-task-types"
import { AcceptanceList } from "@/components/ui/acceptance-list"
import { agentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { AttachmentStrip } from "@/components/ui/attachments"
import { AttemptTimeline } from "@/components/ui/attempt-timeline"
import { DependencyChips } from "@/components/ui/dependency-chips"
import { ProposalActions } from "@/components/ui/proposal-actions"
import { RelativeTime } from "@/components/ui/relative-time"
import { TaskStatusIcon, taskStatusTones } from "@/components/ui/task-status"
import { proposalError, type TaskDisplayOptions } from "@/components/ui/task-card"
import { Block, DetailValue } from "@/components/ui/task-detail-parts"
import { TaskLinks } from "@/components/ui/task-links"
import { TaskLocationTrack } from "@/components/ui/task-location"
import { UsageGrid } from "@/components/ui/usage-grid"

/** The sections of the main column, in their default order. */
const taskDetailMainSections = ["goal", "decision", "acceptance", "attachments", "activity"] as const
/** The sections of the side column, in their default order. */
const taskDetailSideSections = ["details", "dependencies", "attemptsSummary", "usage", "links", "location"] as const

type TaskDetailMainSection = (typeof taskDetailMainSections)[number]
type TaskDetailSideSection = (typeof taskDetailSideSections)[number]
type TaskDetailSection = TaskDetailMainSection | TaskDetailSideSection
/** Rows of the details list that a header may already show. */
type TaskDetailRow = "status" | "cost"

const noRows: readonly TaskDetailRow[] = []

type TaskDetailSectionProps = TaskDisplayOptions & {
  task: TaskView
  renderThreadLink?: (thread: ThreadRef) => ReactNode
  onOpenThread?: (thread: ThreadRef) => void
  /** Replaces the default link in the detail's list of links. */
  renderLink?: (link: TaskLink) => ReactNode
  /** Replaces the attachment strip. */
  renderAttachments?: (task: TaskView) => ReactNode
  /** Replaces the stage track. */
  renderLocation?: (task: TaskView) => ReactNode
  /** Heading level of the section. */
  headingLevel?: number
}

function TaskDetailGoal({ task, labels = agentTaskBoardLabels, headingLevel = 3 }: TaskDetailSectionProps) {
  if (!task.goal) return null
  return (
    <Block title={labels.panel.goal} level={headingLevel}>
      <p className="text-sm whitespace-pre-line">{task.goal}</p>
    </Block>
  )
}

function TaskDetailDecision({
  task,
  mode = "snapshot",
  labels = agentTaskBoardLabels,
  onApproveProposal,
  onRejectProposal,
  agentApproval,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  if (!needsDecision(task)) return null
  return (
    <Block title={labels.panel.decision} level={headingLevel}>
      {task.decisionNeeded && <p className="text-sm">{task.decisionNeeded}</p>}
      {task.status === "proposed" && (
        <ProposalActions
          taskId={task.id}
          mode={mode}
          onApprove={onApproveProposal}
          onReject={onRejectProposal}
          agentApproval={agentApproval}
          labels={labels.proposals}
          renderError={(error) => proposalError(error, labels)}
        />
      )}
    </Block>
  )
}

function TaskDetailAcceptance({ task, labels = agentTaskBoardLabels, headingLevel = 3 }: TaskDetailSectionProps) {
  return (
    <Block title={labels.panel.acceptance} level={headingLevel}>
      {task.acceptance.length > 0 ? (
        <AcceptanceList
          criteria={task.acceptance}
          labels={labels.components.acceptance}
          evidence="disclosure"
          className="gap-inline"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{labels.panel.noAcceptance}</p>
      )}
    </Block>
  )
}

function TaskDetailAttachments({
  task,
  locale,
  labels = agentTaskBoardLabels,
  renderAttachments,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  const attachments = renderAttachments
    ? renderAttachments(task)
    : task.attachments &&
      task.attachments.length > 0 && (
        <AttachmentStrip
          attachments={task.attachments}
          aria-label={labels.panel.attachmentsOf(task.id)}
          labels={labels.components.attachments}
          locale={locale}
        />
      )
  if (!attachments) return null
  return (
    <Block title={labels.panel.attachments} level={headingLevel}>
      {attachments}
    </Block>
  )
}

function TaskDetailActivity({
  task,
  now,
  locale,
  timeZone,
  formatCurrency,
  labels = agentTaskBoardLabels,
  agentAvatars,
  renderThreadLink,
  onOpenThread,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  const parts = labels.components
  return (
    <Block title={labels.panel.activity} level={headingLevel}>
      {task.attempts.length > 0 ? (
        <AttemptTimeline
          attempts={task.attempts}
          labels={{ ...parts.attemptTimeline, threadLink: labels.openThread }}
          usageLabels={parts.usage}
          usageOpenUpTo={0}
          agentAvatars={agentAvatars}
          formatCurrency={formatCurrency}
          renderThreadLink={renderThreadLink}
          onOpenThread={onOpenThread}
          now={now}
          locale={locale}
          timeZone={timeZone}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{labels.empty.attempts}</p>
      )}
    </Block>
  )
}

function TaskDetailDetails({
  task,
  now,
  locale,
  timeZone,
  formatCurrency,
  labels = agentTaskBoardLabels,
  statusTones,
  hide = noRows,
}: TaskDetailSectionProps & {
  /** Rows to leave out, like the ones a header already shows. */
  hide?: readonly TaskDetailRow[]
}) {
  const text = labels.panel
  const parts = labels.components
  return (
    <dl className="grid grid-cols-(--detail-value-columns) content-start gap-x-group gap-y-items text-sm">
      {!hide.includes("status") && (
        <DetailValue term={text.status}>
          <span className="inline-flex items-center gap-inline">
            <TaskStatusIcon status={task.status} tone={statusTones?.[task.status]} />
            <span>{parts.taskStatus?.[task.status] ?? labels.columns[task.status]}</span>
          </span>
        </DetailValue>
      )}
      {task.profile && <DetailValue term={text.profile}>{task.profile}</DetailValue>}
      {task.project && <DetailValue term={text.project}>{task.project}</DetailValue>}
      <DetailValue term={text.updated}>
        <RelativeTime value={task.updatedAt} now={now} locale={locale} timeZone={timeZone} />
      </DetailValue>
      {!task.usage && !hide.includes("cost") && (
        <DetailValue
          term={text.cost}
          quantity={taskCost(task)}
          locale={locale}
          formatCurrency={formatCurrency}
          quantityLabels={parts.usage?.quantity}
        />
      )}
      {task.labels && task.labels.length > 0 && (
        <DetailValue term={text.labels} wrap>
          <ul className="flex flex-wrap gap-inline">
            {task.labels.map((label) => (
              <li
                key={label}
                className="rounded-control border bg-secondary px-inset-chip py-inset-chip text-xs text-secondary-foreground"
              >
                {label}
              </li>
            ))}
          </ul>
        </DetailValue>
      )}
    </dl>
  )
}

function TaskDetailDependencies({
  task,
  labels = agentTaskBoardLabels,
  onSelectTask,
  canSelect,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  if (task.dependsOn.length === 0) return null
  const selectable = onSelectTask && task.dependsOn.some((dependency) => canSelect?.(dependency.id) ?? true)
  return (
    <Block title={labels.panel.dependencies} level={headingLevel}>
      <DependencyChips
        aria-label={labels.panel.dependenciesOf(task.id)}
        items={task.dependsOn.map((dependency) => ({
          id: dependency.id,
          label: `${dependency.id} ${dependency.title ?? ""}`.trim(),
          tone: taskStatusTones[dependency.status],
        }))}
        onSelect={selectable ? (id) => (canSelect?.(id) ?? true) && onSelectTask?.(id) : undefined}
      />
    </Block>
  )
}

function TaskDetailAttempts({ task, labels = agentTaskBoardLabels, headingLevel = 3 }: TaskDetailSectionProps) {
  const text = labels.panel
  const counts = task.counts
  return (
    <Block title={text.attemptsSummary} level={headingLevel}>
      <dl className="grid grid-cols-(--detail-value-columns) gap-x-group gap-y-inline text-sm">
        <DetailValue term={text.counts.attempts} inline>
          {counts?.attempts ?? attemptCount(task)}
        </DetailValue>
        {counts && (
          <>
            <DetailValue term={text.counts.repairs} inline>
              {counts.repairs}
            </DetailValue>
            <DetailValue term={text.counts.reviews} inline>
              {counts.reviews}
            </DetailValue>
            <DetailValue term={text.counts.humanInterventions} inline>
              {counts.humanInterventions}
            </DetailValue>
          </>
        )}
        {task.acceptedFirstPass !== undefined && (
          <DetailValue term={text.acceptedFirstPass} inline>
            {task.acceptedFirstPass ? text.yes : text.no}
          </DetailValue>
        )}
      </dl>
    </Block>
  )
}

function TaskDetailUsage({
  task,
  locale,
  formatCurrency,
  labels = agentTaskBoardLabels,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  if (!task.usage) return null
  return (
    <Block title={labels.panel.usage} level={headingLevel}>
      <UsageGrid
        usage={task.usage}
        variant="compact"
        aria-label={labels.panel.usageOf(task.id)}
        labels={labels.components.usage}
        locale={locale}
        formatCurrency={formatCurrency}
      />
    </Block>
  )
}

function TaskDetailLinks({
  task,
  labels = agentTaskBoardLabels,
  renderLink,
  onOpenLink,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  const links = task.links ?? []
  if (links.length === 0) return null
  return (
    <Block title={labels.panel.links} level={headingLevel}>
      <TaskLinks
        links={links}
        aria-label={labels.panel.linksOf(task.id)}
        labels={labels.link}
        renderLink={renderLink}
        onOpenLink={onOpenLink && ((link) => onOpenLink(link, task))}
      />
    </Block>
  )
}

function TaskDetailLocation({
  task,
  labels = agentTaskBoardLabels,
  stages,
  renderLocation,
  headingLevel = 3,
}: TaskDetailSectionProps) {
  const location = renderLocation
    ? renderLocation(task)
    : task.location && (
        <TaskLocationTrack location={task.location} stages={stages} aria-label={labels.panel.locationOf(task.id)} />
      )
  if (!location) return null
  return (
    <Block title={labels.panel.location} level={headingLevel}>
      {location}
    </Block>
  )
}

export {
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
}
export type { TaskDetailMainSection, TaskDetailRow, TaskDetailSection, TaskDetailSectionProps, TaskDetailSideSection }
