"use client"

import { TreeItem, TreeItemIndicator, TreeItemLabel } from "@ui-sdk/react/tree"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, CloudUploadIcon, CopyIcon } from "lucide-react"
import { memo, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CommitGraphCell, graphColumns, laneColor, type CommitNodeKind } from "@/components/ui/commit-graph-cell"
import { commitHistoryLabels, formatCount, type CommitHistoryLabels } from "@/components/ui/commit-history-labels"
import { GitBranchChip, GitFileChip } from "@/components/ui/git-chip"
import type { BranchInfo } from "@/lib/commit-branches"
import type { Commit, CommitMessageSegment } from "@/lib/commit-graph"
import type { LaneRow } from "@/lib/commit-lanes"
import { commitSubject, segmentsOf } from "@/lib/commit-message"
import { formatElapsed, formatInstant, formatRelative, toISO, type Instant } from "@/lib/time"
import { cn, cssVars } from "@/lib/utils"

const NONE: readonly BranchInfo[] = []

/** A branch at its head: a dot in its lane's colour, the name, and how far ahead and behind the base it is. */
// A press on it shows only this branch (the row's own press handler reads `data-branch`), so it's a pointer
// shortcut: keyboards and agents reach the same through the branch select and `focusBranch`.
function BranchPill({ branch, locale, focused }: { branch: BranchInfo; locale?: string; focused: boolean }) {
  return (
    <span
      data-slot="commit-branch-pill"
      data-state={branch.state}
      data-branch={branch.state === "base" ? undefined : branch.name}
      data-focused={focused ? "" : undefined}
      className="inline-flex max-w-48 min-w-0 items-center gap-inline rounded-sm bg-foreground/8 px-inline py-px font-mono text-caption leading-none text-muted-foreground data-branch:cursor-pointer data-branch:hover:bg-foreground/15 data-focused:ring-1 data-focused:ring-ring"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full bg-current", laneColor(branch.tag))} />
      <span className="truncate text-foreground">{branch.name}</span>
      {branch.state !== "base" && <BranchCounts ahead={branch.ahead} behind={branch.behind} locale={locale} />}
    </span>
  )
}

type BranchCountsProps = {
  ahead: number
  behind: number
  locale?: string
  /** Says the counts in words for screen readers, where nothing around them already does. */
  spoken?: Pick<CommitHistoryLabels, "ahead" | "behind">
}

/**
 * How far a branch is ahead of and behind the base, as arrows and numbers. A zero side is left out, which reads
 * cleaner than a dimmed 0 and keeps every number shown at full contrast; the spoken text still says both.
 */
function BranchCounts({ ahead, behind, locale, spoken }: BranchCountsProps) {
  return (
    <span
      data-slot="commit-branch-counts"
      className="inline-flex shrink-0 items-center gap-inline text-caption text-muted-foreground tabular-nums"
    >
      <span aria-hidden="true" className="inline-flex items-center gap-inline [&_svg]:size-3 [&_svg]:shrink-0">
        {ahead > 0 && (
          <span className="inline-flex items-center">
            <ArrowUpIcon />
            {formatCount(ahead, locale)}
          </span>
        )}
        {behind > 0 && (
          <span className="inline-flex items-center">
            <ArrowDownIcon />
            {formatCount(behind, locale)}
          </span>
        )}
      </span>
      {spoken && <span className="sr-only">{`${spoken.ahead(ahead, locale)}, ${spoken.behind(behind, locale)}`}</span>}
    </span>
  )
}

type CommitRowContext = {
  now: Instant | undefined
  locale: string | undefined
  timeZone: string | undefined
  labels: CommitHistoryLabels
  copied: string | null
  copyHash: (id: string, event: Event) => void
  /** The branch the branches view is showing alone, if any. */
  focusedBranch?: string | null
}

