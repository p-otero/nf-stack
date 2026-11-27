"use client"

import { bindFindable } from "@ui-sdk/core"
import { usePart, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { memo, useCallback, type CSSProperties, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import type { DiffLabels } from "@/components/ui/diff-labels"
import type { SyntaxSpan } from "@/components/ui/diff-syntax"
import type { DiffGap, DiffRow, DiffViewFile } from "@/components/ui/diff-view-model"
import { diffView } from "@/components/ui/diff-view-primitive"
import type { DiffLine, IntralineRanges } from "@/lib/diff-types"
import { cn } from "@/lib/utils"

type DiffViewApi = PrimitiveHandle<typeof diffView>["api"]

const toneClass: Record<SyntaxSpan["tone"], string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  number: "text-syntax-number",
  comment: "text-syntax-comment",
  function: "text-syntax-function",
  type: "text-syntax-type",
  property: "text-syntax-property",
  tag: "text-syntax-tag",
  punctuation: "text-syntax-punctuation",
}

const lineClass = {
  added: "bg-diff-added",
  removed: "bg-diff-removed",
  context: "",
} as const

const gutterClass = {
  added: "bg-diff-added-gutter text-diff-added-foreground",
  removed: "bg-diff-removed-gutter text-diff-removed-foreground",
  context: "text-muted-foreground",
} as const

const changedClass = { added: "bg-diff-added-strong", removed: "bg-diff-removed-strong", context: "" } as const

// Gutters as wide as the highest line number, then the sign and the code.
// oxlint-disable-next-line shadcn/no-arbitrary-values -- columns sized from --diff-number, set from the document
const splitColumns = "grid-cols-[var(--diff-number)_2ch_1fr]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- columns sized from --diff-number, set from the document
const unifiedColumns = "grid-cols-[var(--diff-number)_var(--diff-number)_2ch_1fr]"

// Line numbers are the cell's ::before (and ::after for the new side in unified), from data attributes: two
// elements fewer per line, which a 500-file scroll mounts by the thousand. A press on them selects the line.
const oldNumber =
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- the gutter's text comes from the cell's data-old attribute
  "before:content-[attr(data-old)] before:cursor-pointer before:px-inline before:text-end before:tabular-nums before:select-none"
const newNumber =
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- the gutter's text comes from the cell's data-new attribute
  "after:col-start-2 after:row-start-1 after:content-[attr(data-new)] after:cursor-pointer after:px-inline after:text-end after:tabular-nums after:select-none"

const sign = { added: "+", removed: "-", context: " " } as const

const noSpans: readonly SyntaxSpan[] = []

/** Splits a line at its syntax and changed-word boundaries, so each piece takes one tone and one highlight. */
function pieces(text: string, spans: readonly SyntaxSpan[], changed: IntralineRanges | null) {
  const cuts = new Set<number>([0, text.length])
  for (const span of spans) cuts.add(span.from).add(span.to)
  for (const [from, to] of changed ?? []) cuts.add(from).add(to)
  const sorted = [...cuts].filter((cut) => cut >= 0 && cut <= text.length).toSorted((a, b) => a - b)
  const out: { from: number; to: number; tone?: SyntaxSpan["tone"]; changed: boolean }[] = []
  let span = 0
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index]!
    const to = sorted[index + 1]!
    while (span < spans.length && spans[span]!.to <= from) span++
    const tone = spans[span] && spans[span]!.from <= from ? spans[span]!.tone : undefined
    out.push({ from, to, tone, changed: (changed ?? []).some(([start, end]) => from >= start && to <= end) })
  }
  return out
}

type CodeProps = {
  api: DiffViewApi
  file: DiffViewFile
  line: DiffLine
  partner?: DiffLine
  index: number
  part: number
  findable: boolean
}

/**
 * The colours sit in an `aria-hidden` layer under the line's own text, which is transparent: find in page and
 * selection highlight that text, and the virtualizer can move a match into it (`findableText`).
 */
