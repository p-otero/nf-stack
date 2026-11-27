import { rowOfCommit, type Commit, type CommitGraph, type VisibleRows } from "@/lib/commit-graph"

/**
 * One row of the graph, `git log --graph` style, as it's drawn: only the first `maxLanes` lanes are. `lane` is the
 * column of the row's node. Between the top of the row and its node, each lane in `into` runs into the node;
 * between the node and the bottom, the node runs out to each lane in `out`; every lane in `through` passes
 * straight by. `width` counts the lanes the row draws.
 */
type LaneRow = {
  lane: number
  width: number
  into: readonly number[]
  out: readonly number[]
  through: readonly number[]
  /** Lanes past `maxLanes` that run through the row, not drawn: the "+N" beside the graph. */
  hidden: number
  /** The node's own lane is past `maxLanes`: it's drawn in the "+N" column. */
  nodeHidden: boolean
  /** Each drawn lane's tag at the top of the row and at its bottom, like a branch's colour. */
  tagsTop: readonly number[]
  tagsBottom: readonly number[]
  /** The node's tag. */
  tag: number
}

type LaneLayoutOptions = {
  /** Lanes drawn; the rest are counted in `hidden`. Default 12. */
  maxLanes?: number
  /** Commits whose lanes open before the first row, in this order: lane 0 for the base branch's head. */
  reserve?: readonly { id: string; tag: number }[]
  /**
   * A first parent stays in the commit's lane even when another lane expects it too, so each line keeps its lane
   * down to where they meet, as a branch does down to its merge-base. Off, a line joins the lane that expects its
   * parent at once, as `git log --graph` draws it.
   */
  keepLanes?: boolean
  /** The tag of a lane a commit opens as a head (no child shown above it), like its branch's colour. Default 0. */
  headTag?: (commit: Commit) => number | undefined
}

type LaneLayout = {
  readonly count: number
  /** The row at a shown position, computing the rows above it first, once. */
  at: (position: number) => LaneRow
}

const NONE: readonly number[] = []

/** Free lane indexes, smallest first; entries a lane has taken since are skipped as they come up. */
function createFreeLanes() {
  const heap: number[] = []
  const push = (lane: number) => {
    heap.push(lane)
    for (let at = heap.length - 1; at > 0;) {
      const parent = (at - 1) >> 1
      if (heap[parent]! <= heap[at]!) break
      ;[heap[parent], heap[at]] = [heap[at]!, heap[parent]!]
      at = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      for (let at = 0; ;) {
        const left = at * 2 + 1
        const right = left + 1
        let smallest = at
        if (left < heap.length && heap[left]! < heap[smallest]!) smallest = left
        if (right < heap.length && heap[right]! < heap[smallest]!) smallest = right
        if (smallest === at) break
        ;[heap[smallest], heap[at]] = [heap[at]!, heap[smallest]!]
        at = smallest
      }
    }
    return top
  }
  return {
    push,
    /** The smallest free lane at `from` or after, else `fallback` (a new lane at the end). */
    take(lanes: readonly (string | null)[], from: number, fallback: number) {
      while (heap.length > 0) {
        const lane = heap[0]!
        if (lane >= lanes.length || lanes[lane] !== null) {
          pop()
          continue
        }
        if (lane < from) return fallback
        return pop()
      }
      return fallback
    },
  }
}

/**
 * Lays out the shown rows lazily, a scan from the top kept as it goes. A parent hidden in a collapsed merge draws
 * no edge; one not loaded yet keeps its lane open. A row costs O(maxLanes + parents) however many lanes are open:
 * commits find their lanes through an index, free lanes come off a heap, lanes past `maxLanes` are only counted.
 */
function createLaneLayout(graph: CommitGraph, visible: VisibleRows, options: LaneLayoutOptions = {}): LaneLayout {
  const maxLanes = Math.max(1, options.maxLanes ?? 12)
  const keepLanes = options.keepLanes ?? false
  const lanes: (string | null)[] = []
  const tags: number[] = []
  const expecting = new Map<string, number[]>()
  const free = createFreeLanes()
  let beyond = 0
  const done: LaneRow[] = []

  const set = (lane: number, id: string | null, tag = 0) => {
    const before = lanes[lane] ?? null
    if (before !== null) {
      const list = expecting.get(before)
      if (list) {
        const at = list.indexOf(lane)
        if (at >= 0) list.splice(at, 1)
        if (list.length === 0) expecting.delete(before)
      }
    }
    if (lane === lanes.length) lanes.push(null)
    if (lane >= maxLanes && (before === null) !== (id === null)) beyond += id === null ? -1 : 1
    lanes[lane] = id
    if (id === null) {
      free.push(lane)
      return
    }
    tags[lane] = tag
    const list = expecting.get(id)
    if (list) list.push(lane)
    else expecting.set(id, [lane])
  }

  for (const { id, tag } of options.reserve ?? []) set(lanes.length, id, tag)

  const hiddenRow = (id: string) => {
    const row = rowOfCommit(graph, id)
    return row !== undefined && visible.shown[row] === 0
  }

  const drawn = () => Math.min(lanes.length, maxLanes)

  const step = (commit: Commit): LaneRow => {
    const into = [...(expecting.get(commit.id) ?? NONE)].toSorted((a, b) => a - b)
    const top = drawn()
    const tagsTop = tags.slice(0, top)
    const through: number[] = []
    for (let lane = 0; lane < top; lane += 1) {
      const expected = lanes[lane]
      if (expected !== null && expected !== commit.id) through.push(lane)
    }
    const hiddenTop = beyond
    const node = into.length > 0 ? into[0]! : free.take(lanes, 0, lanes.length)
    const tag = into.length > 0 ? tags[node]! : (options.headTag?.(commit) ?? 0)
    for (const lane of into) set(lane, null)
    if (node === lanes.length) lanes.push(null)

    const out: number[] = []
    let first = true
    for (const parent of commit.parents) {
      if (hiddenRow(parent)) continue
      const existing = expecting.get(parent)?.[0]
      if (first && lanes[node] === null && (existing === undefined || keepLanes)) {
        set(node, parent, tag)
        out.push(node)
      } else if (existing !== undefined) {
        out.push(existing)
      } else {
        const lane = free.take(lanes, node + 1, lanes.length)
        set(lane, parent, tag)
        out.push(lane)
      }
      first = false
    }
    if (lanes[node] === null) free.push(node)

    const bottom = drawn()
    const width = Math.min(maxLanes, Math.max(top, bottom, node + 1))
    const hidden = Math.max(hiddenTop, beyond)
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop()
    const shownOnly = (list: readonly number[]) => {
      const kept = list.filter((lane) => lane < maxLanes)
      return kept.length > 0 ? kept : NONE
    }
    return {
      lane: Math.min(node, maxLanes),
      width,
      into: shownOnly(into),
      out: shownOnly(out),
      through: through.length > 0 ? through : NONE,
      hidden,
      nodeHidden: node >= maxLanes,
      tagsTop,
      tagsBottom: tags.slice(0, bottom),
      tag,
    }
  }

  return {
    count: visible.count,
    at(position) {
      if (position < 0 || position >= visible.count) throw new RangeError(`No shown row ${String(position)}`)
      while (done.length <= position) {
        const row = visible.rows[done.length]!
        done.push(step(graph.commits[row]!))
      }
      return done[position]!
    },
  }
}

export { createLaneLayout }
export type { LaneLayout, LaneLayoutOptions, LaneRow }
