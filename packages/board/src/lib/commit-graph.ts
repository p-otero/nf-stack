import type { Instant } from "@/lib/time"
import type { Tone } from "@/lib/tone"

type CommitStatus = "pending" | "done"

/** A piece of a commit message: plain text, a file path or a branch name (shown as chips), or inline code. */
type CommitMessageSegment =
  | { type: "text"; text: string }
  | { type: "file"; path: string }
  | { type: "branch"; name: string }
  | { type: "code"; text: string }

type CommitTag = { label: string; tone?: Tone }

type CommitAuthor = string | { name: string; email?: string }

type CommitStats = { files: number; additions: number; deletions: number }

type Commit = {
  /** The full hash, or any id unique in the history. */
  id: string
  /** Parent ids, first parent first, as `git log --format=%P` gives them. */
  parents: readonly string[]
  /** A string (backticked paths and `branch:` names become chips) or segments. */
  message: string | readonly CommitMessageSegment[]
  date: Instant
  author?: CommitAuthor
  /** The hash people read and copy; the first 7 characters of `id` by default. */
  hash?: string
  /** The rest of the message, after its subject line. */
  body?: string
  tags?: readonly CommitTag[]
  stats?: CommitStats
  /** `"pending"` while the commit is being written: a spinning node and a status in place of the time. */
  status?: CommitStatus
  /** On this branch but not on its upstream yet, as `git log @{u}..` lists it. */
  unpushed?: boolean
}

/**
 * The commits in order, with each one's place in the "one line per commit" trail. A merge's merged-in branch
 * nests under it: the commits right after the merge that only it reaches, the way `git log --graph --topo-order`
 * prints them. Rows keep the order they arrived in, so nesting never reorders history.
 */
type CommitGraph = {
  readonly commits: readonly Commit[]
  readonly rowOf: ReadonlyMap<string, number>
  /** 0 on the mainline, 1 for a merged branch's commits, 2 for a branch merged into that one… */
  readonly depth: Int32Array
  /** The merge a row nests under, or -1 on the top level. */
  readonly owner: Int32Array
  /** One past the last row nested under a row, at any depth; `row + 1` for a row with none. */
  readonly end: Int32Array
  /** How many rows nest directly under a row. */
  readonly children: Int32Array
  readonly size: number
}

type Claim = { owner: number; depth: number; first: boolean }

type NestState = { claims: Map<string, Claim>; stack: number[]; rowOf: Map<string, number> }

const graphState = new WeakMap<CommitGraph, NestState>()

function better(next: Claim, current: Claim | undefined) {
  if (!current) return true
  if (next.depth !== current.depth) return next.depth < current.depth
  return next.first && !current.first
}

function grow(array: Int32Array, size: number) {
  if (array.length >= size) return array
  const next = new Int32Array(Math.max(size, array.length * 2, 64))
  next.set(array)
  return next
}

function nest(graph: CommitGraph, state: NestState, from: number): CommitGraph {
  const { commits } = graph
  const size = commits.length
  const depth = grow(graph.depth, size)
  const owner = grow(graph.owner, size)
  const end = grow(graph.end, size)
  const children = grow(graph.children, size)
  const { claims, stack, rowOf } = state
  for (let row = from; row < size; row += 1) {
    const commit = commits[row]!
    rowOf.set(commit.id, row)
    const claim = claims.get(commit.id)
    claims.delete(commit.id)
    let parent = -1
    if (claim && claim.owner >= 0) {
      const at = stack.lastIndexOf(claim.owner)
      // A merged branch shows as one block under its merge; once the mainline moves on, a late commit of it
      // can't join the block, so it falls back to the top level.
      if (at >= 0) {
        stack.length = at + 1
        parent = claim.owner
      } else stack.length = 0
    } else stack.length = 0
    owner[row] = parent
    depth[row] = parent < 0 ? 0 : depth[parent]! + 1
    end[row] = row + 1
    children[row] = 0
    if (parent >= 0) children[parent] = children[parent]! + 1
    for (let ancestor = parent; ancestor >= 0; ancestor = owner[ancestor]!) end[ancestor] = row + 1
    const parents = commit.parents
    const own = depth[row]!
    for (let index = 0; index < parents.length; index += 1) {
      const id = parents[index]!
      const placed = rowOf.get(id)
      if (placed !== undefined && placed < row && commits[placed]?.id === id) continue
      const next: Claim =
        index === 0 ? { owner: parent, depth: own, first: true } : { owner: row, depth: own + 1, first: false }
      if (better(next, claims.get(id))) claims.set(id, next)
    }
    if (parents.length > 1) stack.push(row)
  }
  const next: CommitGraph = { commits, rowOf, depth, owner, end, children, size }
  graphState.set(next, state)
  return next
}

