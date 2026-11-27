"use client"

import { mergeProps } from "@ui-sdk/react/primitive"
import { useState, type ComponentProps, type ReactNode } from "react"
import { XIcon } from "lucide-react"

import type { TaskView } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { agentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Dialog, DialogBackdrop, DialogBody, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerBackdrop, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { TaskDetailContent, type TaskDetailContentProps } from "@/components/ui/task-detail-content"
import type { CloseReason } from "@/components/ui/task-detail-panel"

type TaskDetailDialogProps = Omit<TaskDetailContentProps, "task" | "headingLevel" | "layout" | "showStatus"> & {
  /** The task to show; `undefined` closes the dialog. */
  task: TaskView | undefined
  presentation?: "dialog" | "drawer"
  /** Runs when a person or an agent closes it; clear the task to close it, or keep it to refuse. */
  onClose: (reason: CloseReason | "imperative") => void
  /** Where focus goes once it closes; the element focused before it opened by default. */
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
  /** Under the title, inside the fixed header: a stats strip, a git line. */
  renderHeader?: (task: TaskView) => ReactNode
  /** In the scrolling body, before the task's sections: a changes section. */
  renderBeforeBody?: (task: TaskView) => ReactNode
  /** In the scrolling body, after the task's sections. */
  renderAfterBody?: (task: TaskView) => ReactNode
  className?: string
}

const parts = {
  dialog: {
    Root: Dialog,
    Backdrop: DialogBackdrop,
    Content: DialogContent,
    Title: DialogTitle,
    Close: DialogClose,
    Body: DialogBody,
  },
  drawer: {
    Root: Drawer,
    Backdrop: DrawerBackdrop,
    Content: DrawerContent,
    Title: DrawerTitle,
    Close: DrawerClose,
    Body: DrawerBody,
  },
}

function DrawerBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <ScrollArea className="flex min-h-0 flex-1 flex-col">
      <ScrollAreaViewport
        render={(viewport) => (
          <div
            {...mergeProps(viewport, props)}
            className={cn(viewport.className, "flex h-auto min-h-0 flex-1 flex-col overscroll-contain", className)}
          />
        )}
      />
      <ScrollAreaScrollbar data-agent-hidden="" />
    </ScrollArea>
  )
}

const shapes = {
  dialog: "gap-0 overflow-hidden p-0",
  drawer: "gap-0 overflow-hidden p-0 data-[side=right]:max-w-xl",
}

function closeReason(reason: string): CloseReason | "imperative" {
  return reason === "close-press" || reason === "escape-key" || reason === "outside-press" ? reason : "imperative"
}

function TaskDetailDialog({
  task,
  presentation = "dialog",
  onClose,
  finalFocus,
  renderHeader,
  renderBeforeBody,
  renderAfterBody,
  className,
  labels = agentTaskBoardLabels,
  ...content
}: TaskDetailDialogProps) {
  // Keeps the last task on screen while the dialog animates out.
  const [shown, setShown] = useState(task)
  if (task && task !== shown) setShown(task)
  const current = task ?? shown
  const { Root, Backdrop, Content, Title, Close, Body } = parts[presentation]

  return (
    <Root
      open={task !== undefined}
      onOpenChange={(open, details) => {
        if (!open) onClose(closeReason(details.reason))
      }}
      {...(presentation === "drawer" ? { side: "right" as const } : {})}
    >
      <Backdrop />
      <Content
        data-task-detail={presentation}
        data-dialog-flush=""
        data-task-id={current?.id}
        initialFocus="content"
        finalFocus={finalFocus}
        {...(presentation === "dialog" ? { size: "xl" as const } : {})}
        className={cn("flex flex-col", shapes[presentation], className)}
      >
        {current && (
          <>
            <div
              data-slot="task-detail-header"
              className="flex shrink-0 flex-col gap-items border-b px-inset-surface py-group"
            >
              <div className="flex items-start gap-items">
                <Title data-slot="task-detail-title" className="min-w-0 flex-1 text-title-sm leading-snug">
                  <span className="font-mono text-muted-foreground">{current.id}</span> {current.title}
                </Title>
                <Close variant="ghost" size="icon" aria-label={labels.panel.close}>
                  <XIcon />
                </Close>
              </div>
              {renderHeader?.(current)}
            </div>
            <Body className="@container/task-detail gap-section p-inset-surface in-data-dialog-flush:px-inset-surface">
              {renderBeforeBody?.(current)}
              <TaskDetailContent
                task={current}
                labels={labels}
                {...content}
                layout={presentation === "dialog" ? "split" : "stack"}
                headingLevel={3}
              />
              {renderAfterBody?.(current)}
            </Body>
          </>
        )}
      </Content>
    </Root>
  )
}

export { TaskDetailDialog }
export type { TaskDetailDialogProps }
