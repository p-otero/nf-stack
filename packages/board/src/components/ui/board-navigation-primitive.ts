import { createRovingFocus, definePrimitive, selects, type RovingFocusMoveContext } from "@ui-sdk/core"

type BoardNavigationOptions = {
  /** Enter on a card whose part isn't itself a link or button. */
  onOpen?: (id: string, event: KeyboardEvent) => void
}

type Card = RovingFocusMoveContext["items"][number]

const columnOf = (el: HTMLElement) => el.closest('[data-slot="board-column"]')

/** The cards in their columns, columns in document order, leaving out columns with no card that can take focus. */
function columnsOf(items: RovingFocusMoveContext["items"]) {
  const columns = new Map<Element | null, Card[]>()
  for (const item of items) {
    const column = columnOf(item.el)
    columns.set(column, [...(columns.get(column) ?? []), item])
  }
  return [...columns.values()]
}

function isActivator(el: HTMLElement) {
  return el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement || el.getAttribute("role") === "button"
}

/** Where a key press goes on the board, as a column step, a row step or a jump; undefined for keys it leaves alone. */
function stepOf(event: KeyboardEvent, rtl: boolean) {
  if (event.altKey || event.shiftKey) return undefined
  const corner = event.ctrlKey || event.metaKey
  if (event.key === "Home") return corner ? ("board-first" as const) : ("first" as const)
  if (event.key === "End") return corner ? ("board-last" as const) : ("last" as const)
  if (corner) return undefined
  switch (event.key) {
    case "ArrowDown":
    case "j":
      return { row: 1 }
    case "ArrowUp":
    case "k":
      return { row: -1 }
    case "ArrowRight":
      return { column: rtl ? -1 : 1 }
    case "ArrowLeft":
      return { column: rtl ? 1 : -1 }
    default:
      return undefined
  }
}

function target(event: KeyboardEvent, { from, items, rtl }: RovingFocusMoveContext) {
  const step = stepOf(event, rtl)
  if (step === undefined) return undefined
  const columns = columnsOf(items)
  const column = columns.findIndex((cards) => cards.some((card) => card.key === from.key))
  const cards = columns[column]
  if (!cards) return undefined
  const row = cards.findIndex((card) => card.key === from.key)
  if (step === "first") return cards[0]
  if (step === "last") return cards.at(-1)
  if (step === "board-first") return items[0]
  if (step === "board-last") return items.at(-1)
  if (step.row !== undefined) return cards[row + step.row]
  // Across columns the card keeps its row, or takes the last one of a shorter column, as on a Linear board.
  const next = columns[column + step.column]
  return next?.[Math.min(row, next.length - 1)]
}

function move(event: KeyboardEvent, moveContext: RovingFocusMoveContext) {
  const card = target(event, moveContext)
  card?.el.scrollIntoView({ block: "nearest", inline: "nearest" })
  return card?.key
}

/**
 * One tab stop for a board's cards, on UI SDK's roving focus: ←/→ move between columns keeping the row (the
 * last card of a shorter column), ↑/↓ and j/k within a column, Home/End to a column's ends and Ctrl/⌘ with them
 * to the board's. Enter opens a card whose part isn't a link or button. A move changes two cards.
 */
const boardNavigation = definePrimitive({
  name: "board-navigation",
  options: { onOpen: "callback" },
  state: (_options: BoardNavigationOptions) => ({ active: null as string | null }),
  api: (context) => {
    const roving = createRovingFocus(context, { slot: "card", key: "active", move })
    return {
      roving,
      keydown(event: KeyboardEvent, el: HTMLElement, id: string) {
        if (event.defaultPrevented || event.target !== el) return
        if (roving.keydown(event, el)) {
          event.preventDefault()
          return
        }
        const { onOpen } = context.options()
        if (event.key === "Enter" && onOpen && !isActivator(el)) {
          event.preventDefault()
          onOpen(id, event)
        }
      },
      /** Gives a card the tab stop without moving focus, like when focus lands on one of its own controls. */
      activate: (id: string) => context.store.set({ active: id }),
      active: () => context.store.get().active,
    }
  },
  slots: (slot) => ({
    root: slot({}),
    card: slot<{ value: string }>({
      props: { value: "string" },
      // Only the card losing and the one taking `active` hear a move; before the board is entered every card may
      // claim the stop, so all hear `null`.
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
  // Keys are a people-only accelerator: agents select and act on cards through the board's own parts and actions.
  agent: { actions: [], shown: () => false },
})

export { boardNavigation }
export type { BoardNavigationOptions }
