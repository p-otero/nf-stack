import { isMergeRow, rowOfCommit, type Commit, type CommitGraph, type CommitMessageSegment } from "@/lib/commit-graph"

// Git's own merge subjects: "Merge branch 'a' into b", "Merge a into b", "Merge pull request #1 from a/b".
const mergeSubject = /^Merge (?:(?:remote-tracking )?branch(?:es)? )?'?([\w./@-]+)'?(?: of \S+)? into '?([\w./@-]+)'?$/
const pullSubject = /^(Merge pull request #\d+ from )([\w./@-]+)$/
const ticks = /`([^`\n]+)`/g

function looksLikePath(text: string) {
  return /[/\\]/.test(text) || /\.[a-z0-9]{1,8}$/i.test(text)
}

function backticked(text: string): CommitMessageSegment {
  if (text.startsWith("branch:")) return { type: "branch", name: text.slice("branch:".length) }
  return looksLikePath(text) ? { type: "file", path: text } : { type: "code", text }
}

function pushText(segments: CommitMessageSegment[], text: string) {
  if (text !== "") segments.push({ type: "text", text })
}

/**
 * Splits a subject line into segments: a backticked path becomes a file chip, `` `branch:name` `` a branch chip,
 * other backticked text inline code, and git's merge subjects ("Merge a into b") branch chips.
 */
function parseCommitMessage(message: string): CommitMessageSegment[] {
  const merge = mergeSubject.exec(message)
  if (merge) {
    const [, from = "", into = ""] = merge
    return [
      { type: "text", text: "Merge " },
      { type: "branch", name: from },
      { type: "text", text: " into " },
      { type: "branch", name: into },
    ]
  }
  const pull = pullSubject.exec(message)
  if (pull)
    return [
      { type: "text", text: pull[1] ?? "" },
      { type: "branch", name: pull[2] ?? "" },
    ]
  const segments: CommitMessageSegment[] = []
  let last = 0
  for (const match of message.matchAll(ticks)) {
    pushText(segments, message.slice(last, match.index))
    segments.push(backticked(match[1] ?? ""))
    last = match.index + match[0].length
  }
  pushText(segments, message.slice(last))
  return segments
}

function segmentsOf(commit: Pick<Commit, "message">): readonly CommitMessageSegment[] {
  return typeof commit.message === "string" ? parseCommitMessage(commit.message) : commit.message
}

function segmentText(segment: CommitMessageSegment) {
  switch (segment.type) {
    case "file":
      return segment.path
    case "branch":
      return segment.name
    default:
      return segment.text
  }
}

/** The subject in the pieces a row shows it in: each segment's text, chips as their names, for find in page. */
const pieces = new WeakMap<object, readonly string[]>()

function subjectPieces(commit: Pick<Commit, "message">): readonly string[] {
  // Find in page asks for every row's pieces when it builds and again as rows scroll; parse each message once.
  let found = pieces.get(commit)
  if (!found) {
    found = segmentsOf(commit).map(segmentText)
    pieces.set(commit, found)
  }
  return found
}

/** The subject as plain text, chips read as their names: what typeahead, agents and find in page match. */
function commitSubject(commit: Pick<Commit, "message">) {
  if (typeof commit.message === "string") return commit.message.replaceAll(/`(?:branch:)?([^`\n]+)`/g, "$1")
  return commit.message.map(segmentText).join("")
}

type CommitMatch = { id: string; hash: string; subject: string; merge: boolean }

const subjectKey = (text: string) => text.trim().toLocaleLowerCase()

/**
 * Finds a commit by id, exact subject (any case) or a hash prefix of 4 or more characters. The subject index is
 * built on the first lookup that needs it, so a history no one searches never pays for it.
 */
function createCommitFinder(graph: CommitGraph): (ref: string) => CommitMatch | undefined {
  let subjects: Map<string, number> | undefined
  const match = (row: number): CommitMatch => {
    const commit = graph.commits[row]!
    const hash = commit.hash ?? commit.id.slice(0, 7)
    return { id: commit.id, hash, subject: commitSubject(commit), merge: isMergeRow(graph, row) }
  }
  return (ref) => {
    const exact = rowOfCommit(graph, ref)
    if (exact !== undefined) return match(exact)
    if (!subjects) {
      subjects = new Map()
      for (let row = 0; row < graph.size; row += 1) {
        const key = subjectKey(commitSubject(graph.commits[row]!))
        if (!subjects.has(key)) subjects.set(key, row)
      }
    }
    const bySubject = subjects.get(subjectKey(ref))
    if (bySubject !== undefined) return match(bySubject)
    if (ref.length < 4) return undefined
    for (let row = 0; row < graph.size; row += 1) {
      const commit = graph.commits[row]!
      if (commit.id.startsWith(ref) || commit.hash?.startsWith(ref)) return match(row)
    }
    return undefined
  }
}

export { commitSubject, createCommitFinder, parseCommitMessage, segmentsOf, subjectPieces }
export type { CommitMatch }
