import {
  createChange,
  createRovingFocus,
  definePrimitive,
  selects,
  type ChangeDetails,
  type ChangeOptions,
  type RovingFocusMoveContext,
} from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { rowsPerPage } from "@/components/ui/row-navigation-primitive"

/** Why the selected row changed: a press on its primary cell, an arrow key in the primary column, or a call. */
type ListGridValueChangeReason = "item-press" | "list-navigation" | "imperative"

type ListGridOptions = {
  /** Every row's id in order, including rows a virtualized list hasn't rendered. */
  ids?: readonly string[]
  /** How many cells a row has: its primary cell and one per action. */
  cells?: (id: string) => number
  /** Rows can be selected: the row holds `aria-selected`, and arrows in the primary column select. */
  selectable?: boolean
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (id: string | null, details: ChangeDetails<ListGridValueChangeReason>) => void
  /** The rows as agents see them. */
  entries?: readonly { value: string; label: string }[]
  /** Space or `x` on a row's primary cell, where rows can be checked. */
  onToggle?: (id: string, event: KeyboardEvent) => void
  /** Brings a row that isn't rendered into view, so focus can follow once it renders. */
  reveal?: (id: string) => void
}

/** A cell's key: its column, then its row's id, which may hold any character. */
const cellKey = (id: string, col: number) => `${String(col)}:${id}`

function parseCell(key: string) {
  const at = key.indexOf(":")
  return { col: Number(key.slice(0, at)), id: key.slice(at + 1) }
}

