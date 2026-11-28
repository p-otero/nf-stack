import { byCell, createGridFocus, definePrimitive, selects, type GridCell } from "@ui-sdk/core"

type CellNavigationOptions = {
  rows: number
  cols: number
  /** How many rows Page Up and Page Down move: about as many as show. */
  pageSize?: number
  /** Brings a row that isn't rendered into view, so focus can follow once its cell renders. */
  reveal?: (row: number) => void
  /** Fires on Enter on a cell. */
  onOpen?: (cell: GridCell, event: KeyboardEvent) => void
  /** Fires on Space on a cell, where rows can be selected. */
  onToggle?: (cell: GridCell, event: KeyboardEvent) => void
}

const defaultPageSize = 10

/**
 * Left and Right follow the text direction; Home/End go to a row's ends, with Ctrl/⌘ to the table's corners; Page
 * Up/Down move by `pageSize`. A cell that isn't rendered is revealed first.
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
        focusin: (event, { api, props }) => {
          const active = api.active()
          if (active?.row !== props.row || active.col !== props.col)
            api.grid.focus(props, { reason: "imperative", event })
        },
      },
      bind: (el, { api, props }) => api.grid.bind(el, props),
    }),
  }),
  agent: { actions: [], shown: () => false },
})

export { cellNavigation }
export type { CellNavigationOptions }
