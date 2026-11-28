"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"

type Point = { x: number; y: number }

function firstOf(list: string) {
  let depth = 0
  for (let index = 0; index < list.length; index++) {
    const char = list[index]
    if (char === "(") depth++
    else if (char === ")") depth--
    else if (char === "," && depth === 0) return list.slice(0, index).trim()
  }
  return list.trim()
}

function milliseconds(value: string) {
  const first = firstOf(value)
  const number = Number.parseFloat(first)
  if (Number.isNaN(number)) return 0
  return first.endsWith("ms") ? number : number * 1000
}

function where(el: HTMLElement, origin: DOMRect): Point {
  const rect = el.getBoundingClientRect()
  return { x: rect.left - origin.left, y: rect.top - origin.top }
}

/**
 * Slides the elements matching `selector` inside `root` from where they were to where they are whenever `trigger`
 * changes, so neighbours make room instead of jumping. Timing comes from the root's own `transition-duration` and
 * `transition-timing-function` (the motion tokens), and nothing moves under reduced motion. An element carrying
 * `data-grabbed` follows the pointer and is left alone.
 */
function useFlip(root: RefObject<HTMLElement | null>, selector: string, trigger: unknown) {
  const last = useRef(new Map<Element, Point>())
  useLayoutEffect(() => {
    const container = root.current
    if (!container) return
    const elements = [...container.querySelectorAll<HTMLElement>(selector)]
    const origin = container.getBoundingClientRect()
    const next = new Map<Element, Point>(elements.map((el) => [el, where(el, origin)]))
    const previous = last.current
    last.current = next
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const style = getComputedStyle(container)
    const duration = milliseconds(style.transitionDuration)
    if (duration < 1) return
    const easing = firstOf(style.transitionTimingFunction) || "ease"
    for (const el of elements) {
      const was = previous.get(el)
      const now = next.get(el)
      if (!was || !now || el.hasAttribute("data-grabbed") || typeof el.animate !== "function") continue
      const dx = was.x - now.x
      const dy = was.y - now.y
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      el.animate([{ translate: `${String(dx)}px ${String(dy)}px` }, { translate: "0 0" }], {
        duration,
        easing,
        composite: "add",
      })
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `trigger` is the order: the effect runs only when it changes
  }, [root, selector, trigger])
}

export { useFlip }
