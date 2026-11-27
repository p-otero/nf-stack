"use client"

import { createVirtualizer, type VirtualItem } from "@ui-sdk/core"
import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"

import { layersBesideViewport, windowScroller } from "@/components/ui/scroll-area-layers"
import { isElementOf } from "@/lib/narrow"

/** `"auto"` virtualizes past `VIRTUALIZE_THRESHOLD` rows. */
type Virtualize = boolean | "auto"

const VIRTUALIZE_THRESHOLD = 200

type VirtualRowsOptions = {
  count: number
  virtualize?: Virtualize
  /** A row's estimated height in px before it is measured. */
  estimateSize?: number | ((index: number) => number)
  /** Keep it stable (`useCallback` over the ids): a new function makes the rows read their keys again. */
  getKey: (index: number) => string
  overscan?: number
  /**
   * The text find in page should find in each row, so it reaches rows that aren't rendered: UI SDK's findable
   * layers hold it in `hidden="until-found"` stand-ins and scroll a matched row in. Keep it stable.
   */
  findable?: (index: number) => string
  /**
   * The element the rows scroll in, when the caller knows it: saves looking for the nearest scrolling ancestor,
   * which reads every ancestor's computed style while the list mounts. Keep it stable.
   */
  scrollElement?: (anchor: HTMLElement) => HTMLElement | null
}

/** A rendered row, or a gap holding the space of the rows from `from` up to `to` that aren't rendered. */
type Segment =
  | { type: "row"; index: number; key: string }
  | { type: "gap"; size: number; from: number; to: number; key: string }

type Scroller = { element: HTMLElement | null; margin: number }

type RowsProps = {
  findable?: (index: number) => string
  count: number
  /** One size for every row, which the first measured row replaces, or a size per row. */
  estimate: number | ((index: number) => number)
  getKey: (index: number) => string
  margin: number
}

const noItems: VirtualItem[] = []
const noSubscription = () => () => undefined

function scrollParentOf(el: HTMLElement) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) return node
  }
  return null
}

