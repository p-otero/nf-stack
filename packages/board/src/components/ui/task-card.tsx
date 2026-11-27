"use client"

import { Button } from "@ui-sdk/react/button"
import { memo, useCallback, useRef, type ComponentProps, type ReactNode } from "react"

import { activeAttempt, attemptCount } from "@/lib/agent-task-board-model"
import { agentDiffers, effectiveAgent, type TaskLink, type TaskStatus, type TaskView } from "@/lib/agent-task-types"
import type { Instant } from "@/lib/time"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"
import { AgentAvatar, UnassignedAvatar, type AgentAvatars } from "@/components/ui/agent-avatar"
import { BoardItemHandle } from "@/components/ui/board-transfer"
import { agentBadgeLabels, agentSummary } from "@/components/ui/agent-badge"
import { BoardCard, useBoardCardStop } from "@/components/ui/board-navigation"
import type { AgentApproval, BoardMode } from "@/components/ui/agent-task-board-primitive"
import { agentTaskBoardLabels, type AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { ProposalActions } from "@/components/ui/proposal-actions"
import { RelativeTime } from "@/components/ui/relative-time"
import type { Stage } from "@/components/ui/stage-track"
import { TaskCardChips } from "@/components/ui/task-card-chips"
import { TaskStatusIcon, taskStatusLabels } from "@/components/ui/task-status"
import { PullRequestLink } from "@/components/ui/task-links"
import { useCardTabStops } from "@/components/ui/use-card-tab-stops"

interface TaskDisplayOptions {
  mode?: BoardMode
  /** One `useNow()` per board, passed down. */
  now?: Instant
  locale?: string
  timeZone?: string
  formatCurrency?: (usd: number) => string
  labels?: AgentTaskBoardLabels
  onApproveProposal?: (id: string) => void | Promise<void>
  onRejectProposal?: (id: string) => void | Promise<void>
  agentApproval?: AgentApproval
  /** Makes each dependency chip a button; only dependencies for which `canSelect` is true are pressable. */
  onSelectTask?: (id: string) => void
  canSelect?: (id: string) => boolean
  /** Images, icons or names per provider id; initials on a provider color otherwise. */
  agentAvatars?: AgentAvatars
  /** Tone of each status's icon; `taskStatusAccentTones` by default. */
  statusTones?: Partial<Record<TaskStatus, Tone>>
  /** Takes over a link's click; without it, links navigate to their `href`. */
  onOpenLink?: (link: TaskLink, task: TaskView) => void
  /** The pipeline a task's `location` points into. */
  stages?: readonly Stage[]
}

type TaskCardProps = Omit<ComponentProps<"article">, "children" | "onSelect"> &
  TaskDisplayOptions & {
    task: TaskView
    selected?: boolean
    /** The host's controls at the end of the card, after Approve/Reject, in every mode. */
    renderActions?: (task: TaskView) => ReactNode
    /** Shows a drag handle; the card must sit in a `BoardItem` of a board that moves cards. */
    movable?: boolean
  }

function proposalError(error: unknown, labels: AgentTaskBoardLabels) {
  return (error instanceof Error && error.message) || labels.errors.unknown
}

function TaskCardComponent({
  task,
  selected = false,
  mode = "snapshot",
  now,
  locale,
  timeZone,
  formatCurrency,
  labels = agentTaskBoardLabels,
  onApproveProposal,
  onRejectProposal,
  agentApproval,
  onSelectTask,
  canSelect,
  agentAvatars,
  statusTones,
  onOpenLink,
  stages,
  renderActions,
  movable = false,
  className,
  ref,
  ...props
}: TaskCardProps) {
  const article = useRef<HTMLElement>(null)
  const setArticle = useCallback(
    (node: HTMLElement | null) => {
      article.current = node
      if (typeof ref === "function") return ref(node)
      if (ref) ref.current = node
      return undefined
    },
    [ref],
  )
  useCardTabStops(article, "[data-task-select]", useBoardCardStop(task.id))
  const text = labels.card
  const parts = labels.components
  const attempt = activeAttempt(task)
  const agent = attempt && effectiveAgent(attempt)
  const agentName = agent && agentSummary(agent, attempt.configured, { ...agentBadgeLabels, ...parts.agentBadge })
  const attempts = attemptCount(task)
  const pullRequest = task.links?.find((link) => link.kind === "pull-request")
  const actions = renderActions?.(task)

  return (
    <article
      data-slot="task-card"
      data-task-id={task.id}
      data-status={task.status}
      data-selected={selected ? "" : undefined}
      ref={setArticle}
      className={cn(
        "relative flex flex-col gap-inline rounded-lg border bg-card/(--glass-opacity) px-inset-item py-inset-item text-sm text-card-foreground backdrop-surface hover:border-ring data-selected:border-primary data-selected:ring-1 data-selected:ring-primary",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-inline">
        {movable && <BoardItemHandle label={task.title} labels={labels.moves} className="size-6" />}
        <span data-slot="task-card-id" className="font-mono text-xs text-muted-foreground">
          {task.id}
        </span>
        {pullRequest && (
          <PullRequestLink
            link={pullRequest}
            label={text.openPullRequest(pullRequest.label)}
            onOpenLink={onOpenLink && ((link) => onOpenLink(link, task))}
            className="relative z-10 ms-auto"
          />
        )}
        {agent ? (
          <AgentAvatar
            agent={agent}
            avatars={agentAvatars}
            label={agentName}
            title={agentName}
            data-differs={agentDiffers(attempt) ? "" : undefined}
            className={cn("relative z-10", !pullRequest && "ms-auto")}
          />
        ) : (
          <UnassignedAvatar className={cn(!pullRequest && "ms-auto")} />
        )}
      </div>
      <div className="flex min-w-0 items-start gap-inline">
        <TaskStatusIcon
          status={task.status}
          tone={statusTones?.[task.status]}
          label={parts.taskStatus?.[task.status] ?? taskStatusLabels[task.status]}
          className="relative z-10 h-lh"
        />
        <BoardCard
          id={task.id}
          render={
            <Button
              data-task-select=""
              data-task-id={task.id}
              aria-label={text.open(task.id, task.title)}
              aria-current={selected ? "true" : undefined}
              title={task.title}
              onClick={() => onSelectTask?.(task.id)}
              className="min-w-0 cursor-pointer text-start leading-snug font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              <span className="line-clamp-2">{task.title}</span>
            </Button>
          }
        />
      </div>
      <TaskCardChips
        task={task}
        labels={labels}
        now={now}
        locale={locale}
        timeZone={timeZone}
        formatCurrency={formatCurrency}
        onSelectTask={onSelectTask}
        canSelect={canSelect}
        stages={stages}
      />
      <div data-slot="task-card-footer" className="flex items-center gap-items text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {text.updated}{" "}
          <RelativeTime value={task.updatedAt} now={now} locale={locale} timeZone={timeZone} formatStyle="short" />
        </span>
        {attempts > 0 && <span className="ms-auto shrink-0">{text.attempts(attempts)}</span>}
      </div>
      {task.status === "proposed" && (
        <ProposalActions
          taskId={task.id}
          mode={mode}
          onApprove={onApproveProposal}
          onReject={onRejectProposal}
          agentApproval={agentApproval}
          labels={labels.proposals}
          renderError={(error) => proposalError(error, labels)}
          className="relative z-10"
        />
      )}
      {actions != null && actions !== false && (
        <div data-slot="task-card-actions" className="relative z-10 flex flex-wrap items-center gap-inline">
          {actions}
        </div>
      )}
    </article>
  )
}

const TaskCard = memo(TaskCardComponent)

export { TaskCard, proposalError }
export type { TaskCardProps, TaskDisplayOptions }
