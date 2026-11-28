"use client"

import { SelectEmpty, SelectInput, SelectItemIcon, SelectItemText, SelectValueIcon } from "@ui-sdk/react/select"
import { memo } from "react"

import { laneColor } from "@/components/ui/commit-graph-cell"
import { BranchCounts, type CommitHistoryLabels } from "@/components/ui/commit-history-row"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BranchInfo } from "@/lib/commit-branches"
import { formatElapsed, type Instant } from "@/lib/time"
import { cn } from "@/lib/utils"

const ALL = ""

type CommitBranchSelectProps = {
  branches: readonly BranchInfo[]
  focused: string | null
  onFocus: (name: string | null) => void
  labels: CommitHistoryLabels
  now: Instant | undefined
  locale: string | undefined
}

const triggerClassName =
  "-ms-(--item-padding-x) w-auto max-w-full border-transparent bg-transparent px-(--item-padding-x) font-medium shadow-none hover:bg-accent"

function LaneDot({ tag }: { tag: number }) {
  return <span className={cn("block size-2 rounded-full bg-current", laneColor(tag))} />
}

/** Shows every branch in the branches view, or one alone; typing filters them by name. */
const CommitBranchSelect = memo(function CommitBranchSelect({
  branches,
  focused,
  onFocus,
  labels,
  now,
  locale,
}: CommitBranchSelectProps) {
  return (
    <Select<string>
      value={focused ?? ALL}
      onValueChange={(value) => onFocus(typeof value === "string" && value !== ALL ? value : null)}
    >
      <SelectTrigger aria-label={labels.branchFilter} size="sm" className={triggerClassName}>
        <SelectValueIcon className="inline-flex shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="flex max-h-(--available-height) w-80 max-w-(--available-width) flex-col p-0">
        <SelectInput
          aria-label={labels.searchBranches}
          placeholder={labels.searchBranches}
          className="h-control-sm w-full shrink-0 border-b border-border bg-transparent px-(--item-padding-x) text-entry outline-none placeholder:text-muted-foreground"
        />
        <SelectEmpty className="hidden px-(--item-padding-x) py-inset-item text-body-sm text-muted-foreground data-empty:block">
          {labels.noBranches}
        </SelectEmpty>
        <ScrollArea className="flex min-h-0 flex-col">
          <ScrollAreaViewport
            className="h-auto min-h-0 flex-1 overscroll-contain p-inline"
            render={(part) => <SelectList {...part} />}
          >
            <SelectItem value={ALL} label={labels.allBranches}>
              <SelectItemText className="min-w-0 flex-1 truncate">{labels.allBranches}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.name} value={branch.name} label={branch.name} className="gap-inline">
                <SelectItemIcon className="inline-flex shrink-0">
                  <LaneDot tag={branch.tag} />
                </SelectItemIcon>
                <SelectItemText className="min-w-0 flex-1 truncate font-mono text-body-sm">
                  {(state) =>
                    state.segments.map((segment, at) =>
                      segment.match ? (
                        // oxlint-disable-next-line react/no-array-index-key -- the name's pieces have no identity beyond their place
                        <mark key={at} className="bg-transparent font-semibold text-current">
                          {segment.text}
                        </mark>
                      ) : (
                        segment.text
                      ),
                    )
                  }
                </SelectItemText>
                <BranchCounts ahead={branch.ahead} behind={branch.behind} locale={locale} spoken={labels} />
                {branch.updatedAt !== undefined && (
                  <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                    {formatElapsed(branch.updatedAt, { now, locale })}
                  </span>
                )}
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </ScrollAreaViewport>
          <ScrollAreaScrollbar data-agent-hidden="" />
        </ScrollArea>
      </SelectContent>
    </Select>
  )
})

export { CommitBranchSelect }
export type { CommitBranchSelectProps }