function Code({ api, file, line, partner, index, part, findable }: CodeProps) {
  const document = api.document
  const side = line.kind === "removed" ? "old" : "new"
  const spans = document.syntax.spans(file, line, side) ?? noSpans
  const changed = document.intraline(line, partner)
  const text = useCallback(
    (el: HTMLElement | null) => (findable ? document.virtual.findableText(index, el, part) : undefined),
    [document, findable, index, part],
  )
  return (
    <span data-slot="diff-view-code" className="grid min-w-0 ps-inline">
      <span aria-hidden="true" className="col-start-1 row-start-1">
        {pieces(line.text, spans, changed).map((piece) => (
          <span
            key={piece.from}
            className={cn(
              piece.tone && toneClass[piece.tone],
              piece.changed && cn("rounded-xs", changedClass[line.kind]),
            )}
          >
            {line.text.slice(piece.from, piece.to)}
          </span>
        ))}
      </span>
      <span ref={text} className="col-start-1 row-start-1 text-transparent selection:bg-ring/30">
        {findable ? null : line.text}
      </span>
    </span>
  )
}

function srLabel(line: DiffLine, labels: DiffLabels) {
  if (line.kind === "added") return labels.added(line.newLine ?? 0)
  if (line.kind === "removed") return labels.removed(line.oldLine ?? 0)
  return labels.unchanged(line.newLine ?? line.oldLine ?? 0)
}

type CellProps = {
  row: number
  col: number
  rowKey: string
  className?: string
  children?: ReactNode
  "data-old"?: string
  "data-new"?: string
}

function Cell({ row, col, rowKey, className, children, ...data }: CellProps) {
  return usePart(
    diffView,
    "cell",
    { row, col, value: `${rowKey}#${String(col)}` },
    {
      className: cn(
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- a selected line keeps its added/removed fill, so its mark is a bar at the start edge
        "relative grid min-w-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-selected:shadow-[inset_3px_0_0_var(--ring)]",
        className,
      ),
      children,
      ...data,
    },
  )
}

type LineCellProps = {
  api: DiffViewApi
  file: DiffViewFile
  rowIndex: number
  rowKey: string
  col: number
  line: DiffLine | undefined
  partner?: DiffLine
  labels: DiffLabels
  findable: boolean
  split: boolean
}

function LineCell({ api, file, rowIndex, rowKey, col, line, partner, labels, findable, split }: LineCellProps) {
  const columns = split ? splitColumns : unifiedColumns
  if (!line) return <Cell row={rowIndex} col={col} rowKey={rowKey} className="bg-muted" />
  return (
    <Cell
      row={rowIndex}
      col={col}
      rowKey={rowKey}
      className={cn(columns, lineClass[line.kind], oldNumber, !split && newNumber)}
      data-old={String((split && col === 1 ? line.newLine : line.oldLine) ?? "")}
      data-new={split ? undefined : String(line.newLine ?? "")}
    >
      <span aria-hidden="true" className={cn("text-center select-none", gutterClass[line.kind])}>
        {sign[line.kind]}
      </span>
      <span className="sr-only">{srLabel(line, labels)}</span>
      <Code api={api} file={file} line={line} partner={partner} index={rowIndex} part={col} findable={findable} />
      {line.noNewline ? <span className="sr-only">{labels.noNewline}</span> : null}
    </Cell>
  )
}

/**
 * The one side an added or deleted file has in split layout, 1 (new) or 0 (old), or null when it has both. That
 * side takes the whole width: an empty half would push the code against the far edge and scroll it sideways.
 */
function loneSide(file: DiffViewFile): 0 | 1 | null {
  if (file.diff.status === "added") return 1
  if (file.diff.status === "deleted") return 0
  return null
}

const range = (start: number, count: number) => (count === 1 ? String(start) : `${String(start)},${String(count)}`)

function hunkHeader(file: DiffViewFile, gap: DiffGap) {
  const hunk = gap.hunk === undefined ? undefined : file.diff.hunks[gap.hunk]
  if (!hunk) return ""
  const heading = hunk.heading ? ` ${hunk.heading}` : ""
  return `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@${heading}`
}

type GapCellProps = {
  api: DiffViewApi
  file: DiffViewFile
  fileIndex: number
  rowIndex: number
  rowKey: string
  gap: DiffGap
  labels: DiffLabels
  findable: boolean
}

