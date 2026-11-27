"use client"

import { createElement, type ComponentProps, type MouseEvent, type ReactNode } from "react"
import {
  CircleDotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react"

import type { TaskLink } from "@/lib/agent-task-types"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"

type LinkKind = TaskLink["kind"]
type LinkState = NonNullable<TaskLink["state"]>

const taskLinkStateTones: Record<LinkState, Tone> = {
  draft: "neutral",
  open: "info",
  merged: "success",
  closed: "destructive",
}

const kindIcons: Record<LinkKind, LucideIcon> = {
  "pull-request": GitPullRequestIcon,
  branch: GitBranchIcon,
  commit: GitCommitHorizontalIcon,
  issue: CircleDotIcon,
  external: ExternalLinkIcon,
}

function TaskLinkIcon({ kind, className, ...props }: LucideProps & { kind: LinkKind }) {
  const Icon = kindIcons[kind]
  return <Icon data-slot="task-link-icon" data-kind={kind} className={cn("size-4 shrink-0", className)} {...props} />
}

interface TaskLinkLabels {
  kind: Record<LinkKind, string>
  state: Record<LinkState, string>
}

const taskLinkLabels: TaskLinkLabels = {
  kind: { "pull-request": "Pull request", branch: "Branch", commit: "Commit", issue: "Issue", external: "Link" },
  state: { draft: "Draft", open: "Open", merged: "Merged", closed: "Closed" },
}

/** A handler takes over the click, as `onOpenThread` does; without one the link navigates. */
function openWith(link: TaskLink, onOpenLink?: (link: TaskLink) => void) {
  if (!onOpenLink) return undefined
  return (event: MouseEvent) => {
    event.preventDefault()
    onOpenLink(link)
  }
}

type TaskLinksProps = Omit<ComponentProps<"ul">, "children"> & {
  links: readonly TaskLink[]
  labels?: Partial<TaskLinkLabels>
  renderLink?: (link: TaskLink) => ReactNode
  onOpenLink?: (link: TaskLink) => void
}

function TaskLinks({ links, labels, renderLink, onOpenLink, className, ...props }: TaskLinksProps) {
  const text = { ...taskLinkLabels, ...labels }
  return (
    <ul data-slot="task-links" className={cn("flex min-w-0 flex-col gap-inline", className)} {...props}>
      {links.map((link) => (
        <li
          key={`${link.kind} ${link.href}`}
          data-slot="task-link"
          data-kind={link.kind}
          data-state={link.state}
          className="flex min-w-0 items-center gap-inline"
        >
          {renderLink ? (
            renderLink(link)
          ) : (
            <Button
              variant="link"
              size="sm"
              render={createElement("a", { href: link.href, "data-slot": "task-card-pull-request" })}
              title={`${text.kind[link.kind]}: ${link.href}`}
              onClick={openWith(link, onOpenLink)}
              className="h-auto min-w-0 justify-start px-0 py-inline text-start whitespace-normal wrap-anywhere"
            >
              <TaskLinkIcon kind={link.kind} className="text-muted-foreground" />
              <span className="min-w-0">{link.label}</span>
            </Button>
          )}
          {link.state && (
            <StatusPill tone={taskLinkStateTones[link.state]} className="ms-auto">
              {text.state[link.state]}
            </StatusPill>
          )}
        </li>
      ))}
    </ul>
  )
}

type PullRequestLinkProps = {
  link: TaskLink
  label: string
  onOpenLink?: (link: TaskLink) => void
  className?: string
}

function PullRequestLink({ link, label, onOpenLink, className }: PullRequestLinkProps) {
  return (
    <Button
      data-state={link.state}
      variant="ghost"
      size="icon"
      render={createElement("a", { href: link.href })}
      aria-label={label}
      tooltip={link.label}
      onClick={openWith(link, onOpenLink)}
      className={cn("size-6 text-muted-foreground [&_svg]:size-3.5", className)}
    >
      <TaskLinkIcon kind="pull-request" />
    </Button>
  )
}

export { PullRequestLink, TaskLinkIcon, TaskLinks, taskLinkLabels, taskLinkStateTones }
export type { PullRequestLinkProps, TaskLinkLabels, TaskLinksProps }
