import {
  byCell,
  createChange,
  createController,
  createGridFocus,
  definePrimitive,
  dispatch,
  selects,
  type ChangeDetails,
  type GridCell,
} from "@ui-sdk/core"

import { settled, unavailable } from "@/lib/action-refusal"
import { createDiffDocument, type DiffLineSelection } from "@/components/ui/diff-view-document"
import type { DiffLayout, DiffViewFile } from "@/components/ui/diff-view-model"
import type { IntralineMode } from "@/lib/diff-types"

type DiffViewController = {
  openFile: (path: string) => { path: string; additions: number; deletions: number } | undefined
  toggleFile: (path: string, open?: boolean) => boolean | undefined
  /** Each change below throws when there is nothing to move to, or the app cancels it. */
  markViewed: (path: string, viewed?: boolean) => boolean | undefined
  nextHunk: () => { path: string; hunk: number } | undefined
  previousHunk: () => { path: string; hunk: number } | undefined
  nextFile: () => { path: string } | undefined
  previousFile: () => { path: string } | undefined
  expandGap: (path: string, gap: number) => number | undefined
  setLayout: (layout: DiffLayout, event?: Event) => boolean | undefined
  setWrap: (wrap: boolean, event?: Event) => boolean | undefined
  clearSelection: () => void
  /** The file at the top of the view, or the one `openFile` last opened. */
  currentFile: () => string | null | undefined
}

/** Pass it as `controller`. */
function createDiffViewController() {
  return createController<DiffViewController>()
}

type DiffViewOptions = {
  controller?: DiffViewController
  files?: readonly DiffViewFile[]
  /** Whether each file gets a header row (path, counts, collapse, viewed). */
  headers?: boolean
  layout?: DiffLayout
  defaultLayout?: DiffLayout
  onLayoutChange?: (layout: DiffLayout, details: ChangeDetails<"item-press" | "imperative">) => void
  wrap?: boolean
  defaultWrap?: boolean
  onWrapChange?: (wrap: boolean, details: ChangeDetails<"press" | "imperative">) => void
  /** Paths marked viewed. */
  viewed?: readonly string[]
  defaultViewed?: readonly string[]
  onViewedChange?: (viewed: readonly string[], details: ChangeDetails<"press" | "imperative">) => void
  /** Paths that start collapsed. */
  defaultCollapsed?: readonly string[]
  /** A line, or a range with Shift, was selected for a comment; `null` when the selection clears. */
  onLineSelect?: (
    selection: DiffLineSelection | null,
    details: ChangeDetails<"item-press" | "list-navigation" | "escape-key" | "imperative">,
  ) => void
  /** The file at the top of the view changed, by scrolling or `openFile`; a file tree beside it follows it. */
  onCurrentFileChange?: (path: string | null, details: ChangeDetails<"scroll" | "imperative">) => void
  intraline?: IntralineMode | false
  /** Find in page reaches lines that aren't rendered and opens collapsed gaps and files. @defaultValue true */
  findable?: boolean
}

const cellKeys = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "mod+Home",
  "mod+End",
  "PageUp",
  "PageDown",
  "Enter",
  "Space",
  "Escape",
] as const

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

const step = <Result>(result: Result | null, action: string, why: string) => result ?? unavailable(action, why)

