import { definePrimitive, dispatch, type ChangeDetails } from "@ui-sdk/core"

import { unavailable } from "@/lib/action-refusal"

type CodeBlockCopyDetails = ChangeDetails<"copy">

type CodeBlockOptions = {
  text?: string
  onCopy?: (text: string, details: CodeBlockCopyDetails) => void
}

const COPIED_FOR = 2000

const codeBlock = definePrimitive({
  name: "code-block",
  options: { text: "string", onCopy: "callback" },
  state: (options: CodeBlockOptions) => ({ value: options.text ?? "", copied: false }),
  sync: (options) => ({ value: options.text ?? "" }),
  api: (context) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    context.onDestroy(() => clearTimeout(timer))
    let text = context.options().text
    context.onOptions((options) => {
      if (options.text === text) return
      text = options.text
      clearTimeout(timer)
      context.store.set({ copied: false })
    })
    return {
      /** Where the page has no clipboard access, a press gets `false`. */
      copy(event?: Event) {
        const code = context.options().text ?? ""
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
        if (!clipboard) return unavailable("copy", "isn't available: the page has no clipboard access", { event })
        return clipboard.writeText(code).then(
          () => {
            clearTimeout(timer)
            context.store.set({ copied: true })
            timer = setTimeout(() => context.store.set({ copied: false }), COPIED_FOR)
            dispatch(context, "onCopy", code, { reason: "copy", event })
            return true
          },
          () => unavailable("copy", "was blocked by the browser", { event }),
        )
      },
    }
  },
  slots: (slot) => ({
    root: slot<{}, { copied: boolean }>({
      state: (state) => ({ copied: state.copied }),
      attrs: (state) => ({ role: "group", "data-copied": state.copied ? "" : undefined }),
    }),
  }),
  agent: { actions: ["copy"] },
})

export { codeBlock }
export type { CodeBlockCopyDetails, CodeBlockOptions }
