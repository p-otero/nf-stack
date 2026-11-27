import type { ComponentProps, ReactNode } from "react"

import type { TaskStatus } from "@/lib/agent-task-types"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

/** What each status means, shared by the board's column accents and the status icons. */
const taskStatusAccentTones: Record<TaskStatus, Tone> = {
  proposed: "neutral",
  todo: "neutral",
  working: "info",
  review: "warning",
  blocked: "destructive",
  done: "success",
  cancelled: "neutral",
}

const toneIconColor: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  violet: "text-violet",
}

const statusIconShape: Record<TaskStatus, ReactNode> = {
  proposed: <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.3" />,
  todo: <circle cx="8" cy="8" r="6" />,
  working: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" stroke="none" />
    </>
  ),
  review: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5a3.5 3.5 0 1 1-3.5 3.5H8Z" fill="currentColor" stroke="none" />
    </>
  ),
  blocked: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="M5.25 8h5.5" className="stroke-background" />
    </>
  ),
  done: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
      <path d="m5.25 8.1 1.8 1.8 3.7-3.7" className="stroke-background" />
    </>
  ),
  cancelled: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m4 12 8-8" />
    </>
  ),
}

type TaskStatusIconProps = Omit<ComponentProps<"svg">, "children"> & {
  status: TaskStatus
  /** Names the icon when no status text is beside it; without it, it is decorative. */
  label?: string
  /** Overrides the status's tone, as a board's `columnTones` does. */
  tone?: Tone
}

function TaskStatusIcon({ status, label, tone, className, ...props }: TaskStatusIconProps) {
  return (
    // oxlint-disable-next-line eskais/no-inline-icons -- status rings on a 16px grid, filled and cut out per status; no icon set has them
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-slot="task-status-icon"
      data-status={status}
      data-tone={tone ?? taskStatusAccentTones[status]}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("size-3.5 shrink-0", toneIconColor[tone ?? taskStatusAccentTones[status]], className)}
      {...props}
    >
      {statusIconShape[status]}
    </svg>
  )
}

export { TaskStatusIcon, taskStatusAccentTones }
export type { TaskStatusIconProps }
