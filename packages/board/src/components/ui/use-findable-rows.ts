import { createVirtualizer } from "@ui-sdk/core"
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react"

import { layersBesideViewport } from "@/components/ui/scroll-area-layers"

/** Past this many rows only the rows in view render. */
const FINDABLE_ROWS_THRESHOLD = 200

type FindableRowsOptions = {
  count: number
  /** A row's estimated height in px before it is measured. */
  estimate: number
  getKey: (index: number) => string
  /** The text find in page should find in a row: what it shows, in the pieces its `findableText` elements hold. */
  text: (index: number) => string | readonly string[]
  /** Keeps rows that aren't rendered findable, through UI SDK's findable layers, built once the page is idle. */
  findable: boolean
}

type Latest = Omit<FindableRowsOptions, "findable">

const noKeep: readonly number[] = []

// The layers hold a stand-in for every row, so they wait until the first paint is done and the page is idle.
function whenIdle(run: () => void) {
  const idle = globalThis.requestIdleCallback as typeof requestIdleCallback | undefined
  const cancelIdle = globalThis.cancelIdleCallback as typeof cancelIdleCallback | undefined
  if (idle && cancelIdle) {
    const handle = idle(run, { timeout: 2000 })
    return () => cancelIdle(handle)
  }
  const timer = setTimeout(run, 200)
  return () => clearTimeout(timer)
}

/** A virtualizer that reads the newest options, which `update` swaps in; outside React, so it can hold them. */
function createRows(initial: Latest) {
  let latest = initial
  let keep = noKeep
  const virtual = createVirtualizer({
    count: () => latest.count,
    estimate: () => latest.estimate,
    key: (index) => latest.getKey(index),
    overscan: 8,
    keep: () => keep,
    findable: (index) => latest.text(index),
  })
  return {
    virtual,
    update(next: Latest) {
      const same =
        latest.count === next.count &&
        latest.getKey === next.getKey &&
        latest.text === next.text &&
        latest.estimate === next.estimate
      if (same) return
      latest = next
      virtual.refresh()
    },
    // Read on the virtualizer's next update, like the scroll a key press makes: refreshing here would render the
    // list on every focus move.
    pin(index: number | undefined) {
      if (keep[0] !== index) keep = index === undefined ? noKeep : [index]
    },
  }
}

/**
 * Rows on UI SDK's virtualizer: past 200 rows, only those in view render, absolutely positioned in a box as tall as
 * every row and measured as they render, so their heights can change. With `findable`, find in page reaches the
 * rows that aren't rendered and scrolls to the one it matched. Give the scroller a bounded height.
 */
function useFindableRows({ count, estimate, getKey, text, findable }: FindableRowsOptions) {
  const enabled = count > FINDABLE_ROWS_THRESHOLD
  const [rows] = useState(() => createRows({ count, estimate, getKey, text }))
  const { virtual } = rows
  const [scroller, setScroller] = useState<HTMLElement | null>(null)

  // The virtualizer reads the newest options when it computes; `update` tells it only when they changed.
  useLayoutEffect(() => {
    rows.update({ count, estimate, getKey, text })
  })

  useEffect(() => {
    if (!scroller || !enabled) return undefined
    let disconnect = virtual.connect(scroller)
    if (!findable) return () => disconnect()
    let restore = () => {}
    const cancel = whenIdle(() => {
      disconnect()
      restore = layersBesideViewport(scroller)
      disconnect = virtual.connect(scroller, { findable: true })
    })
    return () => {
      cancel()
      disconnect()
      restore()
    }
  }, [virtual, scroller, enabled, findable])

  const items = useSyncExternalStore(virtual.subscribe, virtual.items, virtual.items)
  const size = useSyncExternalStore(virtual.subscribe, virtual.size, virtual.size)

  /** Keeps a row rendered wherever the list scrolls, like the one with focus. */
  const pin = useCallback((index: number | undefined) => rows.pin(index), [rows])
  const scrollToIndex = useCallback(
    (index: number) => {
      if (enabled) virtual.scrollToIndex(index)
    },
    [virtual, enabled],
  )

  return {
    enabled,
    items,
    size,
    /** The scroller, the nearest element that scrolls the rows: pass it as its `ref`. */
    setScroller,
    measure: virtual.measure,
    findableText: virtual.findableText,
    pin,
    scrollToIndex,
  }
}

export { FINDABLE_ROWS_THRESHOLD, useFindableRows }
export type { FindableRowsOptions }
