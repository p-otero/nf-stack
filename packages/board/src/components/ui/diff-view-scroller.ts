import type { Virtualizer } from "@ui-sdk/core"

import { layersBesideViewport, windowScroller } from "@/components/ui/scroll-area-layers"

/** In the scroller's pixels. */
type DiffScroll = { top: () => number; height: () => number }

function scrollingAncestor(el: HTMLElement) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") return node
  }
  return null
}

function scrollsWithAncestor(viewport: HTMLElement) {
  if (viewport.dataset.height !== "auto") return false
  const root = viewport.closest<HTMLElement>("[data-slot=diff-view]")
  return !root || getComputedStyle(root).maxHeight === "none"
}

/**
 * A diff sized to its content (and not capped by `--diff-max-height`) scrolls with its nearest scrolling ancestor, or
 * the window, with its offset in it as the scroll margin, read again before each scroll and on a resize.
 */
function connectDiffScroll(
  viewport: HTMLElement,
  virtual: Virtualizer,
  findable: boolean,
  setMargin: (margin: number) => void,
): { scroll: DiffScroll; disconnect: () => void } {
  if (!scrollsWithAncestor(viewport)) {
    setMargin(0)
    const restore = layersBesideViewport(viewport)
    const disconnect = virtual.connect(viewport, { findable })
    return {
      scroll: { top: () => viewport.scrollTop, height: () => viewport.clientHeight },
      disconnect: () => {
        disconnect()
        restore()
      },
    }
  }
  const view = viewport.ownerDocument.defaultView ?? globalThis.window
  const scroller = scrollingAncestor(viewport)
  const offset = () => {
    const top = viewport.getBoundingClientRect().top + viewport.clientTop
    if (!scroller) return top + view.scrollY
    return top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
  }
  let margin = offset()
  const follow = () => {
    margin = offset()
    setMargin(margin)
  }
  follow()
  const events: HTMLElement | Window = scroller ?? view
  events.addEventListener("scroll", follow, { passive: true })
  const restore = scroller ? layersBesideViewport(scroller) : () => {}
  const disconnect = virtual.connect(scroller ?? windowScroller(view), { findable })
  const onResize = () => {
    follow()
    virtual.refresh()
  }
  const resize = scroller && typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : undefined
  if (scroller) resize?.observe(scroller)
  if (!scroller) view.addEventListener("resize", onResize)
  const top = scroller ? () => scroller.scrollTop : () => view.scrollY
  const height = scroller ? () => scroller.clientHeight : () => view.innerHeight
  return {
    scroll: { top: () => top() - margin, height },
    disconnect: () => {
      resize?.disconnect()
      view.removeEventListener("resize", onResize)
      events.removeEventListener("scroll", follow)
      disconnect()
      restore()
    },
  }
}

export { connectDiffScroll }
export type { DiffScroll }
