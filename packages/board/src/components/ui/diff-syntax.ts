import type { Parser, Tree } from "@lezer/common"
import { highlightTree } from "@lezer/highlight"

import {
  loadParser,
  normalizeLanguage,
  parserFor,
  syntaxHighlighter,
  syntaxToneOf,
  type CodeLanguage,
  type SyntaxTone,
} from "@/components/ui/code-highlight"
import type { DiffLine } from "@/lib/diff-types"
import type { DiffViewFile } from "@/components/ui/diff-view-model"

type DiffSide = "old" | "new"

/** A syntax tone over `[from, to)` of one line. */
type SyntaxSpan = { from: number; to: number; tone: SyntaxTone }

type SideSource = {
  text: string
  /** Offset of each line in `text`, by line number. */
  starts: Map<number, number>
  tree?: Tree
  parsing?: boolean
  spans: Map<number, readonly SyntaxSpan[]>
}

const languageOf = (file: DiffViewFile) => normalizeLanguage(file.language)

// Parsing yields to the page after this long, so a 20,000-line file never blocks a frame.
const SLICE_MS = 8
const MAX_LINE = 2000

function sourceOf(file: DiffViewFile, side: DiffSide): SideSource {
  const full = side === "old" ? file.oldLines : file.newLines
  const starts = new Map<number, number>()
  const parts: string[] = []
  let offset = 0
  const add = (number: number, text: string) => {
    starts.set(number, offset)
    parts.push(text)
    offset += text.length + 1
  }
  if (full) full.forEach((text, index) => add(index + 1, text))
  else {
    // From a patch alone, a side is the hunks' lines in order: enough context for most constructs.
    for (const hunk of file.diff.hunks) {
      for (const line of hunk.lines) {
        const number = side === "old" ? line.oldLine : line.newLine
        if (number !== undefined && line.kind !== (side === "old" ? "added" : "removed")) add(number, line.text)
      }
    }
  }
  return { text: parts.join("\n"), starts, spans: new Map() }
}

function schedule(task: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: 200 })
  else setTimeout(task, 0)
}

function parseInSlices(parser: Parser, source: SideSource, done: () => void) {
  const parse = parser.startParse(source.text)
  const step = () => {
    const end = performance.now() + SLICE_MS
    for (;;) {
      const tree = parse.advance()
      if (tree) {
        source.tree = tree
        done()
        return
      }
      if (performance.now() > end) break
    }
    schedule(step)
  }
  schedule(step)
}

/**
 * Syntax tones for the lines a diff shows, made only when a line renders: each side of a file parses once, in
 * slices between frames, the first time one of its lines is on screen, and each line is highlighted from the
 * tree on its own. `onReady` runs when a parse finishes, so the visible rows can render again in colour; only the
 * rows of a file whose `version` changed need to.
 */
function createDiffSyntax(onReady: () => void) {
  const sources = new WeakMap<DiffViewFile, Partial<Record<DiffSide, SideSource>>>()
  const versions = new WeakMap<DiffViewFile, number>()
  const pendingLanguages = new Set<CodeLanguage>()
  let epoch = 0
  let disposed = false

  const ready = (file?: DiffViewFile) => {
    if (disposed) return
    if (file) versions.set(file, (versions.get(file) ?? 0) + 1)
    else epoch++
    onReady()
  }

  function source(file: DiffViewFile, side: DiffSide) {
    let entry = sources.get(file)
    if (!entry) {
      entry = {}
      sources.set(file, entry)
    }
    entry[side] ??= sourceOf(file, side)
    return entry[side]
  }

  function startParse(file: DiffViewFile, side: DiffSide, entry: SideSource) {
    const language = languageOf(file)
    const parser = parserFor(language)
    if (!parser) {
      if (pendingLanguages.has(language)) return
      pendingLanguages.add(language)
      loadParser(language).then(
        () => {
          pendingLanguages.delete(language)
          ready()
        },
        () => {},
      )
      return
    }
    entry.parsing = true
    parseInSlices(parser, entry, () => ready(file))
  }

  /** The tones of a line, `null` while its side parses, `[]` for a language without a parser. */
  function spans(file: DiffViewFile, line: DiffLine, side: DiffSide): readonly SyntaxSpan[] | null {
    const language = languageOf(file)
    if (language === "plaintext" || language === "diff" || language === "bash" || language === "sh") return []
    if (line.text.length > MAX_LINE) return []
    const number = side === "old" ? line.oldLine : line.newLine
    if (number === undefined) return []
    const entry = source(file, side)
    const cached = entry.spans.get(number)
    if (cached) return cached
    if (!entry.tree) {
      if (!entry.parsing) startParse(file, side, entry)
      return null
    }
    const from = entry.starts.get(number)
    if (from === undefined) return []
    const to = from + line.text.length
    const out: SyntaxSpan[] = []
    highlightTree(
      entry.tree,
      syntaxHighlighter,
      (start, end, classes) => {
        const tone = syntaxToneOf(classes)
        if (tone) out.push({ from: Math.max(start, from) - from, to: Math.min(end, to) - from, tone })
      },
      from,
      to,
    )
    entry.spans.set(number, out)
    return out
  }

  return {
    spans,
    /** Changes when a parse of this file finishes or a parser loads. */
    version: (file: DiffViewFile) => epoch * 1_000_000 + (versions.get(file) ?? 0),
    dispose() {
      disposed = true
    },
  }
}

type DiffSyntax = ReturnType<typeof createDiffSyntax>

export { createDiffSyntax }
export type { DiffSide, DiffSyntax, SyntaxSpan }
