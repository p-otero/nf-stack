import { definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"

type ListSelectReason = "item-press" | "imperative"

type ListEntry = { value: string; label: string }

type ListOptions = {
  /** The rows as agents see them, collected from the rendered items. */
  entries?: readonly ListEntry[]
  /** Runs before a row is chosen, by a person or an agent; `details.cancel()` stops it. */
  onSelect?: (id: string, details: ChangeDetails<ListSelectReason>) => void
  /** What choosing a row does once `onSelect` allowed it, when no event will do it natively. */
  activate?: (id: string) => boolean
}

function reasonOf(options: unknown): { reason: ListSelectReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<ListSelectReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const list = definePrimitive({
  name: "list",
  options: { entries: "value", onSelect: "callback", activate: "value" },
  state: (options: ListOptions) => ({ count: options.entries?.length ?? 0 }),
  sync: (options) => ({ count: options.entries?.length ?? 0 }),
  api: (context) => {
    const entries = () => context.options().entries ?? []
    return {
      select(id: unknown, options?: ChangeOptions<ListSelectReason>) {
        const row = entries().find((entry) => entry.value === id)
        if (!row) {
          const ids = entries().map((entry) => entry.value)
          throw new RangeError(`No row "${String(id)}". Rows: ${ids.join(", ")}.`)
        }
        const details = reasonOf(options)
        if (dispatch(context, "onSelect", row.value, details)) return settled(false, "select", details)
        const pressAlreadyActivatedRow = Boolean(details.event)
        if (pressAlreadyActivatedRow) return true
        return context.options().activate?.(row.value) ?? true
      },
      entries,
    }
  },
  slots: (slot) => ({
    root: slot({ attrs: (state) => ({ "data-count": String(state.count) }) }),
  }),
  agent: { actions: ["select"], items: (api) => api.entries() },
})

export { list }
export type { ListEntry, ListOptions, ListSelectReason }
