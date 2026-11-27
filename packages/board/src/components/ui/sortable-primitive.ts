import {
  createChange,
  createReorder,
  createRovingFocus,
  createSelection,
  definePrimitive,
  idPart,
  type ChangeDetails,
  type ChangeOptions,
  type ReorderDraft,
  type ReorderOrientation,
  type ReorderReason,
} from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { sortableLabels, type SortableLabels } from "@/components/ui/sortable-labels"
import { isStringArray } from "@/lib/narrow"

type SortableReason = ReorderReason
type SortableSelectReason = "item-press" | "imperative"
type SortableAutoScroll = false | { edge?: number; speed?: number }

type SortableOptions = {
  value?: readonly string[]
  defaultValue?: readonly string[]
  /** Runs once per drop or move, with the whole new order; `details.cancel()` keeps the old one. */
  onValueChange?: (value: string[], details: ChangeDetails<SortableReason>) => void
  orientation?: ReorderOrientation
  /** Items move by their `SortableHandle` only, so the rest of an item, like its buttons, stays clickable. */
  handle?: boolean
  /** Items that move together when one of them is picked up. Ctrl or Cmd and a press toggle one, Shift extends. */
  selected?: readonly string[]
  defaultSelected?: readonly string[]
  onSelectedChange?: (selected: string[], details: ChangeDetails<SortableSelectReason>) => void
  /** Items that can't be picked up; they still make room for others. */
  disabledKeys?: readonly string[]
  /** Drags a copy above the page, so a scrolling list neither clips the item nor grows under it. Read on mount. */
  preview?: boolean
  /** Edge scrolling during a `preview` drag; `false` turns it off. Read on mount. */
  autoScroll?: SortableAutoScroll
  /** An item's name for announcements and agents; its text by default. */
  itemLabel?: (key: string) => string | undefined
  labels?: Partial<SortableLabels>
  /** Whether agents get `move` and `reorder`. A host that offers its own, confirmed action turns these off. */
  agentMoves?: boolean
}

const asList = (value: readonly string[] | undefined) => (value ? [...value] : undefined)

function checkOrder(next: unknown, current: readonly string[]): string[] {
  if (!isStringArray(next)) throw new TypeError("reorder takes the full list of item ids, in their new order.")
  const keys = next
  const missing = current.filter((key) => !keys.includes(key))
  const unknown = keys.filter((key) => !current.includes(key))
  if (missing.length > 0 || unknown.length > 0 || new Set(keys).size !== keys.length) {
    throw new RangeError(`reorder takes each of these ids once: ${current.join(", ")}.`)
  }
  return keys
}

