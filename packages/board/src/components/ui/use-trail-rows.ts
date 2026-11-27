import { useCallback } from "react"

import { useFindableRows } from "@/components/ui/use-findable-rows"
import { useVirtualRows } from "@/components/ui/virtual-rows"

type TrailRowsOptions = {
  count: number
  /** A row's estimated height in px before it is measured. */
  estimate: number
  getKey: (index: number) => string
  /** A row's text for find in page, in the pieces its `textSlot` elements hold. */
  text: (index: number) => string | readonly string[]
  /** Find in page reaches rows that aren't rendered, through UI SDK's virtualizer and findable layers. */
  findable: boolean
}

/** A rendered row, at `top` px in an absolutely positioned box, or in flow; or the space of rows not rendered. */
type TrailSegment = { type: "row"; index: number; top?: number } | { type: "gap"; size: number; key: string }

const noop = () => {}

/**
 * The rows of a long trail or tree. By default `virtual-rows`, rows in document flow; with `findable`, UI SDK's
 * virtualizer with absolutely positioned rows, whose findable layers let find in page reach the rows that aren't
 * rendered, at a cost `tooling/git-bench.mjs` measures. Only one of them ever holds rows.
 */
function useTrailRows({ count, estimate, getKey, text, findable }: TrailRowsOptions) {
  const flow = useVirtualRows({ count: findable ? 0 : count, estimateSize: estimate, getKey })
  const { setScroller, ...layered } = useFindableRows({
    count: findable ? count : 0,
    estimate,
    getKey,
    text,
    findable,
  })
  const absolute = findable && layered.enabled

  let segments: TrailSegment[]
  if (absolute) segments = layered.items.map((item) => ({ type: "row", index: item.index, top: item.start }))
  else if (findable) segments = Array.from({ length: count }, (_, index) => ({ type: "row", index }))
  else
    segments = flow.segments.map((segment) =>
      segment.type === "row" ? { type: "row", index: segment.index } : segment,
    )

  // Rows are memoized: everything they get keeps its identity across scrolls.
  const { measureElement } = flow
  const { measure: measureLayered } = layered
  const measure = useCallback(
    (index: number, el: HTMLElement | null) => {
      if (absolute) return measureLayered(index, el)
      return measureElement?.(el) ?? noop
    },
    [absolute, measureLayered, measureElement],
  )
  const { pin: pinFlow, scrollToIndex: scrollFlow } = flow
  const { pin: pinLayered, scrollToIndex: scrollLayered } = layered
  const pin = useCallback(
    (index: number | undefined) => (absolute ? pinLayered(index) : pinFlow(index)),
    [absolute, pinFlow, pinLayered],
  )
  const { renderNow } = flow
  /** Renders a row wherever the list is scrolled and scrolls to it, like a branch's head about to take focus. */
  const reveal = useCallback(
    (index: number) => {
      if (absolute) {
        scrollLayered(index)
        return
      }
      renderNow(index)
      scrollFlow(index)
    },
    [absolute, renderNow, scrollFlow, scrollLayered],
  )
  const scrollToIndex = useCallback(
    (index: number) => (absolute ? scrollLayered(index) : scrollFlow(index)),
    [absolute, scrollFlow, scrollLayered],
  )

  return {
    /** Rows render only in view, by either engine. */
    virtual: absolute || flow.enabled,
    /** The rows' box is `height` px tall and rows sit at their `top`. */
    absolute,
    height: absolute ? layered.size : undefined,
    segments,
    /** Pass as the `ref` of the element the rows are in, in flow. */
    anchor: flow.anchor,
    /** Pass as the `ref` of the scroller, for UI SDK's virtualizer. */
    setScroller,
    measure: absolute || flow.enabled ? measure : undefined,
    textSlot: absolute ? layered.findableText : undefined,
    pin,
    scrollToIndex,
    reveal,
  }
}

export { useTrailRows }
export type { TrailRowsOptions, TrailSegment }
