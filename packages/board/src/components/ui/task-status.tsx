import type { ReactNode } from "react"

import type { AttemptStatus, ContextMode, TaskStatus, ThreadRef } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { StatusPill, type StatusPillProps, type StatusTone } from "@/components/ui/status-pill"
import { TaskStatusIcon, taskStatusAccentTones, type TaskStatusIconProps } from "@/components/ui/task-status-icon"

const taskStatusTones: Record<TaskStatus, StatusTone> = {
  proposed: "warning",
  todo: "neutral",
  working: "info",
  review: "warning",
  blocked: "destructive",
  done: "success",
  cancelled: "muted",
}

const taskStatusLabels: Record<TaskStatus, string> = {
  proposed: "Proposed",
  todo: "To do",
  working: "Working",
  review: "In review",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
}

const taskStatusLabelsEs: Record<TaskStatus, string> = {
  proposed: "Propuesta",
  todo: "Pendiente",
  working: "En curso",
  review: "En revisión",
  blocked: "Bloqueada",
  done: "Hecha",
  cancelled: "Cancelada",
}

const attemptStatusTones: Record<AttemptStatus, StatusTone> = {
  dispatching: "neutral",
  active: "info",
  succeeded: "success",
  failed: "destructive",
  cancelled: "muted",
  superseded: "muted",
  unknown: "muted",
}

const attemptStatusLabels: Record<AttemptStatus, string> = {
  dispatching: "Dispatching",
  active: "Active",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  superseded: "Superseded",
  unknown: "Unknown",
}

const attemptStatusLabelsEs: Record<AttemptStatus, string> = {
  dispatching: "Enviando",
  active: "Activo",
  succeeded: "Correcto",
  failed: "Fallido",
  cancelled: "Cancelado",
  superseded: "Sustituido",
  unknown: "Desconocido",
}

const contextModeTones: Record<ContextMode, StatusTone> = {
  fresh: "neutral",
  reuse: "info",
  fork: "info",
  compact: "neutral",
}

type ContextModeLabels = Record<ContextMode, string> & {
  /** Precedes the source thread, as in "Fork from Index docs". */
  from: string
}

const contextModeLabels: ContextModeLabels = {
  fresh: "Fresh context",
  reuse: "Reused context",
  fork: "Forked context",
  compact: "Compacted context",
  from: "from",
}

const contextModeLabelsEs: ContextModeLabels = {
  fresh: "Contexto nuevo",
  reuse: "Contexto reutilizado",
  fork: "Contexto bifurcado",
  compact: "Contexto compactado",
  from: "de",
}

type PillProps<Status extends string> = Omit<StatusPillProps, "tone" | "children"> & {
  status: Status
  labels?: Partial<Record<Status, string>>
}

function TaskStatusPill({ status, labels, ...props }: PillProps<TaskStatus>) {
  return (
    <StatusPill data-status={status} tone={taskStatusTones[status]} {...props}>
      {labels?.[status] ?? taskStatusLabels[status]}
    </StatusPill>
  )
}

function AttemptStatusPill({ status, labels, ...props }: PillProps<AttemptStatus>) {
  return (
    <StatusPill data-status={status} tone={attemptStatusTones[status]} {...props}>
      {labels?.[status] ?? attemptStatusLabels[status]}
    </StatusPill>
  )
}

type ContextModePillProps = Omit<StatusPillProps, "tone" | "children"> & {
  mode: ContextMode
  /** Shown for "reuse" and "fork". */
  sourceThread?: ThreadRef
  renderThreadLink?: (thread: ThreadRef) => ReactNode
  labels?: Partial<ContextModeLabels>
}

function ContextModePill({
  mode,
  sourceThread,
  renderThreadLink,
  labels: labelOverrides,
  className,
  ...props
}: ContextModePillProps) {
  const labels = { ...contextModeLabels, ...labelOverrides }
  const source = (mode === "reuse" || mode === "fork") && sourceThread
  const pill = (
    <StatusPill data-mode={mode} tone={contextModeTones[mode]} className={source ? undefined : className} {...props}>
      {labels[mode]}
    </StatusPill>
  )
  if (!source) return pill
  return (
    <span
      data-slot="context-mode"
      className={cn("inline-flex max-w-full min-w-0 items-center gap-inline text-xs", className)}
    >
      {pill}
      <span data-slot="context-mode-source" className="flex min-w-0 gap-inline text-muted-foreground">
        <span className="shrink-0">{labels.from}</span>
        <span className="min-w-0 truncate text-foreground" title={sourceThread.title ?? sourceThread.id}>
          {renderThreadLink ? renderThreadLink(sourceThread) : (sourceThread.title ?? sourceThread.id)}
        </span>
      </span>
    </span>
  )
}

export {
  AttemptStatusPill,
  ContextModePill,
  TaskStatusIcon,
  TaskStatusPill,
  attemptStatusLabels,
  attemptStatusLabelsEs,
  attemptStatusTones,
  contextModeLabels,
  contextModeLabelsEs,
  contextModeTones,
  taskStatusLabels,
  taskStatusAccentTones,
  taskStatusLabelsEs,
  taskStatusTones,
}
export type { ContextModeLabels, ContextModePillProps, TaskStatusIconProps }
