import { pairLines } from "@/lib/diff-intraline"
import { splitLines } from "@/lib/diff-lines"
import type { DiffHunk, DiffLine, FileDiff } from "@/lib/diff-types"

type DiffLayout = "unified" | "split"

type DiffNotice = "binary" | "too-large" | "unchanged"

/** A run of unchanged lines between hunks (or before the first, after the last) that isn't shown yet. */
type DiffGap = {
  id: number
  /** First hidden line on each side, from 1. */
  oldStart: number
  newStart: number
  /** Hidden lines; 0 for a hunk that starts right after the previous one. */
  count: number
  /** The hunk after the gap, whose `@@` header the gap row shows; undefined for the trailing gap. */
  hunk?: number
  /** Whether the hidden lines are known (both texts were given), so the gap can open. */
  expandable: boolean
}

type DiffViewFile = {
  /** Unique within the document; the new path, or the old one for a deleted file. */
  path: string
  diff: FileDiff
  oldLines: readonly string[] | null
  newLines: readonly string[] | null
  gaps: DiffGap[]
  /** The file extension, which picks the syntax highlighter. */
  language: string
  /** The group it's listed under, like "Staged": its header shows it, and the real path in place of a repeat's `(2)`. */
  group?: string
}

type DiffRow =
  | { kind: "file"; file: number; key: string }
  | { kind: "notice"; file: number; notice: DiffNotice; key: string }
  | { kind: "gap"; file: number; gap: DiffGap; key: string }
  | { kind: "line"; file: number; line: DiffLine; partner?: DiffLine; hunk: number; key: string }
  | { kind: "pair"; file: number; left?: DiffLine; right?: DiffLine; hunk: number; key: string }

type FileRows = { rows: DiffRow[]; hunkRows: number[] }

type BuildState = {
  layout: DiffLayout
  collapsed: ReadonlySet<string>
  expanded: ReadonlyMap<string, ReadonlySet<number>>
  headers: boolean
}

type DiffDocument = {
  rows: DiffRow[]
  /** Row index where each file starts. */
  fileStart: number[]
  /** Per file, the row of each hunk's first change, or -1 while the file is collapsed. */
  hunkRows: number[][]
  /** Longest line in characters (tabs as 4), for the width of an unwrapped view. */
  longest: number
  /** The highest line number, for the width of the gutter. */
  maxLine: number
}

function lastOld(hunk: DiffHunk) {
  return hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart + hunk.oldLines - 1
}

function lastNew(hunk: DiffHunk) {
  return hunk.newLines === 0 ? hunk.newStart : hunk.newStart + hunk.newLines - 1
}

function gapsOf(diff: FileDiff, oldLines: readonly string[] | null) {
  const expandable = oldLines !== null
  const gaps: DiffGap[] = []
  let oldEnd = 0
  let newEnd = 0
  diff.hunks.forEach((hunk, index) => {
    const first = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart
    gaps.push({
      id: index,
      oldStart: oldEnd + 1,
      newStart: newEnd + 1,
      count: first - oldEnd - 1,
      hunk: index,
      expandable,
    })
    oldEnd = lastOld(hunk)
    newEnd = lastNew(hunk)
  })
  if (oldLines && diff.hunks.length > 0 && oldLines.length > oldEnd) {
    gaps.push({
      id: diff.hunks.length,
      oldStart: oldEnd + 1,
      newStart: newEnd + 1,
      count: oldLines.length - oldEnd,
      expandable,
    })
  }
  return gaps
}

function extensionOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

function toViewFiles(diffs: readonly FileDiff[]): DiffViewFile[] {
  const seen = new Map<string, number>()
  return diffs.map((diff) => {
    let path = diff.newPath ?? diff.oldPath ?? ""
    const repeat = seen.get(path) ?? 0
    seen.set(path, repeat + 1)
    if (repeat > 0) path = `${path} (${String(repeat + 1)})`
    const oldLines = diff.oldText === undefined ? null : splitLines(diff.oldText)
    const newLines = diff.newText === undefined ? null : splitLines(diff.newText)
    return { path, diff, oldLines, newLines, gaps: gapsOf(diff, newLines && oldLines), language: extensionOf(path) }
  })
}

const expandedLines = new WeakMap<DiffGap, DiffLine[]>()

/** Made once per gap. */
function gapLines(file: DiffViewFile, gap: DiffGap) {
  let lines = expandedLines.get(gap)
  if (!lines) {
    lines = []
    for (let offset = 0; offset < gap.count; offset++) {
      const text = file.newLines?.[gap.newStart - 1 + offset] ?? file.oldLines?.[gap.oldStart - 1 + offset] ?? ""
      lines.push({ kind: "context", text, oldLine: gap.oldStart + offset, newLine: gap.newStart + offset })
    }
    expandedLines.set(gap, lines)
  }
  return lines
}

function noticeOf(diff: FileDiff): DiffNotice | null {
  if (diff.binary) return "binary"
  if (diff.tooLarge) return "too-large"
  if (diff.hunks.length === 0) return "unchanged"
  return null
}

