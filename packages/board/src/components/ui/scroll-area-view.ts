import { isRTL } from "@ui-sdk/core"

import {
  createStyleWriter,
  edgeTolerance,
  edgesOf,
  focusViewport,
  isEditing,
  listen,
  mainAxis,
  maxScroll,
  names,
  overflows,
  prefersReducedMotion,
  registerFrameVariables,
  scrollbarShown,
  scrollsInside,
  startwardKeys,
  thumbGeometry,
  type Axis,
  type Metrics,
  type ScrollAreaModel,
  type ScrollAreaScrollOptions,
  type ScrollAreaStore,
  type ScrollViewQueries,
} from "@/components/ui/scroll-area-model"
import { createScrollbarInput } from "@/components/ui/scroll-area-pointer"
import { bindTabStop } from "@/components/ui/scroll-area-tab-stop"

const scrollEndDelay = 150
const axes = ["x", "y"] as const
const preventDefault = (event: Event) => event.preventDefault()

function createScrollView(store: ScrollAreaStore) {
  let root: HTMLElement | undefined
  let viewport: HTMLElement | undefined
  const host = () => viewport?.ownerDocument.defaultView ?? window
  const scrollbars = new Set<{ el: HTMLElement; axis: Axis }>()
  const track = { x: 0, y: 0 }
  const thickness = { x: 0, y: 0 }
  let rtl = false
  const metrics: Record<Axis, Metrics> = {
    x: { position: 0, client: 0, scroll: 0 },
    y: { position: 0, client: 0, scroll: 0 },
  }
  const previous = { x: Number.NaN, y: Number.NaN }
  const { write, clear } = createStyleWriter()
  let stuckTo = Number.NaN
  let touchY: number | null = null
  let pressed = false
  let easing = 0
  const scrollEnds = { x: 0, y: 0 }
  const lastScroll = { x: 0, y: 0 }
  const hideTimers = { x: 0, y: 0 }

  function measure() {
    const el = viewport
    if (!el) return
    metrics.y.position = el.scrollTop
    metrics.y.client = el.clientHeight
    metrics.y.scroll = el.scrollHeight
    const left = el.scrollLeft
    if (left !== 0 && left < 0 !== rtl) rtl = isRTL(el)
    metrics.x.position = rtl ? -left : left
    metrics.x.client = el.clientWidth
    metrics.x.scroll = el.scrollWidth
  }

  function setFlag<K extends keyof ScrollAreaModel>(key: K, value: ScrollAreaModel[K]) {
    if (store.get()[key] !== value) store.set({ [key]: value } as Partial<ScrollAreaModel>)
  }

  // Perf: reads every metric, then writes what changed, in the scroll event itself. Writing in an animation frame,
  // as UI SDK does, cost a 20,000-line DiffView 9 ms more per key press at 4× CPU in Chrome.
  function update(resized = false) {
    if (!viewport) return
    measure()
    if (resized) follow()
    const state = store.get()
    let patch: Partial<ScrollAreaModel> | undefined
    const set = <K extends keyof ScrollAreaModel>(key: K, value: ScrollAreaModel[K]) => {
      if (state[key] !== value) (patch ??= {})[key] = value
    }
    for (const axis of axes) {
      const axisMetrics = metrics[axis]
      const name = names[axis]
      const delta = Number.isNaN(previous[axis]) ? 0 : axisMetrics.position - previous[axis]
      previous[axis] = axisMetrics.position
      const edges = edgesOf(axisMetrics)
      set(name.overflow, overflows(axisMetrics))
      set(name.atStart, edges.atStart)
      set(name.atEnd, edges.atEnd)
      if (root) {
        write(root, name.before, edges.before)
        write(root, name.after, edges.after)
        write(root, name.progress, edges.progress, "")
      }
      writeThumb(axis)
      if (delta === 0) continue
      const ownScroll = axis === "y" && Math.abs(axisMetrics.position - stuckTo) < edgeTolerance
      if (!ownScroll) {
        lastScroll[axis] = performance.now()
        set(name.scrolling, true)
        scrollEnds[axis] ||= host().setTimeout(() => endScroll(axis), scrollEndDelay)
      }
      if (axis === "y" && state.stickToEnd) {
        const atEnd = edges.after < edgeTolerance
        set("sticking", state.sticking ? atEnd || delta >= 0 : atEnd && delta > 0)
      }
    }
    writeCorner(patch?.overflowX ?? state.overflowX, patch?.overflowY ?? state.overflowY)
    if (patch) store.set(patch)
    if (patch || resized) refreshVisibility()
  }

  function writeThumb(axis: Axis) {
    const geometry = thumbGeometry(metrics[axis], track[axis])
    for (const scrollbar of scrollbars) {
      if (scrollbar.axis !== axis) continue
      write(scrollbar.el, names[axis].thumbSize, geometry.size)
      write(scrollbar.el, "--scroll-area-thumb-offset", axis === "x" && rtl ? -geometry.offset : geometry.offset)
    }
  }

  function writeCorner(overflowX: boolean, overflowY: boolean) {
    if (!root) return
    const state = store.get()
    const both = overflowX && overflowY && state.scrollbarsX > 0 && state.scrollbarsY > 0
    write(root, "--scroll-area-corner-width", both ? thickness.y : 0)
    write(root, "--scroll-area-corner-height", both ? thickness.x : 0)
  }

  function endScroll(axis: Axis) {
    const elapsed = performance.now() - lastScroll[axis]
    if (elapsed < scrollEndDelay) {
      scrollEnds[axis] = host().setTimeout(() => endScroll(axis), scrollEndDelay - elapsed)
      return
    }
    scrollEnds[axis] = 0
    setFlag(names[axis].scrolling, false)
    refreshVisibility()
  }

  function refreshVisibility() {
    const state = store.get()
    for (const axis of axes) {
      const name = names[axis]
      if (scrollbarShown(state, axis)) {
        host().clearTimeout(hideTimers[axis])
        hideTimers[axis] = 0
        setFlag(name.visible, true)
        continue
      }
      if (!state[name.visible] || hideTimers[axis]) continue
      const delay = state.type === "scroll" || state.type === "hover" ? state.scrollHideDelay : 0
      if (delay <= 0) {
        setFlag(name.visible, false)
        continue
      }
      hideTimers[axis] = host().setTimeout(() => {
        hideTimers[axis] = 0
        setFlag(name.visible, false)
        refreshVisibility()
      }, delay)
    }
  }

  function follow() {
    const state = store.get()
    if (!viewport || !state.stickToEnd || !state.sticking || state.dragging || pressed || touchY !== null || easing) {
      return
    }
    const max = maxScroll(metrics.y)
    if (max - metrics.y.position < edgeTolerance) return
    stuckTo = max
    viewport.scrollTo({ top: max, behavior: "instant" })
    metrics.y.position = viewport.scrollTop
  }

  function scrollTo(axis: Axis, position: number, behavior: ScrollBehavior = "instant") {
    if (!viewport) return
    if (axis === "y") viewport.scrollTo({ top: position, behavior })
    else viewport.scrollTo({ left: rtl ? -position : position, behavior })
  }

  function stopEasing() {
    if (!easing) return
    host().cancelAnimationFrame(easing)
    easing = 0
  }

  function release() {
    stopEasing()
    if (store.get().sticking && metrics.y.position > 0) store.set({ sticking: false })
  }

  function easeToEnd() {
    const step = () => {
      easing = 0
      if (!viewport) return
      measure()
      const gap = maxScroll(metrics.y) - metrics.y.position
      if (gap < edgeTolerance) return update()
      scrollTo("y", metrics.y.position + Math.max(1, gap * 0.2))
      easing = host().requestAnimationFrame(step)
    }
    easing = host().requestAnimationFrame(step)
  }

  function scrollToEdge(edge: "start" | "end", { behavior = "smooth" }: ScrollAreaScrollOptions = {}) {
    if (!viewport) return
    const axis = mainAxis(store.get())
    if (axis === "x") rtl = isRTL(viewport)
    measure()
    const smooth = behavior === "smooth" && !prefersReducedMotion()
    stopEasing()
    if (edge === "end" && axis === "y" && store.get().stickToEnd) setFlag("sticking", true)
    if (edge === "end" && axis === "y" && smooth) return easeToEnd()
    scrollTo(axis, edge === "start" ? 0 : maxScroll(metrics[axis]), smooth ? "smooth" : "instant")
  }

  // Spec: scroll doesn't bubble; in capture, the viewport also hears the scrolls of scrollers inside it.
  const onScroll = (event: Event) => {
    if (event.target === viewport) update()
  }
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY ?? null
  }
  const endTouch = () => {
    touchY = null
    update(true)
  }
  const hover = (hovering: boolean) => (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    setFlag("hovering", hovering)
    refreshVisibility()
  }
  const enter = hover(true)
  const leave = hover(false)

  function bindViewport(el: HTMLElement) {
    viewport = el
    const view = el.ownerDocument.defaultView ?? window
    let counted = false
    const resize = new ResizeObserver(() => {
      if (viewport !== el) return
      rtl = isRTL(el)
      update(true)
      if (!counted) {
        counted = true
        store.set({ counted: true })
      }
    })
    const observeChildren = () => {
      resize.observe(el)
      for (const child of el.children) resize.observe(child)
    }
    observeChildren()
    const children = new MutationObserver(() => {
      observeChildren()
      update(true)
    })
    children.observe(el, { childList: true })

    const scrollable = () => store.get().overflowX || store.get().overflowY
    const tabStop = bindTabStop(el, scrollable)
    let wasScrollable = scrollable()
    const unsubscribe = store.subscribe(() => {
      if (scrollable() === wasScrollable) return
      wasScrollable = scrollable()
      tabStop.check()
    })

    const lift = () => {
      pressed = false
      view.removeEventListener("pointerup", lift, true)
      view.removeEventListener("pointercancel", lift, true)
      update(true)
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) stopEasing()
      else if (!scrollsInside(event.target, el)) release()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditing(event.target)) return
      if (!startwardKeys.has(event.key) && !(event.key === " " && event.shiftKey)) return
      if (!scrollsInside(event.target, el)) release()
    }
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (y === undefined) return
      if (touchY !== null && y > touchY && !scrollsInside(event.target, el)) release()
      touchY = y
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) return
      pressed = true
      stopEasing()
      view.addEventListener("pointerup", lift, true)
      view.addEventListener("pointercancel", lift, true)
    }
    const unlisten = [
      listen(el, { scroll: onScroll }, { capture: true, passive: true }),
      listen(
        el,
        { wheel: onWheel, touchstart: onTouchStart, touchmove: onTouchMove, touchend: endTouch, touchcancel: endTouch },
        { passive: true },
      ),
      listen(el, { keydown: onKeyDown, pointerdown: onPointerDown }),
    ]
    return () => {
      resize.disconnect()
      children.disconnect()
      tabStop.stop()
      unsubscribe()
      for (const off of unlisten) off()
      view.removeEventListener("pointerup", lift, true)
      view.removeEventListener("pointercancel", lift, true)
      stopEasing()
      for (const axis of axes) {
        view.clearTimeout(scrollEnds[axis])
        view.clearTimeout(hideTimers[axis])
        scrollEnds[axis] = hideTimers[axis] = 0
      }
      if (viewport === el) viewport = undefined
    }
  }

  function bindRoot(el: HTMLElement) {
    registerFrameVariables()
    root = el
    queueMicrotask(() => {
      if (root === el && el.isConnected && el.matches(":hover")) setFlag("hovering", true)
    })
    const unlisten = listen(el, { pointerenter: enter, pointerleave: leave })
    return () => {
      unlisten()
      if (root === el) root = undefined
    }
  }

  function setDragging(dragging: Axis | null) {
    store.set({ dragging })
    refreshVisibility()
  }

  const input = createScrollbarInput({
    viewport: () => viewport,
    metrics,
    track,
    rtl: () => rtl,
    measure,
    // Spec: at the start, scrollLeft is 0 in either direction, so it can't show a turned one.
    readDirection: () => {
      if (viewport) rtl = isRTL(viewport)
    },
    scrollTo,
    release,
    stopEasing,
    setDragging,
  })

  function countScrollbars() {
    let x = 0
    let y = 0
    for (const part of scrollbars) {
      if (part.axis === "x") x++
      else y++
    }
    const state = store.get()
    if (state.scrollbarsX !== x || state.scrollbarsY !== y) store.set({ scrollbarsX: x, scrollbarsY: y })
  }

  function bindScrollbar(el: HTMLElement, axis: Axis) {
    const part = { el, axis }
    scrollbars.add(part)
    queueMicrotask(countScrollbars)
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return
      const box = entry.borderBoxSize?.[0]
      track[axis] = axis === "y" ? entry.contentRect.height : entry.contentRect.width
      thickness[axis] = (axis === "y" ? box?.inlineSize : box?.blockSize) ?? 0
      update(true)
    })
    resize.observe(el)
    const unlisten = listen(el, {
      wheel: input.forwardWheel,
      mousedown: preventDefault,
      pointerdown: (event) => input.pressTrack(event, el, axis),
    })
    return () => {
      resize.disconnect()
      unlisten()
      input.endPress(el)
      scrollbars.delete(part)
      countScrollbars()
      clear(el)
    }
  }

  const queries: ScrollViewQueries = {
    isAt(edge) {
      if (!viewport?.isConnected) return undefined
      measure()
      const axis = mainAxis({
        overflowX: overflows(metrics.x),
        overflowY: overflows(metrics.y),
      })
      const edges = edgesOf(metrics[axis])
      return edge === "start" ? edges.atStart : edges.atEnd
    },
    focusViewport: () => viewport && focusViewport(viewport),
    refresh() {
      if (viewport?.isConnected) update(true)
      refreshVisibility()
    },
  }
  return {
    bindRoot,
    bindViewport,
    bindScrollbar,
    bindThumb: input.bindThumb,
    scrollToEdge,
    ...queries,
  }
}

export { createScrollView }