type CommitRowProps = {
  commit: Commit
  index: number
  lanes: LaneRow
  depth: number
  /** A merge with nested commits: a chevron, and Left/Right open and close it. */
  merge: boolean
  detailsOpen: boolean
  /** Nested under a merge that was just expanded: the row eases in. */
  entering: boolean
  /** The merge that was just expanded: its new lane draws in. */
  drawIn: boolean
  /** The branches whose head this commit is, shown as pills in the branches view. */
  heads?: readonly BranchInfo[]
  /** Not on the upstream yet: a cloud-upload mark, and "not pushed" in the name. */
  unpushed?: boolean
  context: CommitRowContext
  /** Where the row sits in the list's box while it's virtualized, in px. */
  top?: number
  measure?: (index: number, el: HTMLElement | null) => () => void
  /** Fills a piece of the subject, so find in page finds the row while it isn't rendered (`findableText`). */
  textSlot?: (index: number, el: HTMLElement | null, part: number) => () => void
}

function authorName(author: Commit["author"]) {
  if (author === undefined) return undefined
  return typeof author === "string" ? author : author.name
}

function hashOf(commit: Commit) {
  return commit.hash ?? commit.id.slice(0, 7)
}

type SegmentProps = { segment: CommitMessageSegment; textRef?: (el: HTMLElement | null) => () => void }

function MessageSegment({ segment, textRef }: SegmentProps) {
  switch (segment.type) {
    case "file":
      return <GitFileChip path={segment.path} textRef={textRef} />
    case "branch":
      return <GitBranchChip name={segment.name} textRef={textRef} />
    case "code":
      return (
        <code ref={textRef} className="rounded-sm bg-muted px-inline font-mono text-caption leading-tight">
          {textRef ? null : segment.text}
        </code>
      )
    default:
      return textRef ? <span ref={textRef} /> : segment.text
  }
}

type NameContext = Pick<CommitRowContext, "now" | "locale" | "labels">

/** What follows the subject in a row's name: ", 38 minutes ago, Release". */
/** What a branch pill reads: "branch feature/webhooks, 3 ahead, 12 behind". */
function branchName(branch: BranchInfo, context: NameContext) {
  const { labels, locale } = context
  const parts = [labels.branchHead(branch.name)]
  if (branch.state !== "base") parts.push(labels.ahead(branch.ahead, locale), labels.behind(branch.behind, locale))
  return parts.join(", ")
}

function commitNameSuffix(commit: Commit, context: NameContext, heads: readonly BranchInfo[] = NONE, unpushed = false) {
  const when =
    commit.status === "pending"
      ? context.labels.pending
      : formatRelative(commit.date, { now: context.now, locale: context.locale })
  const parts = [
    when,
    ...(commit.tags ?? []).map((tag) => tag.label),
    ...heads.map((head) => branchName(head, context)),
    ...(unpushed ? [context.labels.notPushed] : []),
  ]
  return parts.map((part) => `, ${part}`).join("")
}

/** A commit's accessible name: "Merge invoice-pdf into main, 38 minutes ago, Release, not pushed". */
function commitName(commit: Commit, context: NameContext, heads?: readonly BranchInfo[], unpushed?: boolean) {
  return commitSubject(commit) + commitNameSuffix(commit, context, heads, unpushed)
}

function CommitDetails({ commit, context, id }: { commit: Commit; context: CommitRowContext; id: string }) {
  const { labels, locale, timeZone } = context
  const author = authorName(commit.author)
  const hash = hashOf(commit)
  const copied = context.copied === commit.id
  const { stats } = commit
  return (
    <div
      id={id}
      data-slot="commit-details"
      className="flex min-w-0 flex-col gap-inline pb-items text-caption text-muted-foreground"
    >
      <p className="flex flex-wrap items-center gap-inline">
        {author && <span className="font-medium text-foreground">{author}</span>}
        {author && <span aria-hidden="true">·</span>}
        <time dateTime={toISO(commit.date)}>{formatInstant(commit.date, { locale, timeZone })}</time>
      </p>
      <p className="flex flex-wrap items-center gap-inline">
        <span className="font-mono text-foreground">{hash}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? labels.copied : labels.copyHash}
          // The history's copyHash action serves agents; this button would repeat it on every open row.
          data-agent-hidden=""
          className="size-6 text-muted-foreground [&_svg]:size-3.5"
          onClick={(event) => context.copyHash(commit.id, event.nativeEvent)}
          // The row's Enter toggles its details; on the button, Enter and Space press the button.
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation()
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
        <output className="sr-only">{copied ? labels.copied : ""}</output>
        {stats && (
          <>
            <span aria-hidden="true">·</span>
            <span>{labels.files(stats.files, locale)}</span>
            <span className="font-mono text-success tabular-nums">
              <span aria-hidden="true">+{formatCount(stats.additions, locale)}</span>
              <span className="sr-only">{labels.additions(stats.additions, locale)}</span>
            </span>
            <span className="font-mono text-destructive tabular-nums">
              <span aria-hidden="true">-{formatCount(stats.deletions, locale)}</span>
              <span className="sr-only">{labels.deletions(stats.deletions, locale)}</span>
            </span>
          </>
        )}
      </p>
      {commit.body && <p className="text-body-sm whitespace-pre-line">{commit.body}</p>}
    </div>
  )
}

