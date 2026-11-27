"use client"

import { createElement, type ReactNode } from "react"
import { AppWindowIcon } from "lucide-react"

import type { AgentAvatars } from "@/components/ui/agent-avatar"
import { AgentBadge } from "@/components/ui/agent-badge"
import { agentDiffers, effectiveAgent, type AgentRef, type AttemptView, type ThreadRef } from "@/lib/agent-task-types"
import { formatInstant, toISO } from "@/lib/time"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import type { AttemptTimelineLabels, CheckResult } from "@/components/ui/attempt-timeline-labels"

interface ThreadRendering {
  renderThreadLink?: (thread: ThreadRef) => ReactNode
  onOpenThread?: (thread: ThreadRef) => void
}

/**
 * `onOpenThread` gets a button, which agents can press; an `href` alone gets a link, which they can't.
 * A thread with neither shows its title, never its bare id.
 */
function AttemptThread({
  thread,
  label,
  text,
  inline = false,
  renderThreadLink,
  onOpenThread,
}: ThreadRendering & {
  thread: ThreadRef
  label: (name: string) => string
  /** Visible text of the button. */
  text: string
  /** Inside a sentence: a text link with the thread's title instead of a button. */
  inline?: boolean
}) {
  if (renderThreadLink) return renderThreadLink(thread)
  const operable = thread.href !== undefined || onOpenThread !== undefined
  if (!operable) {
    return thread.title ? (
      <span data-slot="attempt-thread" title={thread.id}>
        {thread.title}
      </span>
    ) : null
  }
  return (
    <Button
      variant={inline ? "link" : "outline"}
      size="sm"
      render={
        thread.href && !onOpenThread
          ? createElement("a", { href: thread.href, "data-slot": "attempt-thread" })
          : (part) => <button {...part} data-slot="attempt-thread" />
      }
      aria-label={label(thread.title ?? thread.id)}
      title={thread.id}
      onClick={onOpenThread && (() => onOpenThread(thread))}
      className={inline ? "h-auto max-w-full p-0 whitespace-normal" : "h-control-sm self-start"}
    >
      {inline ? (
        (thread.title ?? text)
      ) : (
        <>
          <AppWindowIcon />
          <span>{text}</span>
        </>
      )}
    </Button>
  )
}

function defaultRenderAgent(agent: AgentRef, requested: boolean, avatars?: AgentAvatars) {
  return (
    <span data-slot="attempt-agent" data-requested={requested || undefined} className="min-w-0">
      <AgentBadge agent={agent} variant="detail" avatars={avatars} />
    </span>
  )
}

interface AttemptRouteProps {
  attempt: AttemptView
  attemptName: string
  labels: AttemptTimelineLabels
  renderAgent?: (agent: AgentRef, requested: boolean) => ReactNode
  /** Used by the default `renderAgent`. */
  avatars?: AgentAvatars
}

function AttemptRoute({ attempt, attemptName, labels, renderAgent: custom, avatars }: AttemptRouteProps) {
  const renderAgent = custom ?? ((agent: AgentRef, requested: boolean) => defaultRenderAgent(agent, requested, avatars))
  const fallbacks = attempt.fallbacks ?? []
  return (
    <div data-slot="attempt-route" className="flex flex-wrap items-center gap-inline">
      {agentDiffers(attempt) && attempt.executed ? (
        <>
          {renderAgent(attempt.configured, true)}
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <span className="sr-only">{labels.ranAs}</span>
          {renderAgent(attempt.executed, false)}
        </>
      ) : (
        renderAgent(effectiveAgent(attempt), false)
      )}
      {fallbacks.length > 0 && (
        <Popover>
          <PopoverTrigger
            variant="ghost"
            size="sm"
            aria-label={labels.earlierRoutesFor(fallbacks.length, attemptName)}
            className="h-auto px-inset-chip py-inset-chip text-xs text-muted-foreground"
          >
            {labels.earlierRoutes(fallbacks.length)}
          </PopoverTrigger>
          <PopoverContent>
            <PopoverTitle>{labels.earlierRoutesTitle}</PopoverTitle>
            <ol className="flex flex-col gap-items text-sm">
              {fallbacks.map(({ agent, reason }) => (
                <li key={`${agent.provider}/${agent.model}/${reason}`} className="flex flex-col gap-inline">
                  {renderAgent(agent, true)}
                  <span className="text-muted-foreground">{reason}</span>
                </li>
              ))}
            </ol>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

const checkColor: Record<CheckResult, string> = {
  pass: "text-success",
  fail: "text-destructive",
  not_run: "text-muted-foreground",
}

function AttemptChecks({
  checks,
  labels,
}: {
  checks: NonNullable<AttemptView["checks"]>
  labels: AttemptTimelineLabels
}) {
  return (
    <ul aria-label={labels.checks} data-slot="attempt-checks" className="flex flex-col gap-items text-sm">
      {checks.map((check) => (
        <li key={check.name} data-result={check.result} className="flex flex-wrap gap-x-inline">
          <span className="font-medium">{check.name}</span>
          <span className={checkColor[check.result]}>{labels.check[check.result]}</span>
          {check.note && <span className="text-muted-foreground">{check.note}</span>}
        </li>
      ))}
    </ul>
  )
}

function AttemptCommits({ commits, labels }: { commits: string[]; labels: AttemptTimelineLabels }) {
  return (
    <ul aria-label={labels.commits} data-slot="attempt-commits" className="flex flex-wrap gap-items">
      {commits.map((sha) => (
        <li key={sha}>
          <code title={sha} className="rounded-sm border bg-muted px-inset-chip font-mono text-xs text-foreground">
            {sha.slice(0, 7)}
          </code>
        </li>
      ))}
    </ul>
  )
}

interface AttemptBlockerProps {
  blocker: NonNullable<AttemptView["blocker"]>
  labels: AttemptTimelineLabels
  locale?: string
  timeZone?: string
  className?: string
}

function AttemptBlocker({ blocker, labels, locale, timeZone, className }: AttemptBlockerProps) {
  return (
    <div
      data-slot="attempt-blocker"
      className={cn(
        "flex flex-col gap-inline rounded-control border border-warning/40 bg-warning/10 px-inset-item py-inset-item text-sm",
        className,
      )}
    >
      <span className="font-medium">
        {labels.blocker}: {blocker.kind}
      </span>
      <span>{blocker.summary}</span>
      {blocker.retryAt && (
        <span className="text-xs">
          {labels.retryAt}{" "}
          <time dateTime={toISO(blocker.retryAt)}>{formatInstant(blocker.retryAt, { locale, timeZone })}</time>
        </span>
      )}
    </div>
  )
}

export { AttemptBlocker, AttemptChecks, AttemptCommits, AttemptRoute, AttemptThread, defaultRenderAgent }
export type { AttemptRouteProps, ThreadRendering }
