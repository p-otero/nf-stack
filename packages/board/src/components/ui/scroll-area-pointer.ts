import { bindDrag } from "@ui-sdk/core"

import {
  draggedPosition,
  edgeTolerance,
  maxScroll,
  pageDirection,
  pageFraction,
  positionAt,
  scaleOf,
  thumbGeometry,
  trackPoint,
  wheelPixels,
  type Axis,
  type Metrics,
} from "@/components/ui/scroll-area-model"

const repeatDelay = 400
const repeatInterval = 60

type ScrollbarHost = {
  viewport: () => HTMLElement | undefined
  metrics: Record<Axis, Metrics>
  track: Record<Axis, number>
  rtl: () => boolean
  measure: () => void
  readDirection: () => void
  scrollTo: (axis: Axis, position: number, behavior?: ScrollBehavior) => void
  release: () => void
  stopEasing: () => void
  setDragging: (axis: Axis | null) => void
}

/** Thumb drags, track presses and wheels over a scrollbar, which sits over the viewport and so never scrolls it natively. */
function createScrollbarInput(host: ScrollbarHost) {
  const thumbs = new Map<Axis, HTMLElement>()
  let running: { down: PointerEvent; holder: HTMLElement; cancel: () => void } | undefined

  const accepts = (event: PointerEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.defaultPrevented) return false
    if (running && running.down !== event && running.down.pointerType === event.pointerType) running.cancel()
    return !running
  }

  function follow(
    el: HTMLElement,
    down: PointerEvent,
    options: Parameters<typeof bindDrag>[2] & {
      onEnd: (event: PointerEvent, canceled: boolean) => void
    },
  ) {
    const finish = () => {
      if (running?.holder === el) running = undefined
    }
    const stop = bindDrag(el, down, {
      ...options,
      onEnd: (event, canceled) => {
        finish()
        options.onEnd(event, canceled)
      },
    })
    running = {
      down,
      holder: el,
      cancel: () => {
        finish()
        stop()
        options.onEnd(down, true)
      },
    }
  }

  const endPress = (el: HTMLElement) => {
    if (running?.holder === el) running.cancel()
  }

  function forwardWheel(event: WheelEvent) {
    const viewport = host.viewport()
    if (!viewport || event.ctrlKey) return
    if (event.deltaX !== 0) host.readDirection()
    host.measure()
    const { metrics } = host
    const dx = wheelPixels(event.deltaX, event.deltaMode, metrics.x.client)
    const dy = wheelPixels(event.deltaY, event.deltaMode, metrics.y.client)
    const canScroll = (delta: number, axis: Axis) => {
      const toward = axis === "x" && host.rtl() ? -delta : delta
      if (toward < 0) return metrics[axis].position > 0
      return toward > 0 && maxScroll(metrics[axis]) - metrics[axis].position >= edgeTolerance
    }
    if (!canScroll(dx, "x") && !canScroll(dy, "y")) return
    event.preventDefault()
    if (dy < 0) host.release()
    else host.stopEasing()
    viewport.scrollBy({ left: dx, top: dy, behavior: "instant" })
  }

  function drag(el: HTMLElement, down: PointerEvent, axis: Axis, start: number) {
    const from = axis === "y" ? down.clientY : down.clientX
    const scale = scaleOf(el, axis)
    const viewport = host.viewport()
    const savedSnap = viewport?.style.scrollSnapType ?? ""
    if (viewport) viewport.style.scrollSnapType = "none"
    host.stopEasing()
    host.setDragging(axis)
    follow(el, down, {
      cancelOnEscape: true,
      onMove: (sample) => {
        const distance = ((axis === "y" ? sample.y : sample.x) - from) / scale
        const delta = axis === "x" && host.rtl() ? -distance : distance
        host.scrollTo(axis, draggedPosition(start, delta, host.metrics[axis], host.track[axis]))
      },
      onEnd: (end, canceled) => {
        if (canceled && end.type === "pointermove") host.scrollTo(axis, start)
        if (viewport) viewport.style.scrollSnapType = savedSnap
        host.setDragging(null)
      },
    })
  }

  function bindThumb(el: HTMLElement, axis: Axis) {
    thumbs.set(axis, el)
    const press = (event: PointerEvent) => {
      if (!host.viewport() || !accepts(event)) return
      event.stopPropagation()
      event.preventDefault()
      if (axis === "x") host.readDirection()
      host.measure()
      drag(el, event, axis, host.metrics[axis].position)
    }
    el.addEventListener("pointerdown", press)
    return () => {
      el.removeEventListener("pointerdown", press)
      endPress(el)
      if (thumbs.get(axis) === el) thumbs.delete(axis)
    }
  }

  function pressTrack(event: PointerEvent, el: HTMLElement, axis: Axis) {
    if (!host.viewport() || !accepts(event)) return
    event.preventDefault()
    if (axis === "x") host.readDirection()
    host.measure()
    const metrics = host.metrics[axis]
    let point = trackPoint(el, axis, event)
    if (event.altKey) {
      const position = positionAt(point, metrics, host.track[axis])
      host.scrollTo(axis, position)
      const thumb = thumbs.get(axis)
      if (thumb) drag(thumb, event, axis, position)
      return
    }
    const direction = pageDirection(point, thumbGeometry(metrics, host.track[axis]))
    if (direction === 0) return
    if (axis === "y" && direction < 0) host.release()
    const page = Math.max(1, Math.round(metrics.client * pageFraction))
    const max = maxScroll(metrics)
    let target = metrics.position
    const step = () => {
      const thumb = thumbGeometry({ ...host.metrics[axis], position: target }, host.track[axis])
      if (pageDirection(point, thumb) !== direction) return false
      target = Math.min(Math.max(target + direction * page, 0), max)
      host.scrollTo(axis, target, "auto")
      return target > 0 && target < max
    }
    const view = el.ownerDocument.defaultView ?? window
    let timer = 0
    const tick = (wait: number) => {
      timer = view.setTimeout(() => {
        if (step()) tick(repeatInterval)
      }, wait)
    }
    if (step()) tick(repeatDelay)
    follow(el, event, {
      onMove: (sample) => {
        point = trackPoint(el, axis, sample.event)
      },
      onEnd: () => view.clearTimeout(timer),
    })
  }

  return { forwardWheel, bindThumb, pressTrack, endPress }
}

export { createScrollbarInput }