const diffView = definePrimitive({
  name: "diff-view",
  options: {
    controller: "value",
    files: "value",
    headers: "boolean",
    layout: "string",
    defaultLayout: "string",
    onLayoutChange: "callback",
    wrap: "boolean",
    defaultWrap: "boolean",
    onWrapChange: "callback",
    viewed: "list",
    defaultViewed: "list",
    onViewedChange: "callback",
    defaultCollapsed: "list",
    onLineSelect: "callback",
    onCurrentFileChange: "callback",
    intraline: "value",
    findable: "boolean",
  },
  state: (options: DiffViewOptions) => ({
    layout: options.layout ?? options.defaultLayout ?? ("unified" as DiffLayout),
    wrap: options.wrap ?? options.defaultWrap ?? false,
    viewed: options.viewed ?? options.defaultViewed ?? ([] as readonly string[]),
    collapsed: options.defaultCollapsed ?? ([] as readonly string[]),
    active: null as GridCell | null,
    selected: [] as readonly string[],
    version: 0,
  }),
  controlled: ["layout", "wrap", "viewed"],
  sync: (options) => ({
    ...(options.layout === undefined ? {} : { layout: options.layout }),
    ...(options.wrap === undefined ? {} : { wrap: options.wrap }),
    ...(options.viewed === undefined ? {} : { viewed: options.viewed }),
  }),
  api: (context) => {
    const change = createChange(context)
    const document = createDiffDocument(context)
    const grid = createGridFocus(context, {
      key: "active",
      rows: () => document.rows().length,
      cols: () => (context.store.get().layout === "split" ? 2 : 1),
      disabled: (cell) => !document.focusable(cell),
      reveal: (cell) => document.reveal(cell.row),
      pageSize: () => document.pageSize(),
      onMove: (cell, { from, shift, reason, event }) => document.moved(cell, from, shift, reason, event),
    })
    document.attachGrid(grid)
    document.onSelect((selection, reason, event) => dispatch(context, "onLineSelect", selection, { reason, event }))
    document.onCurrentFile((path, reason) => dispatch(context, "onCurrentFileChange", path, { reason }))

    const setLayout = (layout: unknown, event?: Event) => {
      if (layout !== "unified" && layout !== "split")
        throw new RangeError(`Layout is "unified" or "split", not "${String(layout)}".`)
      return settled(change("layout", layout, { reason: event ? "item-press" : "imperative", event }), "setLayout", {
        event,
      })
    }
    const setWrap = (wrap: unknown, event?: Event) =>
      settled(change("wrap", Boolean(wrap), { reason: event ? "press" : "imperative", event }), "setWrap", { event })
    const markViewed = (path: unknown, viewed: unknown = true, event?: Event) => {
      const file = document.file(path)
      const current = context.store.get().viewed
      const next =
        viewed === false ? current.filter((entry) => entry !== file.path) : [...new Set([...current, file.path])]
      const done = settled(change("viewed", next, { reason: event ? "press" : "imperative", event }), "markViewed", {
        event,
      })
      const marking = viewed !== false
      const markApplied = context.store.get().viewed.includes(file.path) === marking
      if (markApplied) document.setCollapsed(file.path, marking)
      return done
    }

    return {
      grid,
      document,
      subscribe: document.subscribe,
      snapshot: document.snapshot,
      connect: document.connect,
      setLayout,
      setWrap,
      markViewed,
      /** Opens the file if it was collapsed. */
      openFile: (path: unknown) => document.openFile(path),
      toggleFile: (path: unknown, open?: unknown) => document.toggleFile(path, open),
      nextHunk: () => step(document.stepHunk(1), "nextHunk", "isn't available: no hunk after this one"),
      previousHunk: () => step(document.stepHunk(-1), "previousHunk", "isn't available: no hunk before this one"),
      nextFile: () => step(document.stepFile(1), "nextFile", "isn't available: no file after this one"),
      previousFile: () => step(document.stepFile(-1), "previousFile", "isn't available: no file before this one"),
      /** Read-only; the index counts from 0 within the file. */
      getHunk: (path: unknown, hunkIndexInFile: unknown) => document.hunk(path, hunkIndexInFile),
      expandGap: (path: unknown, gap: unknown) => document.expand(path, gap),
      clearSelection: () => document.select(null, null, false, "imperative"),
      currentFile: () => document.currentFile(),
      keydown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return
        const moves: Record<string, () => unknown> = {
          j: () => document.stepHunk(1, event),
          k: () => document.stepHunk(-1, event),
          n: () => document.stepFile(1, event),
          p: () => document.stepFile(-1, event),
        }
        const move = moves[event.key]
        if (!move) return
        event.preventDefault()
        move()
      },
      cellKeydown(event: KeyboardEvent, cell: GridCell) {
        if (event.key === "Escape" && context.store.get().selected.length > 0) {
          event.preventDefault()
          document.select(null, null, false, "escape-key", event)
          return
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          document.activate(cell, event)
          return
        }
        if (grid.keydown(event)) event.preventDefault()
      },
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "group",
      attrs: (state) => ({
        "data-layout": state.layout,
        "data-wrap": state.wrap ? "" : undefined,
      }),
      on: { keydown: (event, { api }) => api.keydown(event as KeyboardEvent) },
    }),
    viewport: slot({
      selects: selects({}),
      bind: (el, { api }) => api.connect(el),
    }),
    file: slot<{ path: string }, { viewed: boolean; collapsed: boolean }>({
      props: { path: "string" },
      selects: selects({ viewed: ({ props }) => [props.path], collapsed: ({ props }) => [props.path] }),
      state: (state, { props }) => ({
        viewed: state.viewed.includes(props.path),
        collapsed: state.collapsed.includes(props.path),
      }),
      attrs: (state, { props }) => ({
        "data-viewed": state.viewed.includes(props.path) ? "" : undefined,
        "data-collapsed": state.collapsed.includes(props.path) ? "" : undefined,
      }),
    }),
    grid: slot<{ path: string }>({
      role: "grid",
      keys: { none: "Focus stays on a cell, whose keydown handles them." },
      props: { path: "string" },
      selects: selects({}),
    }),
    row: slot<{ value: string }>({
      role: "row",
      props: { value: "string" },
      selects: selects({}),
    }),
    cell: slot<{ row: number; col: number; value: string }>({
      role: "gridcell",
      focus: "roving",
      keys: [...cellKeys],
      props: { row: "number", col: "number", value: "string" },
      selects: selects({ active: byCell, selected: ({ props }) => [props.value] }),
      attrs: (state, { props, api }) => ({
        tabindex: api.grid.tabIndex(state, props),
        "data-active": api.grid.isActive(state, props) ? "" : undefined,
        "aria-selected": state.selected.includes(props.value) ? "true" : undefined,
      }),
      on: {
        keydown: (event, { api, props }) => api.cellKeydown(event as KeyboardEvent, props),
        pointerdown: (event, { api, props }) => {
          const pointer = event as PointerEvent
          if (pointer.button !== 0) return
          api.grid.focus(props, { reason: "item-press", event, shift: pointer.shiftKey })
        },
      },
      bind: (el, { api, props }) => api.grid.bind(el, props),
    }),
  }),
  agent: {
    actions: [
      "openFile",
      "toggleFile",
      "markViewed",
      "nextHunk",
      "previousHunk",
      "nextFile",
      "previousFile",
      "getHunk",
      "expandGap",
      "setLayout",
      "setWrap",
      "clearSelection",
      "currentFile",
    ],
    items: (api) => api.document.fileItems(),
  },
})

export { createDiffViewController, diffView }
export type { DiffViewController, DiffViewOptions }
