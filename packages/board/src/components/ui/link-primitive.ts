import { definePrimitive, dispatch, type ChangeDetails } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"

type LinkFollowDetails = ChangeDetails<"follow">

type LinkOptions = {
  href?: string
  onFollow?: (href: string, details: LinkFollowDetails) => void
}

function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function isModifiedLinkPress(event: Event | undefined) {
  return (
    event instanceof MouseEvent &&
    !isPlainClick(event) &&
    event.target instanceof Element &&
    event.target.closest("a[href]") !== null
  )
}

const link = definePrimitive({
  name: "link",
  options: { href: "string", onFollow: "callback" },
  state: (options: LinkOptions) => ({ value: options.href ?? "" }),
  sync: (options) => ({ value: options.href ?? "" }),
  api: (context) => ({
    follow(event?: Event) {
      const { href = "" } = context.options()
      return settled(!dispatch(context, "onFollow", href, { reason: "follow", event }), "follow", { event })
    },
  }),
  slots: (slot) => ({
    root: slot({
      on: {
        click: (event, { api }) => {
          const mouse = event as MouseEvent
          if (mouse.defaultPrevented || !isPlainClick(mouse)) return
          mouse.preventDefault()
          api.follow(mouse)
        },
      },
    }),
  }),
  agent: { actions: ["follow"] },
})

export { isModifiedLinkPress, isPlainClick, link }
export type { LinkFollowDetails, LinkOptions }