function reasonOf(options: unknown): { reason: SortableReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<SortableReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const textOf = (el: HTMLElement | undefined) => el?.textContent?.replaceAll(/\s+/g, " ").trim() || undefined

// What the parts render, copied from the options so attributes read only state, on the server too.
function shown(options: SortableOptions) {
  return {
    handle: options.handle ?? false,
    orientation: options.orientation ?? ("vertical" as ReorderOrientation),
    agentMoves: options.agentMoves ?? true,
    preview: options.preview ?? false,
    disabledKeys: options.disabledKeys ?? ([] as readonly string[]),
    labels: { ...sortableLabels, ...options.labels },
    itemLabel: options.itemLabel,
  }
}

const sortable = definePrimitive({
  name: "sortable",
  options: {
    value: "list",
    defaultValue: "list",
    onValueChange: "callback",
    orientation: "string",
    handle: "boolean",
    selected: "list",
    defaultSelected: "list",
    onSelectedChange: "callback",
    disabledKeys: "list",
    preview: "boolean",
    autoScroll: "value",
    itemLabel: "value",
    labels: "value",
    agentMoves: "boolean",
  },
  controlled: ["value", "selected"],
  state: (options: SortableOptions) => ({
    value: asList(options.value ?? options.defaultValue) ?? [],
    selected: asList(options.selected ?? options.defaultSelected) ?? [],
    moving: null as ReorderDraft | null,
    focused: null as string | null,
    ...shown(options),
  }),
  sync: (options) => ({
    ...(options.value === undefined ? {} : { value: [...options.value] }),
    ...(options.selected === undefined ? {} : { selected: [...options.selected] }),
    ...shown(options),
  }),
  api: (context) => {
    const change = createChange(context)
    const labels = () => context.store.get().labels
    const disabled = (key: string) => context.store.get().disabledKeys.includes(key)
    const selection = createSelection(context, {
      key: "selected",
      set: (value, details) => change("selected", value, details),
      order: () => context.store.get().value,
      multiple: () => true,
    })
    const roving = createRovingFocus(context, {
      slot: "entry",
      key: "focused",
      orientation: () => (context.store.get().orientation === "horizontal" ? "horizontal" : "vertical"),
    })
    const handles = createRovingFocus(context, {
      slot: "handle",
      key: "focused",
      orientation: () => (context.store.get().orientation === "horizontal" ? "horizontal" : "vertical"),
    })
    const autoScroll = context.options().autoScroll
    const reorder = createReorder(context, {
      slot: "entry",
      key: "value",
      draft: "moving",
      set: (value, details) => change("value", value, details),
      orientation: () => context.store.get().orientation,
      group: (key) => {
        const { selected } = context.store.get()
        return selected.includes(key) ? selected : [key]
      },
      preview: context.options().preview ?? false,
      createAutoScroll: autoScroll === false ? false : { edge: 40, speed: 14, ...autoScroll },
      disabled: ({ key }) => disabled(key),
      label: (key) => context.options().itemLabel?.(key) ?? textOf(itemElement(key)),
      message: (message) => labels().message(message),
    })
    const itemElement = (key: string) => roving.items().find((item) => item.key === key)?.el
    const labelOf = (key: string) => context.options().itemLabel?.(key) ?? textOf(itemElement(key)) ?? key
    const check = (key: unknown) => {
      const { value } = context.store.get()
      if (typeof key !== "string" || !value.includes(key)) {
        throw new RangeError(`No item "${String(key)}". Items: ${value.join(", ")}.`)
      }
      return key
    }

    return {
      drag: reorder,
      roving,
      handles,
      selection,
      labels,
      disabled,
      /** Moves one item to `index` in the order, counting from 0, as a "Move to top" menu item would. */
      move(key: unknown, index: unknown) {
        const id = check(key)
        const { value } = context.store.get()
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= value.length) {
          throw new RangeError(`move takes an index from 0 to ${String(value.length - 1)}.`)
        }
        if (disabled(id)) throw new Error(`Item "${id}" can't be moved.`)
        const { selected } = context.store.get()
        const alone = !selected.includes(id) || selected.length === 1
        if (alone && value.indexOf(id) === index) return true
        return settled(reorder.move(id, index), "move")
      },
      /** Replaces the whole order at once. */
      reorder(order: unknown, options?: ChangeOptions<SortableReason>) {
        const { value } = context.store.get()
        const next = checkOrder(order, value)
        const moved = next.filter((key, index) => key !== value[index] && disabled(key))
        if (moved.length > 0) throw new Error(`Items can't be moved: ${moved.join(", ")}.`)
        return settled(change("value", next, reasonOf(options)), "reorder", reasonOf(options))
      },
      press(event: PointerEvent, key: string) {
        const why = { reason: "item-press" as const, event }
        if (event.shiftKey) selection.extend(key, { ...why, from: context.store.get().focused })
        else if (event.metaKey || event.ctrlKey) selection.toggle(key, why)
      },
      keydown(event: KeyboardEvent, key: string, el: HTMLElement, focus: typeof roving) {
        if (event.key === " " && (event.ctrlKey || event.metaKey) && !context.store.get().moving) {
          event.preventDefault()
          selection.toggle(key, { reason: "item-press", event })
          return
        }
        if (!reorder.keydown(event, key)) focus.keydown(event, el)
      },
      items: () => context.store.get().value.map((key) => ({ value: key, label: labelOf(key) })),
    }
  },
  slots: (slot) => ({
    root: slot<object, { order: string[]; moving: boolean }>({
      role: (state) => (state.handle ? "list" : "listbox"),
      roles: ["list", "listbox"],
      keys: { none: "Each item or handle handles its own keys." },
      state: (state, { api }) => ({ order: api.drag.order(state), moving: state.moving !== null }),
      attrs: (state) => ({
        "aria-roledescription": state.labels.list,
        "aria-orientation": state.handle || state.orientation === "grid" ? undefined : state.orientation,
        "aria-multiselectable": state.handle ? undefined : "true",
        "data-orientation": state.orientation,
        "data-preview": state.preview ? "" : undefined,
        "data-handle": state.handle ? "" : undefined,
        "data-moving": state.moving ? "" : undefined,
        "data-dragging": state.moving?.pointer ? "" : undefined,
      }),
    }),
    entry: slot<{ value: string }, { moving: boolean; dragging: boolean; selected: boolean }>({
      props: { value: "string" },
      role: (state) => (state.handle ? "listitem" : "option"),
      roles: ["listitem", "option"],
      focus: (state) => (state.handle ? { none: "Its handle takes focus." } : "roving"),
      press: { none: "Space and Enter pick the item up on keydown; a click does nothing more." },
      keys: (state) =>
        state.handle ? [] : [" ", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"],
      state: (state, { api, key }) => ({
        moving: api.drag.moving(state, key),
        dragging: api.drag.dragging(state, key),
        selected: state.selected.includes(key),
      }),
      attrs: (state, { api, key, id }) => {
        const moving = api.drag.moving(state, key)
        return {
          "aria-roledescription": state.handle ? undefined : state.labels.item,
          "aria-selected": state.handle ? undefined : String(state.selected.includes(key) || moving),
          "aria-describedby": state.handle ? undefined : `${id}-instructions`,
          "aria-disabled": state.disabledKeys.includes(key) ? "true" : undefined,
          tabindex: state.handle ? undefined : api.roving.tabIndex(state, { key, props: { value: key } }),
          "data-sortable-item": idPart(key),
          "data-moving": moving ? "" : undefined,
          "data-grabbed": api.drag.dragging(state, key) ? "" : undefined,
          "data-checked": state.selected.includes(key) ? "" : undefined,
          "data-disabled": state.disabledKeys.includes(key) ? "" : undefined,
        }
      },
      on: {
        keydown: (event, { el, api, key, store }) => {
          if (store.get().handle || !el || event.target !== el) return
          api.keydown(event, key, el, api.roving)
        },
        pointerdown: (event, { api, key, store }) => {
          if (store.get().handle || event.button !== 0) return
          api.press(event, key)
          api.drag.pointerdown(event, key)
        },
      },
      bind: (el, part) => {
        const cleanups = [part.api.roving.bind(el, part), part.api.drag.bind(el, part)]
        return () => cleanups.forEach((cleanup) => cleanup())
      },
    }),
    handle: slot<{ value: string }>({
      props: { value: { kind: "string", from: "entry", required: true } },
      role: "button",
      focus: "roving",
      press: { none: "Space and Enter pick the item up on keydown; a press alone does nothing." },
      attrs: (state, { api, key, id }) => {
        const moving = api.drag.moving(state, key)
        return {
          type: "button",
          "aria-label": state.labels.handle(state.itemLabel?.(key) ?? key),
          "aria-roledescription": state.labels.item,
          "aria-describedby": `${id}-instructions`,
          "aria-pressed": String(moving),
          "aria-disabled": state.disabledKeys.includes(key) ? "true" : undefined,
          tabindex: api.handles.tabIndex(state, { key, props: { value: key } }),
          "data-moving": moving ? "" : undefined,
        }
      },
      on: {
        keydown: (event, { el, api, key }) => {
          if (el) api.keydown(event, key, el, api.handles)
        },
        pointerdown: (event, { api, key }) => {
          if (event.button !== 0) return
          api.press(event, key)
          api.drag.pointerdown(event, key)
        },
      },
      bind: (el, part) => part.api.handles.bind(el, part),
    }),
    instructions: slot({
      attrs: (_state, { id }) => ({ id: `${id}-instructions`, hidden: "" }),
    }),
  }),
  agent: {
    actions: ["move", "reorder"],
    items: (api) => api.items(),
    shown: (state) => state.agentMoves,
  },
})

export { sortable }
export type { SortableAutoScroll, SortableOptions, SortableReason, SortableSelectReason }
