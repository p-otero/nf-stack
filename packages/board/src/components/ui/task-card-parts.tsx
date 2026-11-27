import { EyeIcon, TriangleExclamationPointIcon, ZapIcon } from "lucide-react"

import type { AttemptView, TaskView } from "@/lib/agent-task-types"
import type { Instant } from "@/lib/time"
import { RelativeTime } from "@/components/ui/relative-time"

function AnalysisModeIcon({ mode, label }: { mode: NonNullable<TaskView["analysisMode"]>; label: string }) {
  return (
    <span data-slot="task-card-analysis" data-mode={mode} title={label} className="relative z-10 text-muted-foreground">
      {mode === "review" ? <EyeIcon className="size-4" /> : <ZapIcon className="size-4" />}
      <span className="sr-only">{label}</span>
    </span>
  )
}

type TaskBlockerProps = {
  blocker: NonNullable<AttemptView["blocker"]>
  retryLabel: string
  now?: Instant
  locale?: string
  timeZone?: string
}

function TaskBlocker({ blocker, retryLabel, ...time }: TaskBlockerProps) {
  return (
    <p
      data-slot="task-card-blocker"
      className="relative z-10 flex max-w-full min-w-0 items-start gap-inline rounded-md border border-destructive/40 px-inset-chip py-inset-chip text-xs text-destructive"
    >
      <TriangleExclamationPointIcon className="h-lh w-3 shrink-0" />
      <span className="min-w-0">
        {blocker.summary}
        {blocker.retryAt && (
          <span className="text-muted-foreground">
            {" · "}
            {retryLabel} <RelativeTime value={blocker.retryAt} {...time} />
          </span>
        )}
      </span>
    </p>
  )
}

export { AnalysisModeIcon, TaskBlocker }
