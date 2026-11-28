import { sequenceDiff, type SequenceDiff } from "@/lib/diff-sequence"
import type { DiffHunk, DiffLine, DiffOptions, FileDiff, IgnoreWhitespace, TextDiff } from "@/lib/diff-types"

type LineDiff = {
  /** Splits text into lines the way the diff does: `\n` or `\r\n`, no empty last line after a final newline. */
  splitLines: (text: string) => string[]
  diffText: (oldText: string, newText: string, options?: DiffOptions) => TextDiff
  /** The unified-diff heading git would give a hunk starting at `oldStart`: the nearest line above it that starts a definition. */
  headingAbove: (lines: readonly string[], oldStart: number) => string | undefined
}

// oxlint-disable unicorn/consistent-function-scoping -- a Web Worker runs the factory below from its source, so every helper lives inside it
/**
 * Line diffs and hunks over a sequence diff. Self-contained like `createSequenceDiff`, which it takes as its only
 * input, so a Web Worker can run both from their source.
 */
function createLineDiff(sequence: SequenceDiff): LineDiff {
  const BINARY_SNIFF = 8000
  const CONTEXT = 0
  const REMOVED = 1
  const ADDED = 2

  function indentOf(line: string | undefined) {
    if (line === undefined) return 0
    let width = 0
    for (const char of line) {
      if (char === " ") width++
      else if (char === "\t") width += 4
      else return width
    }
    return 0
  }

  const blank = (line: string | undefined) => line === undefined || line.trim() === ""

  // Spec: git's slider rule: a block that could sit anywhere along a run of repeated lines goes after a blank line,
  // ends on one and begins at the shallowest indent; on a tie, the lowest.
  function score(lines: readonly string[], start: number, size: number) {
    let total = 0
    if (blank(lines[start - 1])) total += 10
    if (blank(lines[start + size - 1])) total += 10
    return total - indentOf(lines[start]) - indentOf(lines[start + size])
  }

  function slide(ops: Uint8Array, a: Int32Array, b: Int32Array, oldLines: string[], newLines: string[]) {
    let i = 0
    let j = 0
    let p = 0
    while (p < ops.length) {
      if (ops[p] === CONTEXT) {
        i++
        j++
        p++
        continue
      }
      let q = p
      while (q < ops.length && ops[q] !== CONTEXT) q++
      const kind = ops[p]!
      const size = q - p
      let pure = true
      for (let k = p; k < q; k++) if (ops[k] !== kind) pure = false
      if (!pure) {
        for (let k = p; k < q; k++) {
          if (ops[k] === REMOVED) i++
          else j++
        }
        p = q
        continue
      }
      const ids = kind === ADDED ? b : a
      const text = kind === ADDED ? newLines : oldLines
      const start = kind === ADDED ? j : i
      const context = (at: number) => at >= 0 && at < ops.length && ops[at] === CONTEXT
      let up = 0
      while (
        context(p - up - 1) &&
        (p - up - 2 < 0 || context(p - up - 2)) &&
        ids[start - up - 1] === ids[start + size - up - 1]
      )
        up++
      let down = 0
      while (
        context(q + down) &&
        (q + down + 1 >= ops.length || context(q + down + 1)) &&
        ids[start + down] === ids[start + size + down]
      )
        down++
      let best = 0
      let bestScore = -Infinity
      for (let shift = -up; shift <= down; shift++) {
        const value = score(text, start + shift, size)
        if (value >= bestScore) {
          bestScore = value
          best = shift
        }
      }
      if (best !== 0) {
        ops.fill(CONTEXT, Math.min(p, p + best), Math.max(q, q + best))
        ops.fill(kind, p + best, q + best)
      }
      const after = Math.max(best, 0)
      if (kind === REMOVED) i += size
      else j += size
      i += after
      j += after
      p = q + after
    }
  }

  function splitLines(text: string) {
    if (text === "") return []
    const lines = text.split("\n")
    if (lines.at(-1) === "") lines.pop()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.endsWith("\r")) lines[i] = line.slice(0, -1)
    }
    return lines
  }

  function normalize(line: string, mode: IgnoreWhitespace) {
    if (mode === "all") return line.replace(/\s+/g, "")
    if (mode === "change") return line.replace(/\s+/g, " ").trimEnd()
    if (mode === "trailing") return line.trimEnd()
    return line
  }

  function isBinary(text: string) {
    return text.slice(0, BINARY_SNIFF).includes("\0")
  }

  function headingAbove(lines: readonly string[], oldStart: number) {
    for (let index = Math.min(oldStart - 2, lines.length - 1); index >= 0; index--) {
      const line = lines[index]!
      if (/^[A-Za-z_$]/.test(line)) return line.slice(0, 80).trimEnd()
    }
    return undefined
  }

  function empty(status: TextDiff["status"], oldLineCount: number, newLineCount: number): TextDiff {
    return { status, hunks: [], additions: 0, deletions: 0, oldLineCount, newLineCount }
  }

  function diffText(oldText: string, newText: string, options: DiffOptions = {}): TextDiff {
    const maxChars = options.maxChars ?? 20_000_000
    if (oldText.length > maxChars || newText.length > maxChars) return empty("too-large", 0, 0)
    if (isBinary(oldText) || isBinary(newText)) return empty("binary", 0, 0)
    const oldLines = splitLines(oldText)
    const newLines = splitLines(newText)
    const maxLines = options.maxLines ?? 200_000
    if (oldLines.length > maxLines || newLines.length > maxLines) {
      return empty("too-large", oldLines.length, newLines.length)
    }
    const oldOpen = oldText !== "" && !oldText.endsWith("\n")
    const newOpen = newText !== "" && !newText.endsWith("\n")
    const mode = options.ignoreWhitespace ?? "none"
    const ids = new Map<string, number>()
    const intern = (lines: string[], open: boolean) => {
      const out = new Int32Array(lines.length)
      for (let i = 0; i < lines.length; i++) {
        let key = normalize(lines[i]!, mode)
        // Spec: a last line without a newline differs from the same text with one, as git shows it.
        if (open && i === lines.length - 1) key += "\u0000"
        let id = ids.get(key)
        if (id === undefined) {
          id = ids.size
          ids.set(key, id)
        }
        out[i] = id
      }
      return out
    }
    const a = intern(oldLines, oldOpen)
    const b = intern(newLines, newOpen)
    const matches = sequence.match(a, b, options.algorithm, options.maxCost)

    const ops = new Uint8Array(a.length + b.length)
    let count = 0
    for (let i = 0, j = 0; i < a.length || j < b.length;) {
      const match = i < a.length ? matches[i]! : b.length
      if (i < a.length && match === -1) {
        ops[count++] = REMOVED
        i++
      } else if (j < match) {
        ops[count++] = ADDED
        j++
      } else {
        ops[count++] = CONTEXT
        i++
        j++
      }
    }
    slide(ops.subarray(0, count), a, b, oldLines, newLines)

    const lines: DiffLine[] = []
    let additions = 0
    let deletions = 0
    for (let p = 0, i = 0, j = 0; p < count; p++) {
      if (ops[p] === REMOVED) {
        const line: DiffLine = { kind: "removed", text: oldLines[i]!, oldLine: i + 1 }
        if (oldOpen && i === a.length - 1) line.noNewline = true
        lines.push(line)
        deletions++
        i++
      } else if (ops[p] === ADDED) {
        const line: DiffLine = { kind: "added", text: newLines[j]!, newLine: j + 1 }
        if (newOpen && j === b.length - 1) line.noNewline = true
        lines.push(line)
        additions++
        j++
      } else {
        const line: DiffLine = { kind: "context", text: newLines[j]!, oldLine: i + 1, newLine: j + 1 }
        if (newOpen && j === b.length - 1) line.noNewline = true
        lines.push(line)
        i++
        j++
      }
    }

    const context = Math.max(0, options.context ?? 3)
    const hunks: DiffHunk[] = []
    let index = 0
    while (index < lines.length) {
      while (index < lines.length && lines[index]!.kind === "context") index++
      if (index >= lines.length) break
      const start = Math.max(0, index - context)
      let end = index
      for (let scan = index; scan < lines.length; scan++) {
        if (lines[scan]!.kind !== "context") end = scan + 1
        else if (scan - end + 1 > context * 2) break
      }
      const stop = Math.min(lines.length, end + context)
      const slice = lines.slice(start, stop)
      const first = slice[0]!
      let oldCount = 0
      let newCount = 0
      for (const line of slice) {
        if (line.kind !== "added") oldCount++
        if (line.kind !== "removed") newCount++
      }
      const oldStart = first.oldLine ?? firstOld(lines, start)
      const newStart = first.newLine ?? firstNew(lines, start)
      const hunk: DiffHunk = {
        oldStart: oldCount === 0 ? oldStart - 1 : oldStart,
        oldLines: oldCount,
        newStart: newCount === 0 ? newStart - 1 : newStart,
        newLines: newCount,
        lines: slice,
      }
      const heading = headingAbove(oldLines, hunk.oldStart)
      if (heading !== undefined) hunk.heading = heading
      hunks.push(hunk)
      index = stop
    }
    return { status: "ok", hunks, additions, deletions, oldLineCount: a.length, newLineCount: b.length }
  }

  function firstOld(lines: DiffLine[], from: number) {
    for (let k = from; k < lines.length; k++) if (lines[k]!.oldLine !== undefined) return lines[k]!.oldLine!
    for (let k = from - 1; k >= 0; k--) if (lines[k]!.oldLine !== undefined) return lines[k]!.oldLine! + 1
    return 1
  }

  function firstNew(lines: DiffLine[], from: number) {
    for (let k = from; k < lines.length; k++) if (lines[k]!.newLine !== undefined) return lines[k]!.newLine!
    for (let k = from - 1; k >= 0; k--) if (lines[k]!.newLine !== undefined) return lines[k]!.newLine! + 1
    return 1
  }

  return { splitLines, diffText, headingAbove }
}

