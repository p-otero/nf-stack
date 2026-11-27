"use client"

import { TreeItem, TreeItemLabel } from "@ui-sdk/react/tree"
import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import type { CommitHistoryLabels } from "@/components/ui/commit-history-labels"
import { WORKING_TREE } from "@/components/ui/commit-history-primitive"
import { lineIndent, selectedLine } from "@/components/ui/commit-history-row"
import { cn, cssVars } from "@/lib/utils"

// oxlint-disable-next-line shadcn/no-arbitrary-values -- the node's stroke matches the lanes' 1.5px
const workingTreeNode = "size-3 rounded-full border-[1.5px] border-dashed border-current bg-card"

type WorkingTree = {
  /** Files with staged changes. */
  staged: number
  /** Files with unstaged changes, untracked ones included. */
  unstaged: number
  /** The row's name; `labels.workingTree` ("Uncommitted changes") by default. */
  label?: string
}

/** The working-tree row's pieces, and its name: "Uncommitted changes, 2 staged, 3 unstaged". */
function workingTreeText(workingTree: WorkingTree, labels: CommitHistoryLabels, locale?: string) {
  const label = workingTree.label ?? labels.workingTree
  const counts = [labels.staged(workingTree.staged, locale), labels.unstaged(workingTree.unstaged, locale)] as const
  return { label, counts, name: [label, ...counts].join(", ") }
}

type WorkingTreeRowProps = { workingTree: WorkingTree; labels: CommitHistoryLabels; locale?: string }

/**
 * The checkout's uncommitted changes, as a row above the newest commit: a hollow dashed node (nothing is committed
 * yet), its name and the staged and unstaged counts. It shares the tree's focus and selection with the commits.
 */
const WorkingTreeRow = memo(function WorkingTreeRow({ workingTree, labels, locale }: WorkingTreeRowProps) {
  const { label, counts, name } = workingTreeText(workingTree, labels, locale)
  return (
    <TreeItem
      value={WORKING_TREE}
      label={label}
      style={cssVars({ "--indent": 1 })}
      className="group/commit relative flex flex-col outline-none group-data-focus-mode/history:not-data-selected:not-hover:not-focus-within:text-muted-foreground"
      render={(props) => <div {...props} data-slot="commit-working-tree" />}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-(--commit-line) rounded-control transition-colors duration-micro ease-standard group-hover/commit:bg-accent [:focus-visible>&]:bg-accent [:focus-visible>&]:ring-2 [:focus-visible>&]:ring-ring",
          selectedLine,
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-0 top-0 flex h-(--commit-line) w-(--commit-lane) items-center justify-center text-muted-foreground"
      >
        <span data-slot="commit-node" data-node="working-tree" className={workingTreeNode} />
      </span>
      <TreeItemLabel
        className={cn(
          "relative flex h-(--commit-line) min-w-0 items-center gap-inline pe-(--item-padding-x) text-body-sm data-selected:font-medium data-selected:text-foreground",
          lineIndent,
        )}
      >
        <span aria-hidden="true" className="truncate">
          {label}
        </span>
        <span aria-hidden="true" className="ms-auto flex shrink-0 items-center gap-inline">
          <Badge tone="success" className="rounded-sm py-0 leading-tight">
            {counts[0]}
          </Badge>
          <Badge tone="warning" className="rounded-sm py-0 leading-tight">
            {counts[1]}
          </Badge>
        </span>
        <span className="sr-only">{name}</span>
      </TreeItemLabel>
    </TreeItem>
  )
})

export { WorkingTreeRow, workingTreeText }
export type { WorkingTree }
