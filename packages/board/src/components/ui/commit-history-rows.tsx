"use client"

import type { TreeItemData } from "@ui-sdk/react/tree"

import { WORKING_TREE, type CommitBranchSummary } from "@/components/ui/commit-history-primitive"
import { CommitRow, commitName, type CommitRowContext } from "@/components/ui/commit-history-row"
import type { useCommitTrail } from "@/components/ui/use-commit-history"
import type { useTrailRows } from "@/components/ui/use-trail-rows"
import type { BranchInfo } from "@/lib/commit-branches"
import { isMergeRow, type Commit, type CommitGraph } from "@/lib/commit-graph"
import { commitSubject } from "@/lib/commit-message"
import { toISO } from "@/lib/time"

type Trail = ReturnType<typeof useCommitTrail>

/** The Tree's items: the working tree if any, then every commit, merges holding their nested commits. O(commits). */
function treeItemsOf(graph: CommitGraph, workingTree?: string): TreeItemData[] {
  const items: TreeItemData[] = workingTree === undefined ? [] : [{ value: WORKING_TREE, label: workingTree }]
  const nodes: TreeItemData[] = []
  for (let row = 0; row < graph.size; row += 1) {
    const commit = graph.commits[row]!
    const node: TreeItemData = { value: commit.id, label: commitSubject(commit) }
    if (isMergeRow(graph, row)) node.children = []
    nodes.push(node)
    const owner = graph.owner[row]!
    if (owner < 0) items.push(node)
    else nodes[owner]?.children?.push(node)
  }
  return items
}

function summaryOf(info: BranchInfo): CommitBranchSummary {
  const updatedAt = info.updatedAt === undefined ? undefined : toISO(info.updatedAt)
  return { name: info.name, head: info.head, ahead: info.ahead, behind: info.behind, updatedAt, state: info.state }
}

function doneCount(commits: readonly Commit[]) {
  let count = 0
  for (const commit of commits) if (commit.status !== "pending") count += 1
  return count
}

function ancestorIn(graph: CommitGraph, row: number, ids: ReadonlySet<string>) {
  for (let owner = graph.owner[row]!; owner >= 0; owner = graph.owner[owner]!) {
    if (ids.has(graph.commits[owner]!.id)) return true
  }
  return false
}

type RowsProps = {
  trail: Trail
  details: ReadonlySet<string>
  justExpanded: ReadonlySet<string>
  context: CommitRowContext
  virtual: Omit<ReturnType<typeof useTrailRows>, "setScroller" | "anchor">
  heads: ReadonlyMap<string, readonly BranchInfo[]> | undefined
  /** Rows before this one aren't on the upstream; -1 when every commit's own `unpushed` decides. */
  upstreamRow: number
}

function Rows({ trail, details, justExpanded, context, virtual, heads, upstreamRow }: RowsProps) {
  const { graph, visible, layout } = trail
  return virtual.segments.map((segment) => {
    if (segment.type === "gap") {
      return (
        <div key={segment.key} aria-hidden="true" data-slot="commit-history-gap" style={{ height: segment.size }} />
      )
    }
    const { index, top } = segment
    const row = visible.rows[index]!
    const commit = graph.commits[row]!
    return (
      <CommitRow
        key={commit.id}
        commit={commit}
        index={index}
        top={top}
        lanes={layout.at(index)}
        depth={graph.depth[row]!}
        merge={isMergeRow(graph, row)}
        detailsOpen={details.has(commit.id)}
        entering={justExpanded.size > 0 && ancestorIn(graph, row, justExpanded)}
        drawIn={justExpanded.has(commit.id)}
        context={context}
        measure={virtual.measure}
        textSlot={virtual.textSlot}
        heads={heads?.get(commit.id)}
        unpushed={commit.unpushed === true || row < upstreamRow}
      />
    )
  })
}

/** How many commits the upstream doesn't have: those marked `unpushed` and every row above `upstreamRow`. */
function unpushedCount(commits: readonly Commit[], upstreamRow: number) {
  let count = Math.max(0, upstreamRow)
  for (let row = count; row < commits.length; row += 1) if (commits[row]?.unpushed === true) count += 1
  return count
}

/** What agents list: the working tree if any, then every commit by its full name. */
function entriesOf(
  graph: CommitGraph,
  context: Parameters<typeof commitName>[1],
  heads: ReadonlyMap<string, readonly BranchInfo[]> | undefined,
  workingTree: string | undefined,
  upstreamRow: number,
) {
  const commits = graph.commits.map((commit, index) => ({
    value: commit.id,
    label: commitName(commit, context, heads?.get(commit.id), commit.unpushed === true || index < upstreamRow),
  }))
  return workingTree === undefined ? commits : [{ value: WORKING_TREE, label: workingTree }, ...commits]
}

export { doneCount, entriesOf, Rows, summaryOf, treeItemsOf, unpushedCount }
export type { RowsProps }
