"use client"

import { Timeline } from "@ui-sdk/react/timeline"
import { useMemo, type ComponentProps } from "react"

import type { AttemptView } from "@/lib/agent-task-types"
import { toTime, type Instant } from "@/lib/time"
import { cn } from "@/lib/utils"
import { AttemptEvent, type AttemptEventOptions } from "@/components/ui/attempt-event"
import { attemptTimelineLabels, type AttemptTimelineLabels } from "@/components/ui/attempt-timeline-labels"
import { Collapsible, CollapsibleIcon, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useNow } from "@/components/ui/relative-time"

type AttemptTimelineProps = Omit<ComponentProps<typeof Timeline>, "children"> &
  Partial<Omit<AttemptEventOptions, "labels" | "now" | "usageOpen">> & {
    attempts: readonly AttemptView[]
    labels?: Partial<AttemptTimelineLabels>
    /** "Now" for every relative time; one shared clock when left out. */
    now?: Instant
    /** How many of the latest attempts stay visible; older ones collapse behind a toggle. */
    visibleAttempts?: number
    /** Usage tables start collapsed once there are more attempts than this. */
    usageOpenUpTo?: number
  }

// Ids like "T-014-A1" read as "A1" inside their task; anything else is shown whole.
function defaultFormatAttemptId(id: string) {
  return /-(A\d+)$/.exec(id)?.[1] ?? id
}

function AttemptTimeline({
  attempts,
  labels,
  now,
  visibleAttempts = 5,
  usageOpenUpTo = 5,
  formatAttemptId = defaultFormatAttemptId,
  usageLabels,
  formatCurrency,
  renderStatus,
  renderAgent,
  agentAvatars,
  renderThreadLink,
  onOpenThread,
  locale,
  timeZone,
  className,
  ...props
}: AttemptTimelineProps) {
  const text = { ...attemptTimelineLabels, ...labels }
  const current = useNow({ now })
  const ordered = useMemo(
    () =>
      attempts
        .map((attempt, index) => ({ attempt, index }))
        .toSorted((a, b) => toTime(a.attempt.startedAt) - toTime(b.attempt.startedAt) || a.index - b.index)
        .map(({ attempt }) => attempt),
    [attempts],
  )
  const hiddenCount = Math.max(0, ordered.length - Math.max(1, visibleAttempts))
  const options: AttemptEventOptions = {
    labels: text,
    usageLabels,
    formatCurrency,
    formatAttemptId,
    renderStatus,
    renderAgent,
    agentAvatars,
    renderThreadLink,
    onOpenThread,
    now: current,
    locale,
    timeZone,
    usageOpen: ordered.length <= usageOpenUpTo,
  }
  const event = (attempt: AttemptView) => <AttemptEvent key={attempt.id} attempt={attempt} {...options} />

  // The earlier attempts sit in a panel inside the same list, so arrow keys run through every attempt once open.
  const timeline = (
    <Timeline aria-label={text.timeline} className={cn("flex flex-col", className)} {...props}>
      {hiddenCount > 0 && (
        <CollapsiblePanel className="flex flex-col">{ordered.slice(0, hiddenCount).map(event)}</CollapsiblePanel>
      )}
      {ordered.slice(hiddenCount).map(event)}
    </Timeline>
  )

  if (hiddenCount === 0) return <div data-slot="attempt-timeline">{timeline}</div>
  return (
    <Collapsible render={<div data-slot="attempt-timeline" />} className="gap-items">
      <CollapsibleTrigger className="-ms-control-x self-start text-muted-foreground">
        {(state) => (
          <>
            {state.open ? text.hideEarlier(hiddenCount) : text.showEarlier(hiddenCount)}
            <CollapsibleIcon />
          </>
        )}
      </CollapsibleTrigger>
      {timeline}
    </Collapsible>
  )
}

export { AttemptTimeline, defaultFormatAttemptId }
export type { AttemptTimelineProps }