function GapCell({ api, file, fileIndex, rowIndex, rowKey, gap, labels, findable }: GapCellProps) {
  const document = api.document
  // The hidden lines stay in the row as hidden="until-found" text: a match opens the gap.
  const hidden = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !findable || !gap.expandable) return
      el.setAttribute("hidden", "until-found")
      const text = document.virtual.findableText(rowIndex, el, 0)
      const found = bindFindable(el, {
        shown: () => false,
        findable: () => true,
        reveal: () => api.expandGap(file.path, gap.id),
      })
      return () => {
        found()
        text()
      }
    },
    [document, api, file.path, findable, gap.expandable, gap.id, rowIndex],
  )
  const canExpand = gap.expandable && gap.count > 0
  return (
    <Cell
      row={rowIndex}
      col={0}
      rowKey={rowKey}
      className="col-span-full flex items-center gap-inline bg-muted px-inline text-muted-foreground"
    >
      {canExpand ? (
        <Button
          size="sm"
          variant="ghost"
          tabIndex={-1}
          className="font-sans"
          onClick={() => api.expandGap(file.path, gap.id)}
          data-file={fileIndex}
        >
          {labels.expand(gap.count)}
        </Button>
      ) : null}
      <span className="truncate">{hunkHeader(file, gap)}</span>
      <span ref={hidden} className="absolute" />
    </Cell>
  )
}

type RowProps = {
  api: DiffViewApi
  row: DiffRow
  index: number
  start: number
  /** The row's height while it isn't measured: unwrapped rows have a fixed one. */
  size: number
  wrap: boolean
  /** Where the row sits in its file's grid, from 1. */
  position: number
  file: DiffViewFile
  labels: DiffLabels
  findable: boolean
  split: boolean
  /** Changes when this file's parse finishes, so the row renders in colour. */
  syntax: number
}

/** One line (unified), one pair (split) or one gap of the diff, absolutely placed by the virtualizer. */
const DiffViewRow = memo(function DiffViewRow({
  api,
  row,
  index,
  start,
  size,
  wrap,
  position,
  file,
  labels,
  findable,
  split,
}: RowProps) {
  const measure = useCallback(
    (el: HTMLElement | null) => (wrap && row.kind !== "gap" ? api.document.virtual.measure(index, el) : undefined),
    [api, index, wrap, row.kind],
  )
  // Gap rows keep their fixed height when lines wrap.
  const fixed = !wrap || row.kind === "gap"
  const style: CSSProperties = fixed ? { top: start, height: size } : { top: start }
  let cells: ReactNode = null
  if (row.kind === "gap") {
    cells = (
      <GapCell
        api={api}
        file={file}
        fileIndex={row.file}
        rowIndex={index}
        rowKey={row.key}
        gap={row.gap}
        labels={labels}
        findable={findable}
      />
    )
  } else if (row.kind === "line") {
    cells = (
      <LineCell
        api={api}
        file={file}
        rowIndex={index}
        rowKey={row.key}
        col={0}
        line={row.line}
        partner={row.partner}
        labels={labels}
        findable={findable}
        split={false}
      />
    )
  } else if (row.kind === "pair") {
    const changed = row.left !== row.right
    const lone = loneSide(file)
    cells = (["old", "new"] as const).map((side, col) =>
      lone !== null && lone !== col ? null : (
        <LineCell
          key={side}
          api={api}
          file={file}
          rowIndex={index}
          rowKey={row.key}
          col={col}
          line={col === 0 ? row.left : row.right}
          partner={changed ? (col === 0 ? row.right : row.left) : undefined}
          labels={labels}
          findable={findable}
          split
        />
      ),
    )
  }
  return usePart(
    diffView,
    "row",
    { value: row.key },
    {
      ref: measure,
      style,
      "aria-rowindex": position,
      className: cn("absolute inset-x-0 grid", split && loneSide(file) === null ? "grid-cols-2" : "grid-cols-1"),
      children: cells,
    },
  )
})

export { DiffViewRow, hunkHeader, loneSide }
export type { DiffViewApi }
