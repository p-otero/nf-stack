"use client"

import { useId, type ComponentProps, type KeyboardEvent } from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { agentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { TaskDetailContent, TaskDetailMeta, type TaskDetailContentProps } from "@/components/ui/task-detail-content"
import { insidePopup } from "@/components/ui/task-detail-parts"

type CloseReason = "close-press" | "escape-key" | "outside-press"

type TaskDetailPanelProps = Omit<ComponentProps<"section">, "children"> &
  Omit<TaskDetailContentProps, "headingLevel" | "layout" | "showStatus"> & {
    onClose?: (reason: CloseReason) => void
    /** Heading level of the task title; sections inside take the next one. */
    headingLevel?: 2 | 3 | 4 | 5
  }

function TaskDetailPanel({
  task,
  mode,
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
  onClose,
  renderThreadLink,
  onOpenThread,
  renderLink,
  onOpenLink,
  renderAttachments,
  renderLocation,
  agentAvatars,
  statusTones,
  headingLevel = 2,
  className,
  onKeyDown,
  ...props
}: TaskDetailPanelProps) {
  const titleId = useId()
  const Title = `h${headingLevel}` as const
  const content = {
    task,
    mode,
    now,
    locale,
    timeZone,
    formatCurrency,
    labels,
    onApproveProposal,
    onRejectProposal,
    agentApproval,
    onSelectTask,
    canSelect,
    renderThreadLink,
    onOpenThread,
    renderLink,
    onOpenLink,
    renderAttachments,
    renderLocation,
    agentAvatars,
    statusTones,
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    onKeyDown?.(event)
    if (event.key !== "Escape" || event.defaultPrevented || !onClose) return
    if (insidePopup(event.target, event.currentTarget)) return
    event.preventDefault()
    onClose("escape-key")
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape anywhere inside the non-modal panel closes it, as it would a dialog
    <section
      data-slot="task-detail-panel"
      data-task-id={task.id}
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      className={cn(
        "@container/task-detail flex flex-col overflow-hidden rounded-surface border bg-popover/(--glass-opacity) text-popover-foreground shadow-surface backdrop-surface",
        className,
      )}
      {...props}
    >
      <ScrollArea className="flex min-h-0 flex-1 flex-col">
        <ScrollAreaViewport className="flex h-auto min-h-0 flex-1 flex-col gap-surface overscroll-contain p-inset-surface">
          <header className="flex items-start gap-items">
            <div className="flex min-w-0 flex-1 flex-col gap-inline">
              <TaskDetailMeta task={task} labels={labels} />
              <Title
                id={titleId}
                data-slot="task-detail-title"
                tabIndex={-1}
                className="text-title-sm focus:outline-none"
              >
                {task.title}
              </Title>
            </div>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={labels.panel.close}
                onClick={() => onClose("close-press")}
              >
                <XIcon />
              </Button>
            )}
          </header>
          <TaskDetailContent {...content} showStatus={false} headingLevel={headingLevel + 1} />
        </ScrollAreaViewport>
        <ScrollAreaScrollbar data-agent-hidden="" />
      </ScrollArea>
    </section>
  )
}

export { TaskDetailPanel }
export type { CloseReason, TaskDetailPanelProps }
