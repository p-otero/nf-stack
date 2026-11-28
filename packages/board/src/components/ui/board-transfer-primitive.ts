import {
  createChange,
  createRovingFocus,
  createTransfer,
  definePrimitive,
  idPart,
  type ChangeDetails,
  type TransferDraft,
  type TransferLists,
  type TransferReason,
} from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { transferLabels, type TransferLabels } from "@/components/ui/sortable-labels"

type BoardMove = { key: string; from: string; to: string; index: number }
type BoardTransferChangeDetails = ChangeDetails<TransferReason> & BoardMove
type BoardTransferAutoScroll = false | { edge?: number; speed?: number }

type BoardTransferOptions = {
  value?: TransferLists
  defaultValue?: TransferLists
  /** Runs once per drop or move with every list; `details` says which card went where. */
  onValueChange?: (value: TransferLists, details: BoardTransferChangeDetails) => void
  /** The lists in the order Left and Right go through them; the value's keys by default. */
  order?: readonly string[]
  /** Whether a list takes a card, like a column at its limit; lists that don't are skipped. */
  accepts?: (key: string, list: string) => boolean
  /** Cards that can't be picked up. */
  disabledKeys?: readonly string[]
  /** Cards move by their `BoardItemHandle` only, so the card's own buttons stay clickable. */
  handle?: boolean
  /**
   * `roving` (default): the handles are one tab stop with arrow keys between them. `card`: each handle is a plain
   * control of its card, for cards that are already one tab stop of the board's own (a `TaskCard`).
   */
  handleFocus?: "roving" | "card"
  /** How a drag near the board's or a column's edge scrolls it; `false` turns it off. Read on mount. */
  autoScroll?: BoardTransferAutoScroll
  itemLabel?: (key: string) => string | undefined
  listLabel?: (list: string) => string | undefined
  labels?: Partial<TransferLabels>
  /** Whether agents get `move`. A host that offers its own, confirmed action turns it off. */
  agentMoves?: boolean
}

const textOf = (el: Element | null | undefined) => el?.textContent?.replaceAll(/\s+/g, " ").trim() || undefined

function copyLists(lists: TransferLists | undefined): TransferLists {
  return Object.fromEntries(Object.entries(lists ?? {}).map(([list, keys]) => [list, [...keys]]))
}

function renderedStateOf(options: BoardTransferOptions) {
  return {
    handle: options.handle ?? false,
    handleFocus: options.handleFocus ?? ("roving" as "roving" | "card"),
    agentMoves: options.agentMoves ?? true,
    disabledKeys: options.disabledKeys ?? ([] as readonly string[]),
    labels: { ...transferLabels, ...options.labels },
    itemLabel: options.itemLabel,
  }
}

