"use client"

import {
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@ui-sdk/react/timeline"
import type { ReactNode } from "react"

import { AttemptStatusPill } from "@/components/ui/task-status"
import type { AgentRef, AttemptStatus, AttemptView } from "@/lib/agent-task-types"
import type { Instant } from "@/lib/time"
import { cn } from "@/lib/utils"
import {
  AttemptBlocker,
  AttemptChecks,
  AttemptCommits,
  AttemptRoute,
  AttemptThread,
  type ThreadRendering,
} from "@/components/ui/attempt-details"
import type { AgentAvatars } from "@/components/ui/agent-avatar"
import type { AttemptTimelineLabels } from "@/components/ui/attempt-timeline-labels"
import { Collapsible, CollapsibleIcon, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { RelativeTime } from "@/components/ui/relative-time"
import { UsageTable, type UsageLabels } from "@/components/ui/usage"

const markerColor: Record<AttemptStatus, string> = {
  dispatching: "border-info bg-background",
  active: "border-info bg-info",
  succeeded: "border-success bg-success",
  failed: "border-destructive bg-destructive",
  cancelled: "border-muted-foreground bg-background",
  superseded: "border-muted-foreground bg-muted-foreground",
  unknown: "border-dashed border-muted-foreground bg-background",
}

interface AttemptEventOptions extends ThreadRendering {
  labels: AttemptTimelineLabels
  usageLabels?: Partial<UsageLabels>
  formatCurrency?: (usd: number) => string
  formatAttemptId: (id: string) => string
  renderStatus?: (attempt: AttemptView) => ReactNode
  renderAgent?: (agent: AgentRef, requested: boolean) => ReactNode
  /** Images, icons or names per provider for the default agent badges. */
  agentAvatars?: AgentAvatars
  now: Instant
  locale?: string
  timeZone?: string
  usageOpen: boolean
}

// The usage toggle sits in the title row and its table at the end, so one Collapsible spans the whole column.
function AttemptColumn({
  collapsible,
  defaultOpen,
  children,
}: {
  collapsible: boolean
  defaultOpen: boolean
  children: ReactNode
}) {
  const className = "flex min-w-0 flex-1 flex-col gap-items"
  return collapsible ? (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      {children}
    </Collapsible>
  ) : (
    <div className={className}>{children}</div>
  )
}

function AttemptEvent({ attempt, ...options }: AttemptEventOptions & { attempt: AttemptView }) {
  const { labels, formatAttemptId, now, locale, timeZone } = options
  const name = formatAttemptId(attempt.id)
  const kind = labels.kind[attempt.kind] ?? attempt.kind
  const threads = { renderThreadLink: options.renderThreadLink, onOpenThread: options.onOpenThread }
  const forked = attempt.contextMode === "reuse" || attempt.contextMode === "fork"
  const live = attempt.status === "active" || attempt.status === "dispatching"
  const time = { now, locale, timeZone }

  return (
    <TimelineItem
      value={attempt.id}
      status={live ? "current" : undefined}
      data-attempt-status={attempt.status}
      className="group/attempt relative flex gap-items rounded-control pb-group outline-none data-last:pb-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* oxlint-disable-next-line p-otero/spacing-tokens -- centres the size-3 marker on the first 20px line */}
      <TimelineMarker className={cn("mt-1 size-3 shrink-0 rounded-full border-2", markerColor[attempt.status])} />
      {/* oxlint-disable-next-line p-otero/spacing-tokens -- geometry: runs from under the size-3 marker, centred on it, to the next one */}
      <TimelineConnector className="absolute start-1.25 top-5 bottom-1 w-0.5 bg-border group-data-last/attempt:hidden" />
      <AttemptColumn collapsible={attempt.usage !== undefined} defaultOpen={options.usageOpen}>
        <div className="flex flex-wrap items-center gap-inline">
          <TimelineTitle className="text-sm font-semibold">
            {name} · {kind}
          </TimelineTitle>
          {options.renderStatus ? (
            options.renderStatus(attempt)
          ) : (
            <AttemptStatusPill status={attempt.status} labels={labels.status} />
          )}
          {attempt.usage && (
            <CollapsibleTrigger
              aria-label={labels.usageFor(name)}
              className="ms-auto h-control-sm min-h-0 px-inline text-xs"
            >
              <span>{labels.usage}</span>
              <CollapsibleIcon />
            </CollapsibleTrigger>
          )}
        </div>
        <TimelineTime render={<div />} className="flex flex-wrap gap-x-items text-xs text-muted-foreground">
          <span>
            {labels.started} <RelativeTime value={attempt.startedAt} {...time} />
          </span>
          {attempt.endedAt && (
            <span>
              {labels.ended} <RelativeTime value={attempt.endedAt} {...time} />
            </span>
          )}
        </TimelineTime>
        <TimelineDescription className="flex flex-col gap-inline text-sm">
          <AttemptRoute
            attempt={attempt}
            attemptName={name}
            labels={labels}
            renderAgent={options.renderAgent}
            avatars={options.agentAvatars}
          />
          {(attempt.contextMode || attempt.repairOf) && (
            <span className="flex flex-wrap gap-x-inline text-xs text-muted-foreground">
              {attempt.contextMode && (
                <span data-slot="attempt-context" data-mode={attempt.contextMode}>
                  {labels.context[attempt.contextMode]}
                  {forked && attempt.sourceThread && (
                    <>
                      {" "}
                      {labels.from}{" "}
                      <AttemptThread
                        thread={attempt.sourceThread}
                        label={labels.openSourceThread}
                        text={labels.thread}
                        inline
                        {...threads}
                      />
                    </>
                  )}
                </span>
              )}
              {attempt.repairOf && (
                <span data-slot="attempt-repair">{labels.repairs(formatAttemptId(attempt.repairOf))}</span>
              )}
            </span>
          )}
          {attempt.reason && <span data-slot="attempt-reason">{attempt.reason}</span>}
        </TimelineDescription>
        {attempt.checks && attempt.checks.length > 0 && <AttemptChecks checks={attempt.checks} labels={labels} />}
        {attempt.commits && attempt.commits.length > 0 && <AttemptCommits commits={attempt.commits} labels={labels} />}
        {attempt.blocker && (
          <AttemptBlocker blocker={attempt.blocker} labels={labels} locale={locale} timeZone={timeZone} />
        )}
        {attempt.thread &&
          (options.renderThreadLink || attempt.thread.href || options.onOpenThread ? (
            <AttemptThread thread={attempt.thread} label={labels.openThread} text={labels.threadLink} {...threads} />
          ) : (
            attempt.thread.title && (
              <span className="flex flex-wrap items-center gap-x-inline text-sm">
                <span className="text-muted-foreground">{labels.thread}:</span>
                <AttemptThread thread={attempt.thread} label={labels.openThread} text={labels.threadLink} />
              </span>
            )
          ))}
        {attempt.usage && (
          <CollapsiblePanel>
            <UsageTable
              usage={attempt.usage}
              aria-label={labels.usageTable(name)}
              labels={options.usageLabels}
              locale={locale}
              formatCurrency={options.formatCurrency}
            />
          </CollapsiblePanel>
        )}
      </AttemptColumn>
    </TimelineItem>
  )
}

export { AttemptEvent }
export type { AttemptEventOptions }