/** Keeps the details mounted while they close, so their height can animate to 0 before they leave. */
function useClosing(open: boolean) {
  const [wasOpen, setWasOpen] = useState(open)
  const [closing, setClosing] = useState(false)
  if (wasOpen !== open) {
    setWasOpen(open)
    setClosing(!open)
  }
  return { mounted: open || closing, done: () => setClosing(false) }
}

/** Whether a pending commit just finished, so its node, time and tags ease in once. */
function useFinished(status: Commit["status"]) {
  const [previous, setPrevious] = useState(status)
  const [finished, setFinished] = useState(false)
  if (previous !== status) {
    setPrevious(status)
    setFinished(previous === "pending")
  }
  return finished
}

const easeIn = "transition duration-panel ease-standard starting:opacity-0"
// The selected row reads as the current page in a nav: its fill and hairline, and a medium weight on its text.
const selectedLine = "group-data-selected/commit:nav-current"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- text starts past the lanes of the row's first line, each --commit-lane wide
const lineIndent = "ps-[calc(var(--commit-lane)*var(--indent)+var(--gap-inline))]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the details start past every lane that runs on below the line
const detailsIndent = "ps-[calc(var(--commit-lane)*var(--indent-below)+var(--gap-inline))]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the details' height animates as a grid row, 0fr to 1fr
const detailsRows = "grid-rows-[0fr] data-open:grid-rows-[1fr] data-open:starting:grid-rows-[0fr]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- grid-template-rows isn't in the transition utilities
const detailsTransition = "transition-[grid-template-rows]"

