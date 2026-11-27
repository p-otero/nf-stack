"use client"

import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

type TabsScrollLabels = {
  /** Names of the pointer-only scroll buttons. They are hidden from screen readers, which reach every tab by arrow keys. */
  left: string
  right: string
}

const tabsScrollLabels: TabsScrollLabels = { left: "Scroll tabs left", right: "Scroll tabs right" }

type Edges = { left: boolean; right: boolean }

// Physical edges, not logical ones: scrollLeft is negative under rtl in every current engine, and the fades and
// buttons are placed physically, so reading both sides from the absolute offset covers both directions.
function readEdges(element: HTMLElement): Edges {
  const max = element.scrollWidth - element.clientWidth
  if (max <= 1) return { left: false, right: false }
  const offset = Math.abs(element.scrollLeft)
  const fromStart = offset > 1
  const toEnd = offset < max - 1
  const rtl = getComputedStyle(element).direction === "rtl"
  return rtl ? { left: toEnd, right: fromStart } : { left: fromStart, right: toEnd }
}

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

// Scrolls only the list, never the page or a scrolling ancestor, so a tab an agent selects off screen doesn't
// move the page. The list's scroll padding is the fade's width, so the tab lands clear of it. The target is
// absolute, so a second call while a smooth scroll runs (focus and selection change together) lands in the same place.
function revealTab(list: HTMLElement, tab: HTMLElement, smooth: boolean) {
  if (list.scrollWidth - list.clientWidth <= 1) return
  const style = getComputedStyle(list)
  const bounds = list.getBoundingClientRect()
  const box = tab.getBoundingClientRect()
  const left = box.left - (bounds.left + (Number.parseFloat(style.scrollPaddingLeft) || 0))
  const right = box.right - (bounds.right - (Number.parseFloat(style.scrollPaddingRight) || 0))
  const rtl = style.direction === "rtl"
  // A tab wider than the clear space shows its start.
  const delta = left < 0 && right > 0 ? (rtl ? right : left) : left < 0 ? left : right > 0 ? right : 0
  if (Math.abs(delta) < 1) return
  list.scrollTo({ left: list.scrollLeft + delta, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" })
}

function isTab(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement && node.getAttribute("role") === "tab"
}

const noEdges: Edges = { left: false, right: false }

// The subscription also keeps the selected tab in view: on mount, after each resize (tabs change width as fonts load
// or labels change), on focus and on selection. Geometry is read only where layout is already clean (the resize
// observer, scroll events, an animation frame), never in the focus or key event: a list that fits does nothing on an
// arrow press, and one that scrolls reveals its tab in the next frame.
function createEdgesStore() {
  let edges = noEdges
  return {
    getSnapshot: () => edges,
    getServerSnapshot: () => noEdges,
    watch(element: HTMLElement | null, onChange: () => void) {
      if (!element) return () => {}
      let overflows = false
      let frame = 0
      let pending: { tab: HTMLElement; smooth: boolean } | null = null
      const update = () => {
        overflows = element.scrollWidth - element.clientWidth > 1
        const next = readEdges(element)
        if (next.left === edges.left && next.right === edges.right) return
        edges = next
        onChange()
      }
      const reveal = (tab: HTMLElement, smooth: boolean) => {
        if (!overflows) return
        pending = { tab, smooth: pending?.smooth === false ? false : smooth }
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          const target = pending
          pending = null
          if (target?.tab.isConnected) revealTab(element, target.tab, target.smooth)
        })
      }
      const revealSelected = () => {
        const selected = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        if (selected) revealTab(element, selected, false)
      }
      const observer =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              update()
              revealSelected()
            })
          : undefined
      observer?.observe(element)
      for (const child of element.children) observer?.observe(child)
      element.addEventListener("scroll", update, { passive: true })
      update()

      const onFocus = (event: FocusEvent) => {
        if (isTab(event.target)) reveal(event.target, true)
      }
      const selection =
        typeof MutationObserver === "function"
          ? new MutationObserver((records) => {
              for (const record of records) {
                if (isTab(record.target) && record.target.getAttribute("aria-selected") === "true") {
                  reveal(record.target, true)
                }
              }
            })
          : undefined
      selection?.observe(element, { attributes: true, attributeFilter: ["aria-selected"], subtree: true })
      element.addEventListener("focusin", onFocus)
      revealSelected()
      return () => {
        cancelAnimationFrame(frame)
        observer?.disconnect()
        selection?.disconnect()
        element.removeEventListener("scroll", update)
        element.removeEventListener("focusin", onFocus)
      }
    },
  }
}

function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null)
  const [store] = useState(createEdgesStore)
  const subscribe = useCallback((onChange: () => void) => store.watch(ref.current, onChange), [store])
  const edges = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot)

  const scroll = (direction: -1 | 1) => {
    const element = ref.current
    if (!element) return
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    })
  }

  return { ref, edges, scroll }
}

type ScrollButtonProps = { side: "left" | "right"; label: string; onScroll: () => void }

// Pointer-only, so aria-hidden and out of the tab order; agents select tabs on the tablist itself.
function ScrollButton({ side, label, onScroll }: ScrollButtonProps) {
  return (
    <span
      data-slot="tabs-scroll-button"
      data-side={side}
      className="absolute inset-y-0 hidden items-center rounded-control bg-muted data-[side=left]:left-0 data-[side=right]:right-0 group-data-overflow-left/tabs-scroll:data-[side=left]:pointer-fine:flex group-data-overflow-right/tabs-scroll:data-[side=right]:pointer-fine:flex"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-hidden="true"
        tabIndex={-1}
        data-agent-hidden=""
        onClick={onScroll}
      >
        {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </Button>
    </span>
  )
}

type TabsScrollProps = {
  labels?: Partial<TabsScrollLabels>
  children: (ref: RefObject<HTMLDivElement | null>) => ReactNode
}

function TabsScroll({ labels: labelOverrides, children }: TabsScrollProps) {
  const labels = { ...tabsScrollLabels, ...labelOverrides }
  const { ref, edges, scroll } = useScrollEdges()
  return (
    <div
      data-slot="tabs-scroll"
      data-overflow-left={edges.left ? "" : undefined}
      data-overflow-right={edges.right ? "" : undefined}
      className="group/tabs-scroll relative flex max-w-full min-w-0 has-data-[orientation=vertical]:contents"
    >
      {children(ref)}
      <ScrollButton side="left" label={labels.left} onScroll={() => scroll(-1)} />
      <ScrollButton side="right" label={labels.right} onScroll={() => scroll(1)} />
    </div>
  )
}

export { readEdges, revealTab, TabsScroll, tabsScrollLabels }
export type { TabsScrollLabels }