/** Builds the trail's structure in one pass over the commits, children before parents (`git log` order). */
function createCommitGraph(commits: readonly Commit[]): CommitGraph {
  const rowOf = new Map<string, number>()
  const empty: CommitGraph = {
    commits,
    rowOf,
    depth: new Int32Array(0),
    owner: new Int32Array(0),
    end: new Int32Array(0),
    children: new Int32Array(0),
    size: 0,
  }
  return nest(empty, { claims: new Map(), stack: [], rowOf }, 0)
}

function sameShape(a: Commit, b: Commit) {
  if (a === b) return true
  if (a.id !== b.id || a.parents.length !== b.parents.length) return false
  return a.parents.every((parent, index) => parent === b.parents[index])
}

/**
 * The graph for `commits`, reusing `previous` when the history only grew at the end (an older page) or only
 * changed commits' content (a pending commit that finished): O(new rows) then, O(n) otherwise.
 */
function updateCommitGraph(previous: CommitGraph | undefined, commits: readonly Commit[]): CommitGraph {
  if (!previous || commits.length < previous.size) return createCommitGraph(commits)
  const state = graphState.get(previous)
  if (!state) return createCommitGraph(commits)
  const old = previous.commits
  for (let row = 0; row < previous.size; row += 1) {
    if (!sameShape(old[row]!, commits[row]!)) return createCommitGraph(commits)
  }
  if (commits.length === previous.size) {
    const next = { ...previous, commits }
    graphState.set(next, state)
    return next
  }
  return nest(
    { ...previous, commits },
    { claims: new Map(state.claims), stack: [...state.stack], rowOf: state.rowOf },
    previous.size,
  )
}

/**
 * The row of a commit id. Appending shares the index between graph versions, so an entry is checked against
 * this version's rows rather than trusted.
 */
function rowOfCommit(graph: CommitGraph, id: string) {
  const row = graph.rowOf.get(id)
  return row !== undefined && row < graph.size && graph.commits[row]?.id === id ? row : undefined
}

function isMergeRow(graph: CommitGraph, row: number) {
  return (graph.children[row] ?? 0) > 0
}

type VisibleRows = {
  /** Rows that show, in order. */
  readonly rows: Int32Array
  readonly count: number
  /** 1 where a row shows. */
  readonly shown: Uint8Array
  /** Where a shown row sits among the shown rows, -1 for a hidden one. */
  readonly position: Int32Array
}

/**
 * The rows that show with `expanded` merges open: a collapsed merge hides its whole block, and so does a row
 * `skip` leaves out, like another branch's commits while one is in focus. O(shown rows).
 */
function visibleRows(graph: CommitGraph, expanded: ReadonlySet<string>, skip?: (row: number) => boolean): VisibleRows {
  const rows = new Int32Array(graph.size)
  const shown = new Uint8Array(graph.size)
  const position = new Int32Array(graph.size).fill(-1)
  let count = 0
  let row = 0
  while (row < graph.size) {
    if (skip?.(row)) {
      row = graph.end[row]!
      continue
    }
    rows[count] = row
    shown[row] = 1
    position[row] = count
    count += 1
    const commit = graph.commits[row]!
    row = isMergeRow(graph, row) && !expanded.has(commit.id) ? graph.end[row]! : row + 1
  }
  return { rows: rows.subarray(0, count), count, shown, position }
}

/** Every merge with a nested block, for "expand all". */
function mergeIds(graph: CommitGraph) {
  const ids: string[] = []
  for (let row = 0; row < graph.size; row += 1) {
    if (isMergeRow(graph, row)) ids.push(graph.commits[row]!.id)
  }
  return ids
}

export { createCommitGraph, isMergeRow, mergeIds, rowOfCommit, updateCommitGraph, visibleRows }
export type {
  Commit,
  CommitAuthor,
  CommitGraph,
  CommitMessageSegment,
  CommitStats,
  CommitStatus,
  CommitTag,
  VisibleRows,
}