function pushLines(
  rows: DiffRow[],
  file: number,
  path: string,
  lines: readonly DiffLine[],
  hunk: number,
  layout: DiffLayout,
) {
  if (layout === "unified") {
    const partners = pairLines(lines)
    for (const line of lines) {
      const key = `${path}:${line.kind[0]!}${String(line.oldLine ?? 0)}:${String(line.newLine ?? 0)}`
      rows.push({ kind: "line", file, line, partner: partners.get(line), hunk, key })
    }
    return
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.kind === "context") {
      rows.push({ kind: "pair", file, left: line, right: line, hunk, key: `${path}:c${String(line.oldLine)}` })
      index++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === "removed") removed.push(lines[index++]!)
    while (index < lines.length && lines[index]!.kind === "added") added.push(lines[index++]!)
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const left = removed[k]
      const right = added[k]
      const key = `${path}:p${String(left?.oldLine ?? 0)}:${String(right?.newLine ?? 0)}`
      rows.push({ kind: "pair", file, left, right, hunk, key })
    }
  }
}

function buildFileRows(files: readonly DiffViewFile[], index: number, state: BuildState): FileRows {
  const file = files[index]!
  const rows: DiffRow[] = []
  const hunkRows: number[] = []
  if (state.headers) rows.push({ kind: "file", file: index, key: `${file.path}:file` })
  if (state.collapsed.has(file.path)) return { rows, hunkRows: file.diff.hunks.map(() => -1) }
  const notice = noticeOf(file.diff)
  if (notice) {
    rows.push({ kind: "notice", file: index, notice, key: `${file.path}:notice` })
    return { rows, hunkRows }
  }
  const open = state.expanded.get(file.path)
  const showGap = (gap: DiffGap) => {
    if (open?.has(gap.id)) {
      pushLines(rows, index, file.path, gapLines(file, gap), gap.hunk ?? -1, state.layout)
      return
    }
    if (gap.count > 0 || gap.hunk !== undefined) {
      rows.push({ kind: "gap", file: index, gap, key: `${file.path}:gap${String(gap.id)}` })
    }
  }
  file.diff.hunks.forEach((hunk, hunkIndex) => {
    const gap = file.gaps.find((candidate) => candidate.hunk === hunkIndex)
    if (gap) showGap(gap)
    const first = hunk.lines.findIndex((line) => line.kind !== "context")
    hunkRows.push(rows.length + Math.max(0, first))
    pushLines(rows, index, file.path, hunk.lines, hunkIndex, state.layout)
  })
  const trailing = file.gaps.find((gap) => gap.hunk === undefined)
  if (trailing) showGap(trailing)
  return { rows, hunkRows }
}

function signature(file: DiffViewFile, state: BuildState) {
  const open = state.expanded.get(file.path)
  return `${state.layout}|${String(state.headers)}|${String(state.collapsed.has(file.path))}|${open ? [...open].join(",") : ""}`
}

function maxLineOf(file: DiffViewFile) {
  const last = file.diff.hunks.at(-1)
  return Math.max(
    file.oldLines?.length ?? 0,
    file.newLines?.length ?? 0,
    last ? lastOld(last) : 0,
    last ? lastNew(last) : 0,
  )
}

function longestOf(file: DiffViewFile) {
  let longest = 0
  const measure = (text: string) => {
    if (text.length + 3 * 8 < longest) return
    let width = 0
    for (const char of text) width += char === "\t" ? 4 : 1
    if (width > longest) longest = width
  }
  for (const hunk of file.diff.hunks) for (const line of hunk.lines) measure(line.text)
  for (const line of file.newLines ?? []) measure(line)
  return longest
}

/** Each file's rows are cached by the state that shapes them: collapsing or expanding one file rebuilds it alone. */
function createDocumentBuilder() {
  const cache = new WeakMap<DiffViewFile, { signature: string; rows: FileRows }>()
  const widths = new WeakMap<DiffViewFile, { longest: number; maxLine: number }>()
  return (files: readonly DiffViewFile[], state: BuildState): DiffDocument => {
    const rows: DiffRow[] = []
    const fileStart: number[] = []
    const hunkRows: number[][] = []
    let longest = 0
    let maxLine = 0
    files.forEach((file, index) => {
      const key = signature(file, state)
      let entry = cache.get(file)
      if (!entry || entry.signature !== key) {
        entry = { signature: key, rows: buildFileRows(files, index, state) }
        cache.set(file, entry)
      }
      let width = widths.get(file)
      if (width === undefined) {
        width = { longest: longestOf(file), maxLine: maxLineOf(file) }
        widths.set(file, width)
      }
      longest = Math.max(longest, width.longest)
      maxLine = Math.max(maxLine, width.maxLine)
      const start = rows.length
      fileStart.push(start)
      hunkRows.push(entry.rows.hunkRows.map((row) => (row < 0 ? -1 : row + start)))
      for (const row of entry.rows.rows) rows.push(row)
    })
    return { rows, fileStart, hunkRows, longest, maxLine }
  }
}

/** The text find in page searches in a row: its lines, and the lines a closed gap or file hides. */
function findableOf(files: readonly DiffViewFile[], row: DiffRow, collapsed: ReadonlySet<string>): string[] {
  const file = files[row.file]!
  switch (row.kind) {
    case "file":
      if (!collapsed.has(file.path)) return [file.path]
      return [file.path, file.diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)).join("\n")]
    case "gap":
      return row.gap.expandable
        ? [
            gapLines(file, row.gap)
              .map((line) => line.text)
              .join("\n"),
          ]
        : [""]
    case "line":
      return [row.line.text]
    case "pair":
      return [row.left?.text ?? "", row.right?.text ?? ""]
    default:
      return [""]
  }
}

export { createDocumentBuilder, findableOf, gapLines, toViewFiles }
export type { BuildState, DiffDocument, DiffGap, DiffLayout, DiffNotice, DiffRow, DiffViewFile }
