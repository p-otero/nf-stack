"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import type { Liveness } from "@/lib/agent-task-types"
import type { Instant } from "@/lib/time"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill, type StatusTone } from "@/components/ui/status-pill"

type LivenessLabels = Record<Liveness, string> & {
  /** Precedes the time since the last activity, as in "last activity 47 minutes ago". */
  lastActivity: string
}

const livenessLabels: LivenessLabels = {
  running: "Running",
  idle: "Idle",
  waiting_input: "Waiting for input",
  suspect_dead: "Possibly stuck",
  finished: "Finished",
  lastActivity: "last activity",
}

const livenessLabelsEs: LivenessLabels = {
  running: "En marcha",
  idle: "Inactivo",
  waiting_input: "Esperando respuesta",
  suspect_dead: "Posiblemente colgado",
  finished: "Terminado",
  lastActivity: "última actividad",
}

const livenessTones: Record<Liveness, StatusTone> = {
  running: "info",
  idle: "muted",
  waiting_input: "warning",
  suspect_dead: "destructive",
  finished: "neutral",
}

type LivenessIndicatorProps = Omit<PartProps<"span">, "children"> & {
  /** Computed by the data source; never derived here from times. */
  liveness: Liveness
  lastActivityAt?: Instant
  /** One `useNow()` per screen, passed down. */
  now?: Instant
  locale?: string
  timeZone?: string
  labels?: Partial<LivenessLabels>
}

function LivenessIndicator({
  liveness,
  lastActivityAt,
  now,
  locale,
  timeZone,
  labels: labelOverrides,
  className,
  render,
  ...props
}: LivenessIndicatorProps) {
  const labels = { ...livenessLabels, ...labelOverrides }
  return renderElement(
    "span",
    {
      "data-slot": "liveness",
      "data-liveness": liveness,
      className: cn("inline-flex max-w-full flex-wrap items-center gap-inline text-xs", className),
      ...props,
      children: (
        <>
          <StatusPill tone={livenessTones[liveness]} dot pulse={liveness === "running"}>
            {labels[liveness]}
          </StatusPill>
          {lastActivityAt !== undefined && (
            <span data-slot="liveness-activity" className="whitespace-nowrap text-muted-foreground">
              {labels.lastActivity}{" "}
              <RelativeTime value={lastActivityAt} now={now} locale={locale} timeZone={timeZone} />
            </span>
          )}
        </>
      ),
    },
    render,
  )
}

export { LivenessIndicator, livenessLabels, livenessLabelsEs, livenessTones }
export type { LivenessIndicatorProps, LivenessLabels }
