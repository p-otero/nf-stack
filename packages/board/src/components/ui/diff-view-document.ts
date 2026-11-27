import { createVirtualizer, type GridCell, type GridFocus, type PrimitiveContext, type VirtualItem } from "@ui-sdk/core"

import { createDiffSyntax } from "@/components/ui/diff-syntax"
import { defaultMetrics, readMetrics, rowHeight, sameMetrics } from "@/components/ui/diff-view-metrics"
import {
  createDocumentBuilder,
  findableOf,
  type DiffDocument,
  type DiffLayout,
  type DiffRow,
  type DiffViewFile,
} from "@/components/ui/diff-view-model"
import {
  createLineSelection,
  lineRow,
  type DiffLineRef,
  type DiffLineSelection,
  type DiffSide,
} from "@/components/ui/diff-view-selection"
import { connectDiffScroll, type DiffScroll } from "@/components/ui/diff-view-scroller"
import { intraline } from "@/lib/diff-intraline"
import type { DiffLine, IntralineMode, IntralineRanges } from "@/lib/diff-types"

type DiffViewState = {
  layout: DiffLayout
  wrap: boolean
  viewed: readonly string[]
  collapsed: readonly string[]
  active: GridCell | null
  selected: readonly string[]
  version: number
}

type DiffSnapshot = {
  doc: DiffDocument
  files: readonly DiffViewFile[]
  items: readonly VirtualItem[]
  size: number
  layout: DiffLayout
  wrap: boolean
  syntax: number
}

type DocumentOptions = {
  files?: readonly DiffViewFile[]
  headers?: boolean
  intraline?: IntralineMode | false
  findable?: boolean
  onLineSelect?: unknown
}

type DocumentContext = Pick<
  PrimitiveContext<DocumentOptions, DiffViewState, string>,
  "store" | "options" | "onOptions" | "onDestroy"
> & {
  options: () => DocumentOptions
}

const preferredCol = (row: DiffRow) => (row.kind === "pair" && row.right ? 1 : 0)