const boardTransfer = definePrimitive({
  name: "board-transfer",
  options: {
    value: "value",
    defaultValue: "value",
    onValueChange: "callback",
    order: "list",
    accepts: "value",
    disabledKeys: "list",
    handle: "boolean",
    handleFocus: "string",
    autoScroll: "value",
    itemLabel: "value",
    listLabel: "value",
    labels: "value",
    agentMoves: "boolean",
  },
  controlled: ["value"],
  state: (options: BoardTransferOptions) => ({
    value: copyLists(options.value ?? options.defaultValue),
    moving: null as TransferDraft | null,
    focused: null as string | null,
    ...renderedStateOf(options),
  }),
  sync: (options) => ({
    ...(options.value === undefined ? {} : { value: copyLists(options.value) }),
    ...renderedStateOf(options),
  }),
  api: (context) => {
    const change = createChange(context)
    const labels = () => context.store.get().labels
    const disabled = (key: string) => context.store.get().disabledKeys.includes(key)
    const order = () => [...(context.options().order ?? Object.keys(context.store.get().value))]
    const elementOf = (key: string) => focus.items().find((item) => item.key === key)?.el
    const itemLabel = (key: string) => context.options().itemLabel?.(key) ?? textOf(elementOf(key)) ?? key
    const listLabel = (list: string) => context.options().listLabel?.(list) ?? list
    const autoScroll = context.options().autoScroll
    const transfer = createTransfer(context, {
      key: "value",
      draft: "moving",
      set: (value, details) => change("value", value, details),
      order,
      accepts: (key, list) => context.options().accepts?.(key, list) ?? true,
      disabled,
      label: (key) => context.options().itemLabel?.(key) ?? textOf(elementOf(key)),
      listLabel: (list) => context.options().listLabel?.(list),
      message: (message) => labels().message(message),
      createAutoScroll: autoScroll === false ? false : { edge: 48, speed: 16, ...autoScroll },
    })
    const focus = createRovingFocus(context, { slot: "card", key: "focused", orientation: () => "both" })
    const handles = createRovingFocus(context, { slot: "handle", key: "focused", orientation: () => "both" })
    const listOf = (key: string) =>
      Object.entries(context.store.get().value).find(([, keys]) => keys.includes(key))?.[0]

    return {
      transfer,
      focus,
      handles,
      labels,
      disabled,
      itemLabel,
      /** `index` counts from 0 in `list`; the card moves at once. */
      move(key: unknown, list: unknown, index?: unknown) {
        const lists = context.store.get().value
        const id = typeof key === "string" ? key : undefined
        const from = id === undefined ? undefined : listOf(id)
        if (id === undefined || from === undefined) {
          const keys = Object.values(lists).flat()
          throw new RangeError(`No card "${String(key)}". Cards: ${keys.join(", ") || "none"}.`)
        }
        if (typeof list !== "string" || !(list in lists)) {
          throw new RangeError(`No list "${String(list)}". Lists: ${order().join(", ")}.`)
        }
        const size = lists[list]?.filter((each) => each !== id).length ?? 0
        const at = index === undefined ? size : index
        if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at > size) {
          throw new RangeError(`move takes an index from 0 to ${String(size)} in "${list}".`)
        }
        if (disabled(id)) throw new Error(`Card "${id}" can't be moved.`)
        if (list !== from && !(context.options().accepts?.(id, list) ?? true)) {
          throw new Error(`"${listLabel(list)}" doesn't take "${itemLabel(id)}".`)
        }
        if (list === from && lists[list]?.indexOf(id) === at) return true
        return settled(transfer.move(id, list, at), "move")
      },
      keydown(event: KeyboardEvent, key: string, el: HTMLElement, roving: typeof focus) {
        if (!transfer.keydown(event, key)) roving.keydown(event, el)
      },
      cards: () =>
        order().flatMap((list) =>
          (context.store.get().value[list] ?? []).map((key) => ({
            value: key,
            label: `${itemLabel(key)} (${listLabel(list)})`,
          })),
        ),
    }
  },
  slots: (slot) => ({
    root: slot<object, { lists: TransferLists; moving: boolean }>({
      role: "group",
      state: (state, { api }) => ({ lists: api.transfer.lists(state), moving: state.moving !== null }),
      attrs: (state) => ({
        "data-moving": state.moving ? "" : undefined,
        "data-dragging": state.moving?.pointer ? "" : undefined,
        "data-handle": state.handle ? "" : undefined,
      }),
    }),
    list: slot<{ value: string }>({
      props: { value: "string" },
      role: "list",
      attrs: (state, { key }) => ({
        "data-transfer-list": idPart(key),
        "data-target": state.moving && state.moving.lists[key]?.includes(state.moving.key) ? "" : undefined,
      }),
      bind: (el, part) => part.api.transfer.bindList(el, part.key),
    }),
    card: slot<{ value: string }, { moving: boolean; dragging: boolean }>({
      props: { value: "string" },
      role: "listitem",
      state: (state, { api, key }) => ({
        moving: api.transfer.moving(state, key),
        dragging: api.transfer.dragging(state, key),
      }),
      attrs: (state, { api, key, id }) => ({
        "aria-roledescription": state.handle ? undefined : state.labels.item,
        "aria-describedby": state.handle ? undefined : `${id}-instructions`,
        "aria-disabled": state.handle || !state.disabledKeys.includes(key) ? undefined : "true",
        tabindex: state.handle ? undefined : api.focus.tabIndex(state, { key, props: { value: key } }),
        "data-transfer-item": idPart(key),
        "data-moving": api.transfer.moving(state, key) ? "" : undefined,
        "data-grabbed": api.transfer.dragging(state, key) ? "" : undefined,
        "data-disabled": state.disabledKeys.includes(key) ? "" : undefined,
      }),
      on: {
        keydown: (event, { el, api, key, store }) => {
          if (store.get().handle || !el || event.target !== el) return
          api.keydown(event, key, el, api.focus)
        },
        pointerdown: (event, { api, key, store }) => {
          if (store.get().handle || event.button !== 0) return
          api.transfer.pointerdown(event, key)
        },
      },
      bind: (el, part) => {
        const cleanups = [part.api.focus.bind(el, part), part.api.transfer.bindItem(el, part.key)]
        return () => cleanups.forEach((cleanup) => cleanup())
      },
    }),
    handle: slot<{ value: string }>({
      props: { value: { kind: "string", from: "card", required: true } },
      role: "button",
      focus: (state) => (state.handleFocus === "card" ? "native" : "roving"),
      press: { none: "Space and Enter pick the card up on keydown; a press alone does nothing." },
      attrs: (state, { api, key, id }) => {
        const moving = api.transfer.moving(state, key)
        return {
          type: "button",
          "aria-label": state.labels.handle(state.itemLabel?.(key) ?? key),
          "aria-roledescription": state.labels.item,
          "aria-describedby": `${id}-instructions`,
          "aria-pressed": String(moving),
          "aria-disabled": state.disabledKeys.includes(key) ? "true" : undefined,
          tabindex:
            state.handleFocus === "card" ? undefined : api.handles.tabIndex(state, { key, props: { value: key } }),
          "data-moving": moving ? "" : undefined,
        }
      },
      on: {
        keydown: (event, { el, api, key, store }) => {
          if (store.get().handleFocus === "card") api.transfer.keydown(event, key)
          else if (el) api.keydown(event, key, el, api.handles)
        },
        pointerdown: (event, { api, key }) => {
          if (event.button === 0) api.transfer.pointerdown(event, key)
        },
      },
      bind: (el, part) => (part.store.get().handleFocus === "card" ? undefined : part.api.handles.bind(el, part)),
    }),
    instructions: slot({
      attrs: (_state, { id }) => ({ id: `${id}-instructions`, hidden: "" }),
    }),
  }),
  agent: {
    actions: ["move"],
    items: (api) => api.cards(),
    shown: (state) => state.agentMoves,
  },
})

export { boardTransfer }
export type { BoardMove, BoardTransferAutoScroll, BoardTransferChangeDetails, BoardTransferOptions }