function marginIn(el: HTMLElement, scroller: HTMLElement | null) {
  const top = el.getBoundingClientRect().top
  if (!scroller) return top + globalThis.scrollY
  return top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

function isVirtual(virtualize: Virtualize, count: number) {
  return virtualize === "auto" ? count > VIRTUALIZE_THRESHOLD : virtualize
}

function sizeOf(estimateSize: VirtualRowsOptions["estimateSize"]) {
  return estimateSize ?? 52
}

const sizeAt = (estimate: RowsProps["estimate"], index: number) =>
  typeof estimate === "number" ? estimate : estimate(index)

type Row = { index: number; key: string; size?: number; stop?: () => void }

const boxHeight = (entry: ResizeObserverEntry) =>
  entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height

/**
 * One list's virtualizer, with the props it reads: `update` swaps in new ones and reads the list again, and `pin`
 * keeps a row rendered wherever the list is scrolled, like the one with focus.
 */
function createRows(initial: RowsProps, overscan: number) {
  let props = initial
  let pinned: number | undefined
  // Rows of one size: the first one measured sets the size of every row not measured yet.
  let learned: number | undefined
  const estimateAt = (index: number) =>
    typeof props.estimate === "number" ? (learned ?? props.estimate) : props.estimate(index)
  const findable = initial.findable !== undefined
  const virtualizer = createVirtualizer({
    count: () => props.count,
    estimate: estimateAt,
    key: (index) => props.getKey(index),
    overscan,
    get scrollMargin() {
      return props.margin
    },
    keep: () => (pinned === undefined || pinned >= props.count ? [] : [pinned]),
    ...(findable ? { findable: (index: number) => props.findable?.(index) ?? "" } : {}),
  })
  // The sizes the virtualizer was given, by key. Every size it records lays out all the rows again, once per row
  // (50,000 keys read for one row of a 50,000-commit history), so a row whose size it already has never reaches it.
  const given = new Map<string, number>()
  const knownSize = (row: Row) => given.get(row.key) ?? estimateAt(row.index)
  const give = (row: Row, el: HTMLElement, size: number) => {
    row.stop = virtualizer.measure(row.index, el)
    given.set(row.key, size)
  }
  // One observer for every row, whose callbacks come after the browser's own layout and before paint, so a size is
  // read for free and a row never shows at a wrong one. A row the virtualizer measures leaves it: the virtualizer
  // follows its resizes from then on. Find in page reveals a row through the virtualizer, so findable rows all go.
  const joining = new Map<Element, Row>()
  const sizes =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const row = joining.get(entry.target)
            if (!row || row.stop) {
              sizes?.unobserve(entry.target)
              continue
            }
            const size = boxHeight(entry)
            if (!size) continue
            if (learned === undefined && typeof props.estimate === "number") {
              learned = size
              virtualizer.refresh()
            }
            if (findable || size !== knownSize(row)) {
              sizes?.unobserve(entry.target)
              if (isElementOf(entry.target, "HTMLElement")) give(row, entry.target, size)
            }
          }
        })
      : undefined
  // Where the list was at its last scroll event. Focusing a row scrolls the browser's way, centring a row that was
  // out of view, half a page at once; aligning from here instead brings in one row per arrow key.
  let seen: number | undefined
  let view: { top: () => number; height: () => number } | undefined

  // The rows React renders. A change that only moves rows already rendered out of view, like one row of overscan
  // on an arrow key, reaches React after the next paint instead of inside the key press: the frame shows the same
  // rows either way, and the press doesn't wait for a row nobody sees yet. A row coming into view renders at once.
  let shown: readonly VirtualItem[] = []
  let shownSize = 0
  let pending = 0
  let published = 0
  let urgent = false
  const listeners = new Set<() => void>()
  const publish = () => {
    pending = 0
    for (const listener of listeners) listener()
  }
  const covered = (next: readonly VirtualItem[]) => {
    if (!view || shown.length === 0 || virtualizer.size() !== shownSize) return false
    const top = view.top() - props.margin
    const bottom = top + view.height()
    const before = new Map(shown.map((item) => [item.index, item]))
    for (const item of next) {
      const was = before.get(item.index)
      if (was) {
        if (was.start !== item.start || was.size !== item.size || was.key !== item.key) return false
      } else if (item.start + item.size > top && item.start < bottom) return false
    }
    return true
  }
  virtualizer.subscribe(() => {
    if (listeners.size === 0) return
    if (urgent) publish()
    else if (pending === 0 && typeof requestAnimationFrame === "function" && covered(virtualizer.items())) {
      const at = ++published
      pending = at
      requestAnimationFrame(() => setTimeout(() => pending === at && publish()))
    } else if (pending === 0 || !covered(virtualizer.items())) publish()
  })
  return {
    findable,
    virtualizer,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    /** The rows to render: the virtualizer's, or the ones React has while a change waits for the next paint. */
    items() {
      if (pending === 0) {
        shown = virtualizer.items()
        shownSize = virtualizer.size()
      }
      return shown
    },
    size: () => shownSize,
    /** Reads the list again and renders the change now, whatever it is. */
    refreshNow() {
      urgent = true
      virtualizer.refresh()
      urgent = false
      if (pending !== 0) publish()
    },
    update(next: RowsProps) {
      props = next
      virtualizer.refresh()
    },
    pin(index: number | undefined) {
      pinned = index
    },
    measure(index: number, el: HTMLElement) {
      const row: Row = { index, key: props.getKey(index) }
      joining.set(el, row)
      if (sizes) sizes.observe(el)
      else row.stop = virtualizer.measure(index, el)
      return () => {
        sizes?.unobserve(el)
        if (joining.get(el) === row) joining.delete(el)
        row.stop?.()
      }
    },
    /** Follows the scroller's scroll events. */
    follow(scroller: { top: () => number; height: () => number }) {
      view = scroller
      seen = scroller.top()
    },
    /**
     * Scrolls the least that shows a rendered row whole, from where the list was. UI SDK's scroll reads the list
     * again at once, so a row it brings into view renders with the key press that moved focus.
     */
    scrollToIndex(index: number) {
      const item = view && virtualizer.items().find((row) => row.index === index)
      if (!view || !item || seen === undefined) {
        virtualizer.scrollToIndex(index, { align: "auto" })
        return
      }
      const end = item.start + props.margin + item.size
      if (item.start < seen) virtualizer.scrollToIndex(index, { align: "start" })
      else if (end > seen + view.height()) virtualizer.scrollToIndex(index, { align: "end" })
      else return
      seen = view.top()
    },
  }
}

function connectRows(rows: ReturnType<typeof createRows>, scroller: Scroller) {
  const options = { findable: rows.findable }
  const { element } = scroller
  const target: HTMLElement | Window = element ?? globalThis.window
  const view = element
    ? { top: () => element.scrollTop, height: () => element.clientHeight }
    : { top: () => globalThis.scrollY, height: () => globalThis.innerHeight }
  const onScroll = () => rows.follow(view)
  onScroll()
  target.addEventListener("scroll", onScroll, { passive: true })
  if (element) {
    const restore = layersBesideViewport(element)
    const disconnect = rows.virtualizer.connect(element, options)
    return () => {
      disconnect()
      restore()
      element.removeEventListener("scroll", onScroll)
    }
  }
  const disconnect = rows.virtualizer.connect(windowScroller(globalThis.window), options)
  const onResize = () => rows.virtualizer.refresh()
  globalThis.addEventListener("resize", onResize)
  return () => {
    disconnect()
    globalThis.removeEventListener("scroll", onScroll)
    globalThis.removeEventListener("resize", onResize)
  }
}

