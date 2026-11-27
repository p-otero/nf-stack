import { definePrimitive, dispatch, type ChangeDetails } from "@ui-sdk/core"

import { settled, unavailable } from "@/lib/action-refusal"
import type { createInputController } from "@ui-sdk/core/input"

type SearchFieldInput = Pick<ReturnType<typeof createInputController>, "getValue" | "clear" | "focus">

type SearchFieldOptions = {
  input?: SearchFieldInput
  onSearch?: (query: string, details: ChangeDetails<"submit">) => void
}

const searchField = definePrimitive({
  name: "search-field",
  options: { input: "value", onSearch: "callback" },
  state: (options: SearchFieldOptions) => ({ searchable: Boolean(options.onSearch) }),
  sync: (options) => ({ searchable: Boolean(options.onSearch) }),
  api: (context) => ({
    clear() {
      const input = context.options().input
      if (!input || input.getValue() === "") return false
      const cleared = input.clear()
      input.focus()
      return cleared
    },
    submit(event?: Event) {
      const input = context.options().input
      if (!input) return unavailable("submit", "isn't available: the field isn't ready", { event })
      return settled(!dispatch(context, "onSearch", input.getValue(), { reason: "submit", event }), "submit", { event })
    },
  }),
  slots: (slot) => ({
    root: slot({
      role: "search",
      attrs: (state) => ({ "data-searchable": state.searchable ? "" : undefined }),
      on: {
        keydown: (event, { api }) => {
          const keyboard = event as KeyboardEvent
          if (!(keyboard.target instanceof HTMLInputElement)) return
          if (keyboard.key === "Escape") {
            // An empty field lets Escape bubble, so an enclosing dialog or popover can still close.
            if (api.clear()) {
              keyboard.preventDefault()
              keyboard.stopPropagation()
            }
          } else if (keyboard.key === "Enter" && !keyboard.isComposing) {
            keyboard.preventDefault()
            api.submit(keyboard)
          }
        },
      },
    }),
  }),
  agent: { actions: ["submit"], shown: (state) => state.searchable },
})

export { searchField }
export type { SearchFieldInput, SearchFieldOptions }
