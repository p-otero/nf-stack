import { rowOfCommit, type Commit, type CommitAuthor, type CommitGraph } from "@/lib/commit-graph"
import { toTime, type Instant } from "@/lib/time"
import type { Tone } from "@/lib/tone"

/** A branch and where its head is; `ahead` and `behind` against the base are worked out when they're missing. */
type CommitBranch = {
  name: string
  /** The id of the commit the branch points at. */
  head: string
  /** Colours its lane and pill instead of the colour its name picks. */
  tone?: Tone
  ahead?: number
  behind?: number
  updatedAt?: Instant
  author?: CommitAuthor
}

type BranchState = "base" | "active" | "merged" | "stale"

type BranchInfo = {
  name: string
  head: string
  ahead: number
  behind: number
  updatedAt: Instant | undefined
  author: CommitAuthor | undefined
  tone: Tone | undefined
  /** The lane colour: 0 for the base, 1–5 the categorical chart colours, 10 and up a tone. */
  tag: number
  /** Where it forked from the base's first-parent line, when that is loaded. */
  mergeBase: string | undefined
  state: BranchState
}

type BranchModel = {
  base: BranchInfo | undefined
  /** Branches beside the base that aren't merged into it, newest update first. */
  active: readonly BranchInfo[]
  all: readonly BranchInfo[]
  /** The branches whose head is a commit, by commit id. */
  byHead: ReadonlyMap<string, readonly BranchInfo[]>
  /** For a row, the index in `active` of the branch it's ahead of the base on, or -1. */
  owner: Int32Array
}

const TONES: readonly Tone[] = ["neutral", "info", "success", "warning", "destructive", "violet"]

/** The same name always gets the same of the five chart colours. */
function nameTag(name: string) {
  let hash = 0
  for (let at = 0; at < name.length; at += 1) hash = (hash * 31 + name.charCodeAt(at)) >>> 0
  return 1 + (hash % 5)
}

function tagOf(branch: Pick<CommitBranch, "name" | "tone">) {
  return branch.tone ? 10 + TONES.indexOf(branch.tone) : nameTag(branch.name)
}

type BranchModelOptions = {
  /** The base branch's name; its head's first-parent line is what others are ahead of or behind. */
  base: string | undefined
  /** A branch with no update for this long, in ms, is stale. Default 30 days. */
  staleAfter?: number
  now?: Instant
}

/**
 * Where each branch stands against the base, in one pass over the base's first-parent line and one walk down
 * each branch's first parents until it meets that line: O(commits + commits ahead).
 */
function createBranchModel(
  graph: CommitGraph,
  branches: readonly CommitBranch[],
  options: BranchModelOptions,
): BranchModel {
  const baseBranch = branches.find((branch) => branch.name === options.base)
  const onBase = new Int32Array(graph.size).fill(-1)
  const baseHead = baseBranch ? rowOfCommit(graph, baseBranch.head) : undefined
  let steps = 0
  for (let row = baseHead; row !== undefined;) {
    if (onBase[row] !== -1) break
    onBase[row] = steps
    steps += 1
    const parent = graph.commits[row]?.parents[0]
    row = parent === undefined ? undefined : rowOfCommit(graph, parent)
  }

  const now = options.now === undefined ? Date.now() : toTime(options.now)
  const staleAfter = options.staleAfter ?? 30 * 24 * 60 * 60 * 1000
  const owner = new Int32Array(graph.size).fill(-1)
  const all: BranchInfo[] = []
  const active: BranchInfo[] = []
  const pending: { info: BranchInfo; rows: number[] }[] = []

  for (const branch of branches) {
    const head = rowOfCommit(graph, branch.head)
    const rows: number[] = []
    let mergeBase: number | undefined
    for (let row = head; row !== undefined;) {
      if (onBase[row] !== -1) {
        mergeBase = row
        break
      }
      rows.push(row)
      const parent = graph.commits[row]?.parents[0]
      row = parent === undefined ? undefined : rowOfCommit(graph, parent)
    }
    const headCommit = head === undefined ? undefined : graph.commits[head]!
    const updatedAt = branch.updatedAt ?? headCommit?.date
    const merged = head !== undefined && (graph.depth[head] ?? 0) > 0
    const stale = updatedAt !== undefined && now - toTime(updatedAt) > staleAfter
    const isBase = branch === baseBranch
    const info: BranchInfo = {
      name: branch.name,
      head: branch.head,
      ahead: branch.ahead ?? (isBase ? 0 : rows.length),
      behind: branch.behind ?? (isBase || mergeBase === undefined ? 0 : onBase[mergeBase]!),
      updatedAt,
      author: branch.author ?? headCommit?.author,
      tone: branch.tone,
      tag: isBase ? 0 : tagOf(branch),
      mergeBase: mergeBase === undefined ? undefined : graph.commits[mergeBase]!.id,
      state: isBase ? "base" : merged ? "merged" : stale ? "stale" : "active",
    }
    all.push(info)
    if (info.state === "active" || info.state === "stale") pending.push({ info, rows })
  }

  // Five colours for any number of branches: each takes its name's, or the next one no other branch has yet, in
  // name order, so the same branches keep the same colours and up to five never share one.
  const taken = new Set<number>()
  for (const { info } of pending.toSorted((a, b) => (a.info.name < b.info.name ? -1 : 1))) {
    if (info.tone) continue
    let tag = info.tag
    for (let step = 0; step < 5 && taken.has(tag); step += 1) tag = (tag % 5) + 1
    info.tag = tag
    taken.add(tag)
  }
  pending.sort((a, b) => toTime(b.info.updatedAt ?? 0) - toTime(a.info.updatedAt ?? 0))
  for (const { info, rows } of pending) {
    const index = active.push(info) - 1
    for (const row of rows) if (owner[row] === -1) owner[row] = index
  }

  const byHead = new Map<string, BranchInfo[]>()
  for (const info of all) {
    const list = byHead.get(info.head)
    if (list) list.push(info)
    else byHead.set(info.head, [info])
  }
  return { base: all.find((info) => info.state === "base"), active, all, byHead, owner }
}

/** The tag a head commit's lane takes: the first branch pointing at it, else the base's. */
function headTagOf(model: BranchModel) {
  return (commit: Commit) => model.byHead.get(commit.id)?.[0]?.tag
}

export { createBranchModel, headTagOf, TONES as branchTones }
export type { BranchInfo, BranchModel, BranchModelOptions, BranchState, CommitBranch }
