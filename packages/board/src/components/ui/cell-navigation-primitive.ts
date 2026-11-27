import { byCell, createGridFocus, definePrimitive, selects, type GridCell } from "@ui-sdk/core"

type CellNavigationOptions = {
  rows: number
  cols: number
  /** How many rows Page Up and Page Down move: about as many as show. */
  pageSize?: number
  /** Brings a row that isn't rendered into view, so focus can follow once its cell renders. */
  reveal?: (row: number) => void
  /** Enter on a cell. */
  onOpen?: (cell: GridCell, event: KeyboardEvent) => void
  /** Space on a cell, where rows can be selected. */
  onToggle?: (cell: GridCell, event: KeyboardEvent) => void
}

const defaultPageSize = 10

/**
 * One tab stop for a table's cells, on UI SDK's grid focus: the arrows move by cell (Left and Right follow the text
 * direction), Home/End to a row's ends and with Ctrl/⌘ to the table's corners, Page Up/Down by `pageSize`. A cell
 * that isn't rendered is revealed first. Enter and Space go to `onOpen` and `onToggle`. A move changes two cells.
 */
const cellNavigation = definePrimitive({
  name: "cell-navigation",
  options: {
    rows: "number",
    cols: "number",
    pageSize: "number",
    reveal: "callback",
    onOpen: "callback",
    onToggle: "callback",
  },
  state: (_options: CellNavigationOptions) => ({
    active: null as GridCell | null,
  }),
  api: (context) => {
    const grid = createGridFocus(context, {
      key: "active",
      rows: () => context.options().rows,
      cols: () => context.options().cols,
      pageSize: () => context.options().pageSize ?? defaultPageSize,
      reveal: (cell) => context.options().reveal?.(cell.row),
    })
    return {
      grid,
      keydown(event: KeyboardEvent, el: HTMLElement, cell: GridCell) {
        if (event.defaultPrevented || event.target !== el) return
        if (grid.keydown(event)) {
          event.preventDefault()
          return
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const { onOpen, onToggle } = context.options()
        if (event.key === "Enter" && onOpen) {
          event.preventDefault()
          onOpen(cell, event)
        } else if (event.key === " " && onToggle) {
          event.preventDefault()
          onToggle(cell, event)
        }
      },
      active: () => context.store.get().active,
    }
  },
  slots: (slot) => ({
    root: slot({}),
    // `id` tells the cells apart: unique in the page, and stable while the cell stays.
    cell: slot<{ row: number; col: number; id: string }>({
      props: { row: "number", col: "number", id: "string" },
      focus: "roving",
      keys: [
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
      ],
      selects: selects({ active: byCell }),
      attrs: (state, { props, api }) => ({
        role: "gridcell",
        tabindex: api.grid.tabIndex(state, props),
        "data-active": api.grid.isActive(state, props) ? "" : undefined,
      }),
      on: {
        keydown: (event, { el, api, props }) => {
          if (el) api.keydown(event, el, props)
        },
        pointerdown: (event, { api, props }) => api.grid.focus(props, { reason: "item-press", event }),
        // Focus that arrives another way, like Tab or a script, makes the cell active, so the keys move from it.
        focusin: (event, { api, props }) => {
          const active = api.active()
          if (active?.row !== props.row || active.col !== props.col)
            api.grid.focus(props, { reason: "imperative", event })
        },
      },
      bind: (el, { api, props }) => api.grid.bind(el, props),
    }),
  }),
  // Keys are a people-only accelerator: agents act on rows through the table's own actions.
  agent: { actions: [], shown: () => false },
})

export { cellNavigation }
export type { CellNavigationOptions }
