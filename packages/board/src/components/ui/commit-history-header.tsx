"use client"

import { CloudUploadIcon } from "lucide-react"
import type { ReactNode } from "react"

import { CommitBranchSelect } from "@/components/ui/commit-branch-select"
import type { CommitHistoryLabels } from "@/components/ui/commit-history-labels"
import { Select } from "@/components/ui/select"
import type { BranchInfo } from "@/lib/commit-branches"
import type { Instant } from "@/lib/time"

type CommitHistoryHeaderProps = {
  labels: CommitHistoryLabels
  now: Instant | undefined
  locale: string | undefined
  /** The branches view's active branches: a select shows one alone. */
  active?: readonly BranchInfo[]
  focusedBranch: string | null
  onFocusBranch: (name: string | null) => void
  /** Branch names for the switcher, when there's more than one and a handler. */
  switcher?: readonly string[]
  branch: string | undefined
  onBranch: (name: string) => void
  actions?: ReactNode
  /** Content before the branch, like a repository picker. */
  start?: ReactNode
  total: number
  /** Commits the upstream doesn't have yet. */
  unpushed?: number
}

const switcherClassName =
  "-ms-(--item-padding-x) w-auto border-transparent bg-transparent px-(--item-padding-x) font-medium shadow-none hover:bg-accent"

function CommitHistoryHeader({
  labels,
  now,
  locale,
  active,
  focusedBranch,
  onFocusBranch,
  switcher,
  branch,
  onBranch,
  actions,
  start,
  total,
  unpushed = 0,
}: CommitHistoryHeaderProps) {
  let branchControl: ReactNode
  if (active && active.length > 0)
    branchControl = (
      <CommitBranchSelect
        branches={active}
        focused={focusedBranch}
        onFocus={onFocusBranch}
        labels={labels}
        now={now}
        locale={locale}
      />
    )
  else if (switcher)
    branchControl = (
      <Select
        aria-label={labels.branch}
        size="sm"
        options={switcher.map((name) => ({ value: name, label: name }))}
        value={branch ?? null}
        onValueChange={(value) => {
          if (typeof value === "string") onBranch(value)
        }}
        triggerProps={{ className: switcherClassName }}
      />
    )
  else branchControl = <span className="truncate text-body-sm font-medium">{branch}</span>

  return (
    <div
      data-slot="commit-history-header"
      className="flex min-w-0 items-center justify-between gap-items px-(--item-padding-x)"
    >
      {start === undefined ? (
        branchControl
      ) : (
        <span data-slot="commit-history-scope" className="flex min-w-0 items-center gap-inline">
          {start}
          {branchControl}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-items">
        {actions}
        {unpushed > 0 && (
          <span
            data-slot="commit-history-unpushed"
            className="inline-flex items-center gap-inline text-caption text-muted-foreground tabular-nums"
          >
            <CloudUploadIcon aria-hidden="true" className="size-3.5" />
            {labels.unpushed(unpushed, locale)}
          </span>
        )}
        <span data-slot="commit-history-count" className="text-caption text-muted-foreground tabular-nums">
          {labels.commits(total, locale)}
        </span>
      </span>
    </div>
  )
}

export { CommitHistoryHeader }
export type { CommitHistoryHeaderProps }