function reasonOf(options: unknown): { reason: ListGridValueChangeReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<ListGridValueChangeReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

type Step = { rows: number | "first" | "last"; col: number | "first" | "last" | "keep" }

function stepOf(event: KeyboardEvent, el: HTMLElement): Step | undefined {
  if (event.altKey || event.shiftKey) return undefined
  const mod = event.ctrlKey || event.metaKey
  if (event.key === "Home") return mod ? { rows: "first", col: "first" } : { rows: 0, col: "first" }
  if (event.key === "End") return mod ? { rows: "last", col: "last" } : { rows: 0, col: "last" }
  if (mod) return undefined
  // Left and Right follow the text direction.
  const forward = getComputedStyle(el).direction === "rtl" ? -1 : 1
  switch (event.key) {
    case "ArrowDown":
    case "j":
      return { rows: 1, col: "keep" }
    case "ArrowUp":
    case "k":
      return { rows: -1, col: "keep" }
    case "ArrowRight":
      return { rows: 0, col: forward }
    case "ArrowLeft":
      return { rows: 0, col: -forward }
    case "PageDown":
      return { rows: rowsPerPage(el), col: "keep" }
    case "PageUp":
      return { rows: -rowsPerPage(el), col: "keep" }
    default:
      return undefined
  }
}

/**
 * An APG layout grid of a List's rows: a primary cell and one per action, one tab stop. Up/Down (j/k) keep the
 * column up to a row's last cell, Left/Right move within a row; rows can differ in how many actions they have.
 * Selectable, only the primary column selects: an arrow onto it or a press on it, never an action cell.
 */
const listGrid = definePrimitive({
  name: "list-grid",
  options: {
    ids: "list",
    cells: "value",
    selectable: "boolean",
    value: "value",
    defaultValue: "value",
    onValueChange: "callback",
    entries: "value",
    onToggle: "callback",
    reveal: "callback",
  },
  state: (options: ListGridOptions) => ({
    active: null as string | null,
    value: options.value !== undefined ? options.value : (options.defaultValue ?? null),
    selectable: options.selectable ?? false,
  }),
  sync: (options) => ({
    selectable: options.selectable ?? false,
    ...(options.value === undefined ? {} : { value: options.value }),
  }),
  controlled: ["value"],
  api: (context) => {
    const change = createChange(context)
    const entries = () => context.options().entries ?? []
    const cellsOf = (id: string) => Math.max(1, context.options().cells?.(id) ?? 1)

    const move = (event: KeyboardEvent, { from, items }: RovingFocusMoveContext) => {
      const step = stepOf(event, from.el)
      if (step === undefined) return undefined
      const ids = context.options().ids ?? [...new Set(items.map((item) => parseCell(item.key).id))]
      if (ids.length === 0) return undefined
      const at = parseCell(from.key)
      const index = Math.max(0, ids.indexOf(at.id))
      let row: number
      if (step.rows === "first") row = 0
      else if (step.rows === "last") row = ids.length - 1
      else row = Math.min(ids.length - 1, Math.max(0, index + step.rows))
      const id = ids[row]
      if (id === undefined) return undefined
      const last = cellsOf(id) - 1
      let col: number
      if (step.col === "first") col = 0
      else if (step.col === "last") col = last
      else if (step.col === "keep") col = Math.min(at.col, last)
      else col = Math.min(last, Math.max(0, at.col + step.col))
      const key = cellKey(id, col)
      const rendered = items.find((item) => item.key === key)
      if (rendered) rendered.el.scrollIntoView({ block: "nearest", inline: "nearest" })
      else context.options().reveal?.(id)
      return key
    }
    const selectedCell = () => {
      const { selectable, value } = context.store.get()
      return selectable && value !== null ? cellKey(value, 0) : null
    }
    const roving = createRovingFocus(context, {
      slot: "cell",
      key: "active",
      move,
      preferred: (item) => item.key === selectedCell(),
      claims: (state, item) =>
        !state.selectable || state.value === null
          ? parseCell(item.key).col === 0
          : item.key === cellKey(state.value, 0),
    })

    const setValue = (id: unknown, options?: ChangeOptions<ListGridValueChangeReason>) => {
      const details = reasonOf(options)
      if (!context.store.get().selectable) {
        throw new Error("Rows of this list can't be selected; open one through its own link or button.")
      }
      if (id !== null && (typeof id !== "string" || !entries().some((entry) => entry.value === id))) {
        throw new RangeError(
          `No row "${String(id)}". Rows: ${entries()
            .map((entry) => entry.value)
            .join(", ")}.`,
        )
      }
      if (context.store.get().value === id) return true
      return settled(change("value", id as string | null, details), "setValue", details)
    }

    return {
      roving,
      setValue,
      keydown(event: KeyboardEvent, el: HTMLElement, key: string) {
        if (event.defaultPrevented || event.target !== el) return
        if (roving.keydown(event, el)) {
          event.preventDefault()
          const to = context.store.get().active
          if (!context.store.get().selectable || to === null || to === key) return
          const target = parseCell(to)
          // Selection follows focus in the primary column only: moving through actions never selects.
          if (target.col === 0 && target.id !== parseCell(key).id) {
            setValue(target.id, { reason: "list-navigation", event })
          }
          return
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const { col, id } = parseCell(key)
        const onToggle = context.options().onToggle
        if (col === 0 && onToggle && (event.key === " " || event.key === "x")) {
          event.preventDefault()
          onToggle(id, event)
        }
      },
      focus: (id: string, col = 0) => roving.focus(cellKey(id, col)),
      items: () => entries(),
    }
  },
  slots: (slot) => ({
    root: slot({ role: "grid", keys: { none: "its cells move focus" } }),
    row: slot<{ value: string }>({
      props: { value: "string" },
      selects: selects({ value: ({ key }) => [key] }),
      // Not selectable, the row keeps the `data-selected` its item gives it for the open row.
      role: "row",
      attrs: (state, { key }) =>
        state.selectable
          ? { "aria-selected": String(state.value === key), "data-selected": state.value === key ? "" : undefined }
          : {},
    }),
    cell: slot<{ value: string }>({
      props: { value: "string" },
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
        "j",
        "k",
      ],
      // Only the cell losing the stop and the one taking it hear a move; while nothing is active every cell may
      // claim it, so all hear `null`.
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
  agent: { actions: ["setValue"], items: (api) => api.items(), shown: (state) => state.selectable },
})

export { cellKey, listGrid }
export type { ListGridOptions, ListGridValueChangeReason }
