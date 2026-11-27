import { assumeType } from "@/lib/narrow"
type Axis = "x" | "y"
type Metrics = { position: number; client: number; scroll: number }

const edgeTolerance = 1
const minThumbSize = 16
const pageFraction = 0.875
const lineHeight = 16

const maxScroll = ({ client, scroll }: Metrics) => Math.max(0, scroll - client)
const overflows = (metrics: Metrics) => maxScroll(metrics) >= edgeTolerance
const clampedPosition = (metrics: Metrics) => Math.min(Math.max(metrics.position, 0), maxScroll(metrics))

function edgesOf(metrics: Metrics) {
  const max = maxScroll(metrics)
  if (max < edgeTolerance) return { before: 0, after: 0, atStart: true, atEnd: true, progress: 0 }
  const before = clampedPosition(metrics)
  const after = max - before
  return {
    before,
    after,
    atStart: before < edgeTolerance,
    atEnd: after < edgeTolerance,
    progress: before / max,
  }
}

function thumbGeometry(metrics: Metrics, track: number) {
  if (track <= 0 || metrics.scroll <= 0) return { size: 0, offset: 0 }
  const size = Math.min(track, Math.max(minThumbSize, (track * metrics.client) / metrics.scroll))
  const max = maxScroll(metrics)
  return {
    size,
    offset: max <= 0 ? 0 : ((track - size) * clampedPosition(metrics)) / max,
  }
}

function draggedPosition(start: number, delta: number, metrics: Metrics, track: number) {
  const travel = track - thumbGeometry(metrics, track).size
  if (travel <= 0) return start
  const max = maxScroll(metrics)
  return Math.min(Math.max(start + (delta / travel) * max, 0), max)
}

function positionAt(point: number, metrics: Metrics, track: number) {
  const { size } = thumbGeometry(metrics, track)
  const travel = track - size
  if (travel <= 0) return 0
  return Math.min(Math.max((point - size / 2) / travel, 0), 1) * maxScroll(metrics)
}

function pageDirection(point: number, thumb: { size: number; offset: number }) {
  if (point < thumb.offset) return -1
  return point > thumb.offset + thumb.size ? 1 : 0
}

function wheelPixels(delta: number, mode: number, page: number) {
  if (mode === 1) return delta * lineHeight
  return mode === 2 ? delta * page : delta
}

const px = (value: string) => Number.parseFloat(value) || 0

function scaleOf(el: HTMLElement, axis: Axis) {
  const rect = el.getBoundingClientRect()
  const layout = axis === "y" ? el.offsetHeight : el.offsetWidth
  const screen = axis === "y" ? rect.height : rect.width
  return layout > 0 && screen > 0 ? screen / layout : 1
}

function trackPoint(el: HTMLElement, axis: Axis, event: PointerEvent) {
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const scale = scaleOf(el, axis)
  if (axis === "y") return (event.clientY - rect.top) / scale - px(style.borderTopWidth) - px(style.paddingTop)
  if (style.direction === "rtl") {
    return (rect.right - event.clientX) / scale - px(style.borderRightWidth) - px(style.paddingRight)
  }
  return (event.clientX - rect.left) / scale - px(style.borderLeftWidth) - px(style.paddingLeft)
}

type ScrollAreaType = "auto" | "always" | "scroll" | "hover"

type ScrollAreaModel = {
  type: ScrollAreaType
  scrollHideDelay: number
  stickToEnd: boolean
  scrollbarsX: number
  scrollbarsY: number
  counted: boolean
  overflowX: boolean
  overflowY: boolean
  atXStart: boolean
  atXEnd: boolean
  atYStart: boolean
  atYEnd: boolean
  scrollingX: boolean
  scrollingY: boolean
  hovering: boolean
  visibleX: boolean
  visibleY: boolean
  dragging: Axis | null
  sticking: boolean
}

type ScrollAreaStore = {
  get: () => ScrollAreaModel
  set: (patch: Partial<ScrollAreaModel>) => void
  subscribe: (listener: () => void) => () => void
}

type ScrollAreaScrollOptions = { behavior?: "instant" | "smooth" }