function segmentsOf(items: readonly VirtualItem[], total: number, count: number) {
  const segments: Segment[] = []
  let position = 0
  let next = 0
  for (const item of items) {
    if (item.index > next) {
      const key = next === 0 ? "gap-start" : `gap-${String(next)}`
      segments.push({ type: "gap", size: Math.max(0, item.start - position), from: next, to: item.index, key })
    }
    segments.push({ type: "row", index: item.index, key: item.key })
    position = item.start + item.size
    next = item.index + 1
  }
  if (next < count)
    segments.push({ type: "gap", size: Math.max(0, total - position), from: next, to: count, key: "gap-end" })
  return segments
}

/**
 * Renders only the rows in view (and the pinned one), in document flow: gaps take the place of the rows in between,
 * so a table keeps its rows in `tbody` and a list its items in `ul`. It scrolls with the nearest scrolling ancestor
 * of the element given to `anchor`, or the window when there is none. On UI SDK's virtualizer, through
 * `useSyncExternalStore`: the list renders again only when the rows in view change, not on every scroll event.
 */
function useVirtualRows({
  count,
  virtualize = "auto",
  estimateSize,
  getKey,
  overscan = 8,
  scrollElement: findScroller = scrollParentOf,
  findable,
}: VirtualRowsOptions) {
  const enabled = isVirtual(virtualize, count)
  const estimate = useMemo(() => sizeOf(estimateSize), [estimateSize])
  const [scroller, setScroller] = useState<Scroller | null>(null)
  const margin = scroller?.margin ?? 0
  const [rows] = useState(() => createRows({ count, estimate, getKey, margin, findable }, overscan))

  useLayoutEffect(() => {
    rows.update({ count, estimate, getKey, margin, findable })
    // oxlint-disable-next-line p-otero/no-callback-prop-in-effect-deps -- a new getKey means new keys, which re-measure rows; List and DataTable memoize it, and a refresh never renders the parent unless the rows in view change
  }, [rows, count, estimate, getKey, margin, findable])
  useLayoutEffect(() => (enabled && scroller ? connectRows(rows, scroller) : undefined), [rows, enabled, scroller])

  const live = enabled && scroller !== null
  const items = useSyncExternalStore(
    live ? rows.subscribe : noSubscription,
    () => (live ? rows.items() : noItems),
    () => noItems,
  )

  const anchor = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !enabled) return
      const scrollElement = findScroller(node)
      setScroller({ element: scrollElement, margin: marginIn(node, scrollElement) })
    },
    [enabled, findScroller],
  )

  let segments: Segment[]
  if (!enabled) {
    segments = Array.from({ length: count }, (_, index) => ({ type: "row", index, key: getKey(index) }))
  } else if (!live) {
    segments =
      count > 0 ? [{ type: "gap", size: count * sizeAt(estimate, 0), from: 0, to: count, key: "gap-start" }] : []
  } else {
    segments = segmentsOf(items, rows.size(), count)
  }

  const scrollToIndex = useCallback(
    (index: number) => {
      if (enabled) rows.scrollToIndex(index)
    },
    [enabled, rows],
  )
  const pin = useCallback((index: number | undefined) => rows.pin(index), [rows])
  /** Renders a row now, wherever the list is scrolled, like one an agent is about to activate. */
  const renderNow = useCallback(
    (index: number) => {
      if (!enabled) return
      rows.pin(index)
      flushSync(() => rows.refreshNow())
    },
    [enabled, rows],
  )
  // A row's ref: measures it, then as it resizes, until React runs the returned cleanup.
  const measureElement = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return undefined
      const index = Number(node.dataset.index)
      return Number.isInteger(index) ? rows.measure(index, node) : undefined
    },
    [rows],
  )

  return {
    enabled,
    anchor,
    segments,
    pin,
    renderNow,
    rendered: (index: number) => !enabled || segments.some((s) => s.type === "row" && s.index === index),
    measureElement: enabled ? measureElement : undefined,
    scrollToIndex,
  }
}

export { scrollParentOf, useVirtualRows, VIRTUALIZE_THRESHOLD }
export type { Segment, Virtualize, VirtualRowsOptions }
