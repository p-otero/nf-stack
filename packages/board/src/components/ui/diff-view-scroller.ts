import type { Virtualizer } from "@ui-sdk/core"

import { layersBesideViewport, windowScroller } from "@/components/ui/scroll-area-layers"

/** Where a diff's rows are scrolled: the top of the view and its height, in the scroller's pixels. */
type DiffScroll = { top: () => number; height: () => number }

function scrollingAncestor(el: HTMLElement) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") return node
  }
  return null
}

/** A diff sized to its content scrolls with its nearest scrolling ancestor; one capped by `--diff-max-height` doesn't. */
function scrollsOutside(viewport: HTMLElement) {
  if (viewport.dataset.height !== "auto") return false
  const root = viewport.closest<HTMLElement>("[data-slot=diff-view]")
  return !root || getComputedStyle(root).maxHeight === "none"
}

/**
 * Connects the virtualizer to the diff's own viewport, or, for a diff sized to its content, to the nearest scrolling
 * ancestor (the window when there is none), with the viewport's offset in it as the scroll margin. The offset is read
 * again before the virtualizer's own scroll handler and on a resize, so content above that grows moves it.
 */
function connectDiffScroll(
  viewport: HTMLElement,
  virtual: Virtualizer,
  findable: boolean,
  setMargin: (margin: number) => void,
): { scroll: DiffScroll; disconnect: () => void } {
  if (!scrollsOutside(viewport)) {
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
