"use client"

import { useRef, type PointerEvent } from "react"

/** How long a mouse rests on a link before it counts as intent, as instant.page does. */
const hoverDwell = 65

/**
 * Handlers that call `onIntent(href)` when someone is about to follow the link: the mouse rests on it for 65 ms, it
 * takes focus, or a mouse or pen presses it. A touch press doesn't count, since it may start a scroll. It can run
 * more than once for one visit, so a router's preload should be idempotent.
 */
function useLinkIntent(href: string | undefined, onIntent: ((href: string) => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  if (!onIntent || href === undefined) return {}
  const fire = () => {
    clearTimeout(timer.current)
    onIntent(href)
  }
  return {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") timer.current = setTimeout(fire, hoverDwell)
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") fire()
    },
    onFocus: () => fire(),
  }
}

export { useLinkIntent }
