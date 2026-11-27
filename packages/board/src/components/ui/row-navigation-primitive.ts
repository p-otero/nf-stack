import { createRovingFocus, definePrimitive, selects, type RovingFocusMoveContext } from "@ui-sdk/core"

type RowNavigationOptions = {
  /** Every row's id in order, including rows a virtualized collection hasn't rendered. Defaults to the rendered rows. */
  ids?: readonly string[]
  /** Enter on a row that isn't itself a link or button, like a table row. */
  onOpen?: (id: string, event: KeyboardEvent) => void
  /** Space or `x` on a row, where rows can be selected. Without it, Space keeps its native meaning. */
  onToggle?: (id: string, event: KeyboardEvent) => void
  /** Brings a row that isn't rendered into view, so focus can follow once it renders. */
  reveal?: (id: string) => void
}

const fallbackPage = 10

function isActivator(el: HTMLElement) {
  return el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement || el.getAttribute("role") === "button"
}

function scrollParent(el: HTMLElement) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

function rowsPerPage(el: HTMLElement) {
  const height = el.getBoundingClientRect().height
  if (height <= 0) return fallbackPage
  const viewport = scrollParent(el)?.clientHeight ?? globalThis.innerHeight
  return Math.max(1, Math.floor(viewport / height) - 1)
}

function step(event: KeyboardEvent, el: HTMLElement): number | "first" | "last" | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined
  switch (event.key) {
    case "ArrowDown":
    case "j":
      return 1
    case "ArrowUp":
    case "k":
      return -1
    case "PageDown":
      return rowsPerPage(el)
    case "PageUp":
      return -rowsPerPage(el)
    case "Home":
      return "first"
    case "End":
      return "last"
    default:
      return undefined
  }
}

/**
 * One tab stop over a collection's rows, on UI SDK's roving focus: arrows and j/k move, Home/End and
 * PageUp/PageDown jump, Enter opens a row that isn't a link or button, Space and `x` toggle its selection. The
 * moved-to row scrolls into view with the least scrolling; a virtualized collection renders it first through
 * `reveal`. It adds no role: rows keep the semantics of the list, table or listbox they belong to.
 */
const rowNavigation = definePrimitive({
  name: "row-navigation",
  options: { ids: "list", onOpen: "callback", onToggle: "callback", reveal: "callback" },
  state: (_options: RowNavigationOptions) => ({ active: null as string | null }),
  api: (context) => {
    const move = (event: KeyboardEvent, { from, items }: RovingFocusMoveContext) => {
      const by = step(event, from.el)
      if (by === undefined) return undefined
      const ids = context.options().ids ?? items.map((item) => item.key)
      if (ids.length === 0) return undefined
      const index = ids.indexOf(from.key)
      let target: number
      if (by === "first") target = 0
      else if (by === "last") target = ids.length - 1
      else target = Math.min(ids.length - 1, Math.max(0, (index === -1 ? 0 : index) + by))
      const id = ids[target]
      if (id === undefined) return undefined
      const rendered = items.find((item) => item.key === id)
      if (rendered) rendered.el.scrollIntoView({ block: "nearest", inline: "nearest" })
      else context.options().reveal?.(id)
      return id
    }
    const roving = createRovingFocus(context, { slot: "row", key: "active", move })
    return {
      roving,
      keydown(event: KeyboardEvent, el: HTMLElement, id: string) {
        if (event.defaultPrevented || event.target !== el) return
        if (roving.keydown(event, el)) {
          event.preventDefault()
          return
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const { onOpen, onToggle } = context.options()
        if (event.key === "Enter" && onOpen && !isActivator(el)) {
          event.preventDefault()
          onOpen(id, event)
        } else if ((event.key === " " || event.key === "x") && onToggle) {
          event.preventDefault()
          onToggle(id, event)
        }
      },
      focus: (id?: string) => roving.focus(id),
      active: () => context.store.get().active,
    }
  },
  slots: (slot) => ({
    root: slot({}),
    row: slot<{ value: string }>({
      props: { value: "string" },
      // A move changes two rows: only the one losing and the one taking `active` hear it, so a key press costs
      // the same with 50 rows or 10,000. While nothing is active every row may claim the stop, so all hear `null`.
      selects: selects({ active: ({ key }) => [key, null] }),
      attrs: (state, part) => ({
        tabindex: part.api.roving.tabIndex(state, part),
        "data-active": state.active === part.key ? "" : undefined,
      }),
      on: {
        keydown: (event, { el, api, key }) => {
          if (el) api.keydown(event, el, key)
        },
      },
      bind: (el, part) => part.api.roving.bind(el, part),
    }),
  }),
  // Keys are a people-only accelerator: agents already act on the rows' own parts and the collection's actions.
  agent: { actions: [], shown: () => false },
})

export { rowNavigation, rowsPerPage }
export type { RowNavigationOptions }