const lineDiff = createLineDiff(sequenceDiff)
const { diffText, splitLines } = lineDiff

type FilePaths = { oldPath?: string | null; newPath?: string | null }

/** Wraps a computed diff as a file for the views, with both texts so its unchanged regions can expand. */
function toFileDiff(
  diff: TextDiff,
  oldText: string,
  newText: string,
  { oldPath = null, newPath = oldPath }: FilePaths = {},
): FileDiff {
  let status: FileDiff["status"] = "modified"
  if (oldPath === null && newPath !== null) status = "added"
  else if (newPath === null && oldPath !== null) status = "deleted"
  else if (oldPath !== newPath) status = "renamed"
  return {
    oldPath,
    newPath,
    status,
    binary: diff.status === "binary",
    tooLarge: diff.status === "too-large",
    hunks: diff.hunks,
    additions: diff.additions,
    deletions: diff.deletions,
    oldText,
    newText,
  }
}

/** Diffs two versions of a file: `diffText` plus `toFileDiff`. */
function diffFile(oldText: string, newText: string, paths: FilePaths = {}, options?: DiffOptions) {
  return toFileDiff(diffText(oldText, newText, options), oldText, newText, paths)
}

export { createLineDiff, diffFile, diffText, lineDiff, splitLines, toFileDiff }
export type { FilePaths, LineDiff }