const CommitRow = memo(function CommitRow({
  commit,
  index,
  lanes,
  depth,
  merge,
  detailsOpen,
  entering,
  drawIn,
  context,
  top,
  measure,
  textSlot,
  heads,
  unpushed = false,
}: CommitRowProps) {
  const details = useClosing(detailsOpen)
  const finished = useFinished(commit.status)
  const pending = commit.status === "pending"
  const { labels, now, locale, timeZone } = context
  const node: CommitNodeKind = pending ? "pending" : depth > 0 || lanes.tag !== 0 ? "branch" : "commit"
  const columns = graphColumns(lanes)
  const more = columns > lanes.width
  const below = more ? columns : Math.max(lanes.width, ...lanes.out.map((lane) => lane + 1))
  const indent = more ? columns : Math.max(lanes.lane, ...lanes.through, ...lanes.into) + 1
  const style = cssVars({ "--indent": indent, "--indent-below": below })
  const detailsId = `commit-details-${commit.id}`
  const tags = commit.tags ?? []
  const subtle = finished ? easeIn : undefined

  let when: ReactNode
  if (pending) when = <span className="text-caption font-medium text-link">{labels.pending}</span>
  else
    when = (
      <time
        dateTime={toISO(commit.date)}
        title={formatInstant(commit.date, { locale, timeZone })}
        className={cn("text-caption text-muted-foreground tabular-nums", subtle)}
        suppressHydrationWarning
      >
        {formatElapsed(commit.date, { now, locale })}
      </time>
    )

  return (
    <TreeItem
      value={commit.id}
      label={commitSubject(commit)}
      ref={measure ? (el: HTMLElement | null) => measure(index, el) : undefined}
      data-index={index}
      style={top === undefined ? style : { ...style, top }}
      data-pending={pending ? "" : undefined}
      data-details-open={detailsOpen ? "" : undefined}
      data-entering={entering ? "" : undefined}
      aria-describedby={detailsOpen ? detailsId : undefined}
      className={cn(
        "group/commit flex flex-col outline-none",
        top === undefined ? "relative" : "absolute inset-x-0",
        // Focus mode: every row but the open, hovered or focused one reads quieter, still at 4.5:1.
        "group-data-focus-mode/history:not-data-details-open:not-data-selected:not-hover:not-focus-within:text-muted-foreground",
        entering && "transition duration-panel ease-standard starting:-translate-y-1 starting:opacity-0",
      )}
      render={(props) => <div {...props} data-slot="commit-row" />}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-(--commit-line) rounded-control transition-colors duration-micro ease-standard group-hover/commit:bg-accent [:focus-visible>&]:bg-accent [:focus-visible>&]:ring-2 [:focus-visible>&]:ring-ring group-data-details-open/commit:bg-accent",
          selectedLine,
        )}
      />
      <CommitGraphCell row={lanes} node={node} finished={finished} drawIn={drawIn} />
      <TreeItemLabel
        className={cn(
          "relative flex h-(--commit-line) min-w-0 items-center gap-items pe-(--item-padding-x) text-body-sm data-selected:font-medium data-selected:text-foreground",
          lineIndent,
        )}
      >
        <span data-slot="commit-message" className="flex min-w-0 items-center gap-inline">
          <span
            className={cn(
              "truncate",
              depth > 0 && "text-muted-foreground group-data-details-open/commit:text-foreground",
            )}
          >
            {segmentsOf(commit).map((segment, at) => (
              <MessageSegment
                // oxlint-disable-next-line react/no-array-index-key -- segments have no identity beyond their place
                key={at}
                segment={segment}
                textRef={textSlot ? (el) => textSlot(index, el, at) : undefined}
              />
            ))}
          </span>
          {merge && (
            <TreeItemIndicator className="inline-flex shrink-0 text-muted-foreground transition-transform duration-micro ease-standard data-expanded:rotate-90 rtl:-scale-x-100 [&_svg]:size-3.5">
              <ChevronRightIcon />
            </TreeItemIndicator>
          )}
        </span>
        <span className="sr-only">{commitNameSuffix(commit, context, heads, unpushed)}</span>
        <span aria-hidden="true" className="ms-auto flex shrink-0 items-center gap-items">
          {heads?.map((head) => (
            <BranchPill
              key={head.name}
              branch={head}
              locale={context.locale}
              focused={context.focusedBranch === head.name}
            />
          ))}
          {tags.map((tag) => (
            <Badge
              key={tag.label}
              tone={tag.tone ?? "neutral"}
              className={cn("rounded-sm border-transparent py-0 leading-tight", subtle)}
            >
              {tag.label}
            </Badge>
          ))}
          {unpushed && (
            <CloudUploadIcon data-slot="commit-unpushed" className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {when}
        </span>
      </TreeItemLabel>
      {details.mounted && (
        <div
          data-slot="commit-details-panel"
          data-open={detailsOpen ? "" : undefined}
          className={cn(
            "grid pe-(--item-padding-x) duration-panel ease-standard",
            detailsRows,
            detailsTransition,
            detailsIndent,
          )}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (!detailsOpen) {
              details.done()
              return
            }
            // Details opened at the bottom edge would end below the fold; only a row someone is on scrolls.
            const row = event.currentTarget.closest<HTMLElement>("[data-slot=commit-row]")
            if (row?.contains(document.activeElement)) row.scrollIntoView({ block: "nearest" })
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <CommitDetails commit={commit} context={context} id={detailsId} />
          </div>
        </div>
      )}
    </TreeItem>
  )
})

export {
  BranchCounts,
  BranchPill,
  branchName,
  CommitRow,
  commitHistoryLabels,
  commitName,
  hashOf,
  lineIndent,
  selectedLine,
}
export type { CommitHistoryLabels, CommitRowContext, CommitRowProps }
