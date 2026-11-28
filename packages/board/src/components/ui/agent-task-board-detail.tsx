"use client"

import type { ReactNode, Ref } from "react"

import type { TaskLink, TaskView, ThreadRef } from "@/lib/agent-task-types"
import type { DetailPresentation } from "@/components/ui/agent-task-board-props"
import type { TaskDisplayOptions } from "@/components/ui/task-card"
import { TaskDetailDialog } from "@/components/ui/task-detail-dialog"
import { TaskDetailPanel, type CloseReason } from "@/components/ui/task-detail-panel"

type AgentTaskBoardDetailProps = {
  presentation: DetailPresentation
  header: ReactNode
  children: ReactNode
  bodyRef: Ref<HTMLDivElement>
  selected: TaskView | undefined
  display: TaskDisplayOptions
  onClose: (reason: CloseReason | "imperative") => void
  returnFocus: () => HTMLElement | null
  renderThreadLink?: (thread: ThreadRef) => ReactNode
  onOpenThread?: (thread: ThreadRef) => void
  renderLink?: (link: TaskLink) => ReactNode
  renderAttachments?: (task: TaskView) => ReactNode
  renderLocation?: (task: TaskView) => ReactNode
}

function AgentTaskBoardDetail({
  presentation,
  header,
  children,
  bodyRef,
  selected,
  display,
  onClose,
  returnFocus,
  renderThreadLink,
  onOpenThread,
  renderLink,
  renderAttachments,
  renderLocation,
}: AgentTaskBoardDetailProps) {
  const threads = { renderThreadLink, onOpenThread, renderLink, renderAttachments, renderLocation }
  const boardIsBehindModal = selected !== undefined
  if (presentation !== "side") {
    return (
      <>
        <div data-agent-hidden={boardIsBehindModal ? "" : undefined} className="flex flex-col gap-section">
          {header}
          <div ref={bodyRef}>{children}</div>
        </div>
        <TaskDetailDialog
          task={selected}
          presentation={presentation}
          {...display}
          {...threads}
          onClose={onClose}
          finalFocus={returnFocus}
        />
      </>
    )
  }
  return (
    <>
      {header}
      <div
        ref={bodyRef}
        className="flex flex-col gap-section @4xl/agent-task-board:flex-row @4xl/agent-task-board:items-start"
      >
        <div className="min-w-0 flex-1">{children}</div>
        {selected && (
          <TaskDetailPanel
            key={selected.id}
            task={selected}
            {...display}
            {...threads}
            onClose={onClose}
            className="sticky bottom-0 max-h-(--task-panel-max-height) @4xl/agent-task-board:top-0 @4xl/agent-task-board:bottom-auto @4xl/agent-task-board:w-(--task-panel-width) @4xl/agent-task-board:shrink-0"
          />
        )}
      </div>
    </>
  )
}

export { AgentTaskBoardDetail }
