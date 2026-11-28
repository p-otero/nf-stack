import { sequenceDiff } from "@/lib/diff-sequence"
import type { DiffLine, IntralineMode, IntralineRanges } from "@/lib/diff-types"

type Intraline = { old: IntralineRanges; new: IntralineRanges }

type IntralineOptions = {
  mode?: IntralineMode
  /** Lines longer than this get no intraline highlight. @defaultValue 1000 */
  maxLength?: number
  /** Above this share of changed characters on both sides the line counts as rewritten: no highlight. @defaultValue 0.6 */
  maxChangedRatio?: number
}

const wordPattern = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu

function tokenize(text: string, mode: IntralineMode) {
  if (mode === "char") return Array.from(text)
  return text.match(wordPattern) ?? []
}

function rangesOf(tokens: string[], changed: (index: number) => boolean) {
  const ranges: [number, number][] = []
  let offset = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    const end = offset + token.length
    if (changed(index)) {
      const last = ranges.at(-1)
      if (last && last[1] === offset) last[1] = end
      else ranges.push([offset, end])
    } else if (/^\s$/.test(token) && changed(index - 1) && changed(index + 1)) {
      const last = ranges.at(-1)
      if (last && last[1] === offset) last[1] = end
    }
    offset = end
  }
  return ranges
}

function changedLength(ranges: IntralineRanges) {
  let total = 0
  for (const [start, end] of ranges) total += end - start
  return total
}

/**
 * The words (or characters) that changed between a removed line and the added line paired with it, or `null`
 * when the line was rewritten, is too long, or nothing but whitespace position differs.
 */
function intraline(oldText: string, newText: string, options: IntralineOptions = {}): Intraline | null {
  const { mode = "word", maxLength = 1000, maxChangedRatio = 0.6 } = options
  if (oldText === newText || oldText.length > maxLength || newText.length > maxLength) return null
  const oldTokens = tokenize(oldText, mode)
  const newTokens = tokenize(newText, mode)
  const ids = new Map<string, number>()
  const intern = (tokens: string[]) =>
    Int32Array.from(tokens, (token) => {
      let id = ids.get(token)
      if (id === undefined) {
        id = ids.size
        ids.set(token, id)
      }
      return id
    })
  const a = intern(oldTokens)
  const b = intern(newTokens)
  const matches = sequenceDiff.match(a, b, "myers")
  const matchedB = new Uint8Array(b.length)
  for (const j of matches) if (j >= 0) matchedB[j] = 1
  const old = rangesOf(oldTokens, (index) => index >= 0 && index < a.length && matches[index] === -1)
  const next = rangesOf(newTokens, (index) => index >= 0 && index < b.length && matchedB[index] === 0)
  if (old.length === 0 && next.length === 0) return null
  const oldRatio = oldText.length === 0 ? 1 : changedLength(old) / oldText.length
  const newRatio = newText.length === 0 ? 1 : changedLength(next) / newText.length
  if (oldRatio > maxChangedRatio && newRatio > maxChangedRatio) return null
  return { old, new: next }
}

/**
 * Pairs the removed and added lines of each change block in order, the way unified and split views line them
 * up: the first removed line with the first added one, and so on. Returns each line's partner.
 */
function pairLines(lines: readonly DiffLine[]) {
  const partners = new Map<DiffLine, DiffLine>()
  let index = 0
  while (index < lines.length) {
    if (lines[index]!.kind === "context") {
      index++
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === "removed") removed.push(lines[index++]!)
    while (index < lines.length && lines[index]!.kind === "added") added.push(lines[index++]!)
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      partners.set(removed[k]!, added[k]!)
      partners.set(added[k]!, removed[k]!)
    }
  }
  return partners
}

export { intraline, pairLines }
export type { Intraline, IntralineOptions }
