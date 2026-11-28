import { createChange, definePrimitive, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled, unavailable } from "@/lib/action-refusal"
import { isElementOf } from "@/lib/narrow"

type LightboxIndexChangeReason = "item-press" | "list-navigation" | "imperative"

type LightboxOptions = {
  index?: number
  count?: number
  onIndexChange?: (index: number, details: ChangeDetails<LightboxIndexChangeReason>) => void
  /** The items as agents see them; `value` is the index as text. */
  entries?: readonly { value: string; label: string }[]
}

function reasonOf(options: unknown): { reason: LightboxIndexChangeReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<LightboxIndexChangeReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

function isRtl(element: Element) {
  return getComputedStyle(element).direction === "rtl"
}

const lightbox = definePrimitive({
  name: "lightbox",
  options: { index: "number", count: "number", onIndexChange: "callback", entries: "value" },
  controlled: ["index"],
  state: (options: LightboxOptions) => ({ index: options.index ?? 0, count: options.count ?? 0 }),
  sync: (options) => ({
    ...(options.index === undefined ? {} : { index: options.index }),
    ...(options.count === undefined ? {} : { count: options.count }),
  }),
  api: (context) => {
    const change = createChange(context)
    const move = (index: number, action: string, options: unknown) => {
      const { count, index: current } = context.store.get()
      if (index === current) return true
      if (index < 0) return unavailable(action, "isn't available on the first item", reasonOf(options))
      if (index >= count) return unavailable(action, "isn't available on the last item", reasonOf(options))
      return settled(change("index", index, reasonOf(options)), action, reasonOf(options))
    }
    return {
      goTo(indexOrText: unknown, options?: ChangeOptions<LightboxIndexChangeReason>) {
        const target = typeof indexOrText === "string" && indexOrText.trim() !== "" ? Number(indexOrText) : indexOrText
        const { count } = context.store.get()
        if (typeof target !== "number" || !Number.isInteger(target) || target < 0 || target >= count) {
          throw new RangeError(`goTo takes an index from 0 to ${count - 1}.`)
        }
        return move(target, "goTo", options)
      },
      next: (options?: ChangeOptions<LightboxIndexChangeReason>) =>
        move(context.store.get().index + 1, "next", options),
      previous: (options?: ChangeOptions<LightboxIndexChangeReason>) =>
        move(context.store.get().index - 1, "previous", options),
      entries: () => context.options().entries ?? [],
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "group",
      attrs: (state) => ({
        "data-first": state.index <= 0 ? "" : undefined,
        "data-last": state.index >= state.count - 1 ? "" : undefined,
      }),
      on: {
        keydown: (event, { api }) => {
          const keyboard = event as KeyboardEvent
          if (keyboard.defaultPrevented || keyboard.altKey || keyboard.ctrlKey || keyboard.metaKey) return
          if (keyboard.key !== "ArrowLeft" && keyboard.key !== "ArrowRight") return
          const target = keyboard.currentTarget
          const forward = (keyboard.key === "ArrowRight") !== (isElementOf(target, "Element") && isRtl(target))
          const options = { reason: "list-navigation" as const, event: keyboard }
          if (forward ? api.next(options) : api.previous(options)) keyboard.preventDefault()
        },
      },
    }),
  }),
  agent: { actions: ["next", "previous", "goTo"], items: (api) => api.entries() },
})

export { lightbox }
export type { LightboxIndexChangeReason, LightboxOptions }