/** The state behind a DiffView: rows, the virtualizer, syntax, selection and moves. One per instance. */
function createDiffDocument(context: DocumentContext) {
  const build = createDocumentBuilder()
  const expanded = new Map<string, Set<number>>()
  const listeners = new Set<() => void>()
  const ranges = new WeakMap<DiffLine, IntralineRanges | null>()
  let files = context.options().files ?? []
  let collapsedSet: ReadonlySet<string> = new Set(context.store.get().collapsed)
  let doc = buildDoc()
  let syntaxVersion = 0
  let grid: GridFocus | null = null
  let viewport: HTMLElement | null = null
  let scroll: DiffScroll | null = null
  // The rows' offset in the element that scrolls them: 0 in the diff's own viewport.
  let margin = 0
  let currentFile: string | null = null
  let onCurrent: ((path: string | null, reason: "scroll" | "imperative") => void) | null = null
  let metrics = defaultMetrics

  function buildDoc() {
    const state = context.store.get()
    collapsedSet = new Set(state.collapsed)
    return build(files, {
      layout: state.layout,
      collapsed: collapsedSet,
      expanded,
      headers: context.options().headers ?? false,
    })
  }

  const findable = context.options().findable !== false
  const virtual = createVirtualizer({
    count: () => doc.rows.length,
    estimate: (index) => rowHeight(metrics, doc.rows[index]),
    key: (index) => doc.rows[index]?.key ?? String(index),
    overscan: 10,
    get scrollMargin() {
      return margin
    },
    keep: () => {
      const active = context.store.get().active
      return active && active.row < doc.rows.length ? [active.row] : []
    },
    findable: findable ? (index) => findableOf(files, doc.rows[index]!, collapsedSet) : undefined,
  })

  const syntax = createDiffSyntax(() => {
    syntaxVersion++
    publish()
  })
  context.onDestroy(() => syntax.dispose())

  let snapshot = makeSnapshot()
  function makeSnapshot(): DiffSnapshot {
    const state = context.store.get()
    return {
      doc,
      files,
      items: virtual.items(),
      size: virtual.size(),
      layout: state.layout,
      wrap: state.wrap,
      syntax: syntaxVersion,
    }
  }
  function publish() {
    snapshot = makeSnapshot()
    for (const listener of listeners) listener()
  }

  const selection = createLineSelection({
    doc: () => doc,
    files: () => files,
    layout: () => context.store.get().layout,
    selected: () => context.store.get().selected,
    setSelected: (keys) => context.store.set({ selected: keys }),
  })

  function rebuild() {
    const { active } = context.store.get()
    const activeKey = active ? doc.rows[active.row]?.key : undefined
    doc = buildDoc()
    const row = activeKey === undefined ? -1 : doc.rows.findIndex((entry) => entry.key === activeKey)
    if (active && row !== active.row) context.store.set({ active: row < 0 ? null : { row, col: active.col } })
    virtual.refresh()
    publish()
  }

  context.store.subscribe((_live, _delivered, changed) => {
    if (changed.includes("layout") || changed.includes("collapsed")) rebuild()
    else if (changed.includes("wrap")) {
      virtual.reset()
      publish()
    }
  })
  context.onOptions((options) => {
    if (options.files === files) return
    files = options.files ?? []
    expanded.clear()
    rebuild()
  })

  /** The file at the top of the viewport: its header or lines are the first rows in view. */
  function fileInView() {
    const top = scroll?.top() ?? 0
    const item = virtual.items().find((entry) => entry.start + entry.size > top)
    const row = item ? doc.rows[item.index] : undefined
    return row ? (files[row.file]?.path ?? null) : (files[0]?.path ?? null)
  }

  function setCurrent(path: string | null, reason: "scroll" | "imperative") {
    if (path === currentFile) return
    currentFile = path
    onCurrent?.(path, reason)
  }

  virtual.subscribe(() => {
    if (viewport) setCurrent(fileInView(), "scroll")
  })

  // A match of find in page in a closed gap or a collapsed file opens it, so the browser can show the text.
  virtual.subscribe(() => {
    const found = virtual.items().find((item) => item.found)
    const row = found ? doc.rows[found.index] : undefined
    if (row?.kind === "gap" && row.gap.expandable) expandGap(row.file, row.gap.id)
    else if (row?.kind === "file" && collapsedSet.has(files[row.file]!.path)) setCollapsed(files[row.file]!.path, false)
    else publish()
  })

  function file(path: unknown) {
    const found = files.find((entry) => entry.path === path)
    if (!found) {
      const known = files.slice(0, 20).map((entry) => entry.path)
      throw new RangeError(`No file "${String(path)}". Files: ${known.join(", ")}${files.length > 20 ? "…" : ""}.`)
    }
    return found
  }

  function setCollapsed(path: string, collapsed: boolean) {
    const current = context.store.get().collapsed
    if (current.includes(path) === collapsed) return
    context.store.set({ collapsed: collapsed ? [...current, path] : current.filter((entry) => entry !== path) })
  }

  function expandGap(fileIndex: number, gap: number) {
    const path = files[fileIndex]!.path
    const open = expanded.get(path) ?? new Set<number>()
    if (open.has(gap)) return
    // A new set, so the builder sees the file's signature change.
    expanded.set(path, new Set([...open, gap]))
    rebuild()
  }

  function go(row: number, event?: Event) {
    const target = doc.rows[row]
    if (!target) return
    virtual.scrollToIndex(row, { align: "center" })
    const cell = { row, col: preferredCol(target) }
    const focused = globalThis.document?.activeElement
    const inside = Boolean(viewport && focused && viewport.contains(focused))
    if (grid && (event || inside)) grid.focus(cell, { reason: "imperative" })
    else context.store.set({ active: cell })
  }

  function currentRow() {
    const active = context.store.get().active
    if (active) return active.row
    const top = scroll?.top()
    const first = virtual.items().find((item) => top === undefined || item.start >= top)
    return first ? first.index - 1 : -1
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => snapshot,
    rows: () => doc.rows,
    files: () => files,
    fileItems: () => files.map((entry) => ({ value: entry.path, label: entry.path })),
    syntax,
    virtual,
    attachGrid(next: GridFocus) {
      grid = next
    },
    onSelect: selection.onSelect,
    onCurrentFile(listener: (path: string | null, reason: "scroll" | "imperative") => void) {
      onCurrent = listener
    },
    currentFile: () => currentFile,
    select: selection.select,
    moved: selection.moved,
    connect(el: HTMLElement) {
      viewport = el
      const next = readMetrics(el)
      if (!sameMetrics(next, metrics)) {
        metrics = next
        virtual.reset()
      }
      // The viewport is dir="ltr" for the code; headers follow the page's direction through this variable.
      el.style.setProperty("--diff-page-direction", getComputedStyle(el.parentElement ?? el).direction)
      const connection = connectDiffScroll(el, virtual, findable, (offset) => {
        margin = offset
      })
      scroll = connection.scroll
      setCurrent(fileInView(), "scroll")
      const resize = new ResizeObserver(() =>
        el.style.setProperty("--diff-viewport-width", `${String(el.clientWidth)}px`),
      )
      resize.observe(el)
      return () => {
        resize.disconnect()
        connection.disconnect()
        viewport = null
        scroll = null
      }
    },
    /** Changed words of a line against the line it pairs with, cached per pair. */
    intraline(line: DiffLine, partner: DiffLine | undefined) {
      const mode = context.options().intraline ?? "word"
      if (!partner || mode === false || line.kind === "context") return null
      let result = ranges.get(line)
      if (result === undefined) {
        const [removed, added] = line.kind === "removed" ? [line, partner] : [partner, line]
        const found = intraline(removed.text, added.text, { mode })
        ranges.set(removed, found?.old ?? null)
        ranges.set(added, found?.new ?? null)
        result = ranges.get(line) ?? null
      }
      return result
    },
    focusable(cell: GridCell) {
      const row = doc.rows[cell.row]
      if (row?.kind === "gap" || row?.kind === "line") return cell.col === 0
      if (row?.kind === "pair") return Boolean(cell.col === 0 ? row.left : row.right)
      return false
    },
    reveal: (row: number) => virtual.scrollToIndex(row),
    pageSize: () => (scroll ? Math.max(1, Math.floor(scroll.height() / metrics.line) - 1) : 10),
    activate(cell: GridCell, event: KeyboardEvent) {
      const row = doc.rows[cell.row]
      if (row?.kind === "gap" && row.gap.expandable) expandGap(row.file, row.gap.id)
      else if (lineRow(row)) selection.select(cell, cell, event.shiftKey, "list-navigation", event)
    },
    setCollapsed,
    file,
    expand(path: unknown, gap: unknown) {
      const index = files.indexOf(file(path))
      const target = files[index]!.gaps.find((entry) => entry.id === gap)
      if (!target?.expandable) throw new RangeError(`File "${String(path)}" has no gap ${String(gap)} to expand.`)
      expandGap(index, target.id)
      return target.count
    },
    toggleFile(path: unknown, open?: unknown) {
      const target = file(path)
      const next = open === undefined ? !collapsedSet.has(target.path) : !open
      setCollapsed(target.path, next)
      return !next
    },
    openFile(path: unknown) {
      const target = file(path)
      setCollapsed(target.path, false)
      virtual.scrollToIndex(doc.fileStart[files.indexOf(target)]!, { align: "start" })
      setCurrent(target.path, "imperative")
      return { path: target.path, additions: target.diff.additions, deletions: target.diff.deletions }
    },
    stepHunk(direction: 1 | -1, event?: Event) {
      const current = currentRow()
      const rows = doc.hunkRows.flat().filter((row) => row >= 0)
      const target = direction > 0 ? rows.find((row) => row > current) : rows.findLast((row) => row < current)
      if (target === undefined) return null
      go(target, event)
      const row = doc.rows[target]!
      return { path: files[row.file]!.path, hunk: lineRow(row) ? row.hunk : 0 }
    },
    stepFile(direction: 1 | -1, event?: Event) {
      const current = currentRow()
      const starts = doc.fileStart
      const index =
        direction > 0 ? starts.findIndex((row) => row > current) : starts.findLastIndex((row) => row < current - 1)
      if (index < 0) return null
      const start = starts[index]!
      const end = starts[index + 1] ?? doc.rows.length
      const first = doc.rows.slice(start, end).findIndex((row) => lineRow(row))
      if (first >= 0) go(start + first, event)
      virtual.scrollToIndex(start, { align: "start" })
      return { path: files[index]!.path }
    },
    hunk(path: unknown, n: unknown) {
      const target = file(path)
      const hunk = typeof n === "number" ? target.diff.hunks[n] : undefined
      if (!hunk) throw new RangeError(`"${target.path}" has hunks 0 to ${String(target.diff.hunks.length - 1)}.`)
      const { lines, ...header } = hunk
      return { path: target.path, ...header, lines: lines.map((line) => ({ ...line })) }
    },
  }
}

type DiffDocumentController = ReturnType<typeof createDiffDocument>

export { createDiffDocument }
export type { DiffDocumentController, DiffLineRef, DiffLineSelection, DiffSide, DiffSnapshot, DiffViewState }