const axes = ["x", "y"] as const
const names = {
  x: {
    overflow: "overflowX",
    atStart: "atXStart",
    atEnd: "atXEnd",
    scrolling: "scrollingX",
    visible: "visibleX",
    thumbSize: "--scroll-area-thumb-width",
    before: "--scroll-area-overflow-x-start",
    after: "--scroll-area-overflow-x-end",
    progress: "--scroll-area-progress-x",
  },
  y: {
    overflow: "overflowY",
    atStart: "atYStart",
    atEnd: "atYEnd",
    scrolling: "scrollingY",
    visible: "visibleY",
    thumbSize: "--scroll-area-thumb-height",
    before: "--scroll-area-overflow-y-start",
    after: "--scroll-area-overflow-y-end",
    progress: "--scroll-area-progress-y",
  },
} as const

const mainAxis = (state: Pick<ScrollAreaModel, "overflowX" | "overflowY">): Axis =>
  state.overflowX && !state.overflowY ? "x" : "y"

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

// Written on the root on every scroll. Inherited, they would restyle the whole content each time.
const frameVariables = /* @__PURE__ */ axes.flatMap((axis) => [
  names[axis].before,
  names[axis].after,
  names[axis].progress,
])
let registered = false
function registerFrameVariables() {
  if (registered || typeof CSS === "undefined" || !("registerProperty" in CSS)) return
  registered = true
  for (const name of frameVariables) {
    try {
      CSS.registerProperty({ name, syntax: "*", inherits: false })
    } catch {
      // Another copy of this module, or the app, registered it first.
    }
  }
}

const startwardKeys = /* @__PURE__ */ new Set(["ArrowUp", "PageUp", "Home"])
const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

function scrollsInside(target: EventTarget | null, viewport: HTMLElement) {
  for (let el = target instanceof Element ? target : null; el && el !== viewport; el = el.parentElement) {
    if (el.scrollTop <= 0 || el.scrollHeight <= el.clientHeight) continue
    const { overflowY } = getComputedStyle(el)
    if (overflowY === "auto" || overflowY === "scroll") return true
  }
  return false
}

function scrollbarShown(state: ScrollAreaModel, axis: Axis) {
  const name = names[axis]
  if (state.type === "always") return true
  if (!state[name.overflow]) return false
  if (state.type === "auto" || state.dragging === axis || state[name.scrolling]) return true
  return state.type === "hover" && state.hovering
}

/** Writes CSS variables only when their rounded value changes, and takes them off again. */
function createStyleWriter() {
  const written = new WeakMap<HTMLElement, Record<string, number>>()
  return {
    write(el: HTMLElement, property: string, value: number, unit = "px") {
      let values = written.get(el)
      if (!values) written.set(el, (values = {}))
      const rounded = Math.round(value * 100) / 100
      if (values[property] === rounded) return
      values[property] = rounded
      el.style.setProperty(property, `${String(rounded)}${unit}`)
    },
    clear(el: HTMLElement) {
      for (const property in written.get(el)) el.style.removeProperty(property)
      written.delete(el)
    },
  }
}

/** Focuses a viewport, programmatically focusable while it holds focus when it isn't a tab stop. */
function focusViewport(el: HTMLElement) {
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1")
    const restore = () => el.getAttribute("tabindex") === "-1" && el.removeAttribute("tabindex")
    el.addEventListener("blur", restore, { once: true })
  }
  el.focus({ preventScroll: true })
}

type Listeners = { [Type in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[Type]) => void }

function listen(el: HTMLElement, listeners: Listeners, options?: AddEventListenerOptions) {
  // Each listener takes the event of its own key; TypeScript can't correlate a key with its value through
  // `Object.entries`.
  const entries = assumeType<[string, EventListener][]>(Object.entries(listeners))
  for (const [type, listener] of entries) el.addEventListener(type, listener, options)
  return () => {
    for (const [type, listener] of entries) el.removeEventListener(type, listener, options)
  }
}

export {
  createStyleWriter,
  draggedPosition,
  listen,
  edgeTolerance,
  edgesOf,
  focusViewport,
  isEditing,
  mainAxis,
  maxScroll,
  names,
  overflows,
  pageDirection,
  pageFraction,
  positionAt,
  prefersReducedMotion,
  registerFrameVariables,
  scaleOf,
  scrollbarShown,
  scrollsInside,
  startwardKeys,
  thumbGeometry,
  trackPoint,
  wheelPixels,
  type Axis,
  type Metrics,
  type ScrollAreaModel,
  type ScrollAreaScrollOptions,
  type ScrollAreaStore,
  type ScrollAreaType,
}
