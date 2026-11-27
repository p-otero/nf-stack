import type { GridCell, GridFocusReason } from "@ui-sdk/core"

import type { DiffDocument, DiffLayout, DiffRow, DiffViewFile } from "@/components/ui/diff-view-model"
import type { DiffLine } from "@/lib/diff-types"

type DiffSide = "old" | "new"
type DiffLineRef = { side: DiffSide; line: number }
type DiffLineSelection = { path: string; start: DiffLineRef; end: DiffLineRef; lines: readonly DiffLine[] }
type SelectReason = "item-press" | "list-navigation" | "escape-key" | "imperative"
type SelectHandler = (selection: DiffLineSelection | null, reason: SelectReason, event?: Event) => boolean

type SelectionSource = {
  doc: () => DiffDocument
  files: () => readonly DiffViewFile[]
  layout: () => DiffLayout
  selected: () => readonly string[]
  setSelected: (keys: readonly string[]) => void
}

const lineRow = (row: DiffRow | undefined): row is Extract<DiffRow, { kind: "line" | "pair" }> =>
  row?.kind === "line" || row?.kind === "pair"

function lineAt(row: DiffRow, col: number): DiffLine | undefined {
  if (row.kind === "line") return row.line
  if (row.kind === "pair") return col === 0 ? row.left : row.right
  return undefined
}

function refOf(line: DiffLine, col: number, layout: DiffLayout): DiffLineRef {
  const side: DiffSide = layout === "split" ? (col === 0 ? "old" : "new") : line.kind === "removed" ? "old" : "new"
  return { side, line: (side === "old" ? line.oldLine : line.newLine) ?? line.oldLine ?? 0 }
}

// Line numbers are drawn by CSS on the cell, so a press on them is one left of where the code starts.
function onGutter(event: Event | undefined) {
  if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return false
  const code = event.target.closest('[role="gridcell"]')?.querySelector('[data-slot="diff-view-code"]')
  return Boolean(code && event.clientX < code.getBoundingClientRect().left)
}

const refuseNothing: SelectHandler = () => false

/**
 * The lines selected for a comment: one line from a press on its number or Enter, a range in one file and on one
 * side with Shift. The anchor is kept by row key, so expanding a gap above it doesn't move the range.
 */
function createLineSelection(source: SelectionSource) {
  let anchor: { key: string; col: number } | null = null
  let handler = refuseNothing

  const indexOfKey = (key: string) => source.doc().rows.findIndex((row) => row.key === key)

  function select(from: GridCell | null, to: GridCell | null, extend: boolean, reason: SelectReason, event?: Event) {
    if (!to) {
      anchor = null
      if (source.selected().length === 0 || handler(null, reason, event)) return
      source.setSelected([])
      return
    }
    const { rows } = source.doc()
    const anchorRow = extend && anchor ? indexOfKey(anchor.key) : -1
    const start = anchorRow >= 0 ? anchorRow : (from?.row ?? to.row)
    const target = rows[to.row]
    const first = rows[start]
    if (!target || !first || first.file !== target.file) return
    const col = to.col
    const [low, high] = start <= to.row ? [start, to.row] : [to.row, start]
    const keys: string[] = []
    const lines: DiffLine[] = []
    for (let index = low; index <= high; index++) {
      const row = rows[index]
      const line = row && lineRow(row) ? lineAt(row, col) : undefined
      if (!row || !line) continue
      keys.push(`${row.key}#${String(col)}`)
      lines.push(line)
    }
    if (lines.length === 0) return
    const layout = source.layout()
    const selection: DiffLineSelection = {
      path: source.files()[target.file]!.path,
      start: refOf(lines[0]!, col, layout),
      end: refOf(lines.at(-1)!, col, layout),
      lines,
    }
    if (handler(selection, reason, event)) return
    if (anchorRow < 0) anchor = { key: first.key, col }
    source.setSelected(keys)
  }

  return {
    select,
    onSelect(next: SelectHandler) {
      handler = next
    },
    moved(cell: GridCell, from: GridCell | null, shift: boolean, reason: GridFocusReason, event?: Event) {
      if (shift) select(from, cell, true, reason === "item-press" ? "item-press" : "list-navigation", event)
      else if (reason === "item-press" && onGutter(event)) select(cell, cell, false, "item-press", event)
    },
  }
}

export { createLineSelection, lineAt, lineRow }
export type { DiffLineRef, DiffLineSelection, DiffSide, SelectHandler, SelectReason }
