import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react"

import { updateCommitGraph, visibleRows, type Commit, type CommitGraph } from "@/lib/commit-graph"
import {
  createBranchModel,
  headTagOf,
  type BranchModel,
  type BranchModelOptions,
  type CommitBranch,
} from "@/lib/commit-branches"
import { createLaneLayout } from "@/lib/commit-lanes"

/**
 * The trail's structure, carried over from the previous render so an appended page costs only its own rows. It
 * is derived during render from the last commits seen, the pattern React documents for state from props.
 */
function useCommitGraph(commits: readonly Commit[]): CommitGraph {
  const [cache, setCache] = useState<{ commits: readonly Commit[]; graph: CommitGraph } | null>(null)
  if (cache?.commits === commits) return cache.graph
  const graph = updateCommitGraph(cache?.graph, commits)
  setCache({ commits, graph })
  return graph
}

/** The merges opened since the last render, whose rows ease in and whose lanes draw in. */
function useJustExpanded(expanded: readonly string[]): ReadonlySet<string> {
  const [seen, setSeen] = useState({ expanded, added: new Set<string>() as ReadonlySet<string> })
  if (seen.expanded === expanded) return seen.added
  const before = new Set(seen.expanded)
  const added = new Set(expanded.filter((id) => !before.has(id)))
  setSeen({ expanded, added })
  return added
}

type TrailOptions = {
  maxLanes?: number
  /** The branches view: the base keeps lane 0 and each branch's lane takes its colour. */
  model?: BranchModel
  /** With a model, shows only the base and this branch's commits (its index in `model.active`). */
  only?: number
}

function useCommitTrail(graph: CommitGraph, expanded: readonly string[], options: TrailOptions = {}) {
  const { maxLanes, model, only } = options
  const open = useMemo(() => new Set(expanded), [expanded])
  const visible = useMemo(() => {
    const owner = model?.owner
    const skip =
      owner && only !== undefined ? (row: number) => (owner[row] ?? -1) >= 0 && owner[row] !== only : undefined
    return visibleRows(graph, open, skip)
  }, [graph, open, model, only])
  const layout = useMemo(
    () =>
      createLaneLayout(graph, visible, {
        maxLanes,
        reserve: model?.base ? [{ id: model.base.head, tag: 0 }] : undefined,
        headTag: model ? headTagOf(model) : undefined,
        keepLanes: model !== undefined,
      }),
    [graph, visible, maxLanes, model],
  )
  return { graph, open, visible, layout }
}

/** The branches view's model, worked out once per graph and branch list. */
function useBranchModel(
  graph: CommitGraph,
  branches: readonly CommitBranch[] | undefined,
  options: BranchModelOptions,
) {
  const { base, staleAfter, now } = options
  return useMemo(
    () => (branches && branches.length > 0 ? createBranchModel(graph, branches, { base, staleAfter, now }) : undefined),
    [graph, branches, base, staleAfter, now],
  )
}

/**
 * Brings a branch's head into view and focuses it when the branch comes into focus, from the select, a pill or an
 * agent: the row may not be rendered until the list scrolls to it, so focus waits a frame for it.
 */
function useFocusHead(
  head: { id: string; position: number } | undefined,
  reveal: (position: number) => void,
  focus: (id: string) => void,
) {
  const id = head?.id
  const position = head?.position
  const revealRow = useEffectEvent(reveal)
  const focusRow = useEffectEvent(focus)
  useEffect(() => {
    if (id === undefined || position === undefined || position < 0) return undefined
    revealRow(position)
    const frame = requestAnimationFrame(() => focusRow(id))
    return () => cancelAnimationFrame(frame)
  }, [id, position])
}

/** A ref for a sentinel after the last row: `onReach` runs when it comes within 200px of the viewport. */
function useReachEnd(onReach: (() => unknown) | undefined, enabled: boolean) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node || !enabled || !onReach || typeof IntersectionObserver === "undefined") return undefined
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void onReach()
        },
        { rootMargin: "200px 0px" },
      )
      observer.observe(node)
      return () => observer.disconnect()
    },
    [onReach, enabled],
  )
}

export { useBranchModel, useCommitGraph, useCommitTrail, useFocusHead, useJustExpanded, useReachEnd }
