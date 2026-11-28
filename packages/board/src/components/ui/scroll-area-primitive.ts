import { createController, css, definePrimitive, live } from "@ui-sdk/core"

import {
  mainAxis,
  type Axis,
  type ScrollAreaModel,
  type ScrollAreaScrollOptions,
  type ScrollAreaType,
} from "@/components/ui/scroll-area-model"
import { createScrollView } from "@/components/ui/scroll-area-view"

type ScrollAreaController = {
  /** Scrolls to the end: the bottom, or the inline end when only the horizontal axis overflows. */
  scrollToEnd: (options?: ScrollAreaScrollOptions) => void
  /** Scrolls to the start: the top, or the inline start when only the horizontal axis overflows. */
  scrollToStart: (options?: ScrollAreaScrollOptions) => void
  /** Whether the view is at the end now, even in a scroll event, before the attributes catch up. */
  isAtEnd: () => boolean
  /** Whether the view is at the start now, even in a scroll event, before the attributes catch up. */
  isAtStart: () => boolean
  /** Whether the view follows the end as the content grows, with `stickToEnd`. */
  isSticking: () => boolean
}

type ScrollAreaOptions = {
  /** When the scrollbars show: "auto" while the content overflows, "always", "scroll" while scrolling, "hover" (default) also while hovered. */
  type?: ScrollAreaType
  /** How long scrollbars stay after they stop being needed, in ms, with "scroll" and "hover". Defaults to 600. */
  scrollHideDelay?: number
  /** Keeps the end in view while the content grows; scrolling toward the start lets go. */
  stickToEnd?: boolean
  /** Drives it from anywhere. Create one with `createScrollAreaController()`. */
  controller?: ScrollAreaController
}

type Orientation = "horizontal" | "vertical"
type ScrollAreaScrollbarState = {
  orientation: Orientation
  visible: boolean
  scrolling: boolean
  hovering: boolean
  dragging: boolean
}
type ScrollAreaThumbState = { orientation: Orientation; dragging: boolean }

function createScrollAreaController() {
  return createController<ScrollAreaController>()
}

const axisOf = (orientation: unknown): Axis => (orientation === "horizontal" ? "x" : "y")
const orientationOf = (orientation: unknown): Orientation => (orientation === "horizontal" ? "horizontal" : "vertical")
const atStart = (state: ScrollAreaModel) => (mainAxis(state) === "x" ? state.atXStart : state.atYStart)
const atEnd = (state: ScrollAreaModel) => (mainAxis(state) === "x" ? state.atXEnd : state.atYEnd)
const hasScrollbars = (state: ScrollAreaModel) => state.scrollbarsX + state.scrollbarsY > 0
const endButtonShown = (state: ScrollAreaModel) => !atEnd(state) && !(state.stickToEnd && state.sticking)
const flag = (value: boolean) => (value ? "" : undefined)

const areaState = (state: ScrollAreaModel) => ({
  overflowX: state.overflowX,
  overflowY: state.overflowY,
  atStart: atStart(state),
  atEnd: atEnd(state),
  scrolling: state.scrollingX || state.scrollingY,
  hovering: state.hovering,
  sticking: state.stickToEnd && state.sticking,
})
const overflowAttrs = (state: ScrollAreaModel) => ({
  "data-overflow-x": flag(state.overflowX),
  "data-overflow-y": flag(state.overflowY),
})
const scrollAttrs = /* @__PURE__ */ live<ScrollAreaModel, unknown, unknown>((state) => ({
  "data-at-start": flag(atStart(state)),
  "data-at-end": flag(atEnd(state)),
  "data-at-x-start": flag(state.atXStart),
  "data-at-x-end": flag(state.atXEnd),
  "data-at-y-start": flag(state.atYStart),
  "data-at-y-end": flag(state.atYEnd),
  "data-scrolling": flag(state.scrollingX || state.scrollingY),
  "data-hovering": flag(state.hovering),
  "data-sticking": flag(state.stickToEnd && state.sticking),
}))
// Perf: the frame variables are registered as not inherited; this keeps an unregistered fallback from the content.
const contentShield = /* @__PURE__ */ Object.fromEntries(
  ["x", "y"].flatMap((axis) =>
    [`overflow-${axis}-start`, `overflow-${axis}-end`, `progress-${axis}`].map((name) => [
      `--scroll-area-${name}`,
      "initial",
    ]),
  ),
)

const settings = (options: ScrollAreaOptions) => ({
  type: options.type ?? "hover",
  scrollHideDelay: options.scrollHideDelay ?? 600,
  stickToEnd: options.stickToEnd ?? false,
})

const scrollArea = /* @__PURE__ */ definePrimitive({
  name: "scroll-area",
  options: {
    type: "string",
    scrollHideDelay: "number",
    stickToEnd: "boolean",
    controller: "value",
  },
  state: (options: ScrollAreaOptions): ScrollAreaModel => ({
    ...settings(options),
    scrollbarsX: 0,
    scrollbarsY: 0,
    counted: false,
    overflowX: false,
    overflowY: false,
    atXStart: true,
    atXEnd: true,
    atYStart: true,
    atYEnd: true,
    scrollingX: false,
    scrollingY: false,
    hovering: false,
    visibleX: false,
    visibleY: false,
    dragging: null,
    sticking: Boolean(options.stickToEnd),
  }),
  live: [
    "atXStart",
    "atXEnd",
    "atYStart",
    "atYEnd",
    "scrollingX",
    "scrollingY",
    "hovering",
    "visibleX",
    "visibleY",
    "dragging",
    "sticking",
  ],
  sync: settings,
  controlled: [],
  api: (context) => {
    const { store } = context
    const view = createScrollView(store)
    let { stickToEnd, type, scrollHideDelay } = store.get()
    let destroyed = false
    context.onDestroy(() => (destroyed = true))
    context.onDestroy(
      store.subscribe(() => {
        const state = store.get()
        if (state.stickToEnd === stickToEnd && state.type === type && state.scrollHideDelay === scrollHideDelay) return
        if (state.stickToEnd !== stickToEnd) store.set({ sticking: state.stickToEnd })
        ;({ stickToEnd, type, scrollHideDelay } = state)
        queueMicrotask(() => destroyed || view.refresh())
      }),
    )
    return {
      scrollToEnd: (options?: ScrollAreaScrollOptions) => view.scrollToEdge("end", options),
      scrollToStart: (options?: ScrollAreaScrollOptions) => view.scrollToEdge("start", options),
      isAtEnd: () => view.isAt("end") ?? atEnd(store.get()),
      isAtStart: () => view.isAt("start") ?? atStart(store.get()),
      isSticking: () => store.get().stickToEnd && store.get().sticking,
      internal: view,
    }
  },
  slots: (slot) => ({
    root: slot({
      state: areaState,
      attrs: (state) => ({
        ...overflowAttrs(state),
        style: "position:relative",
      }),
      live: scrollAttrs,
      bind: (el, { api }) => api.internal.bindRoot(el),
    }),
    viewport: slot({
      state: areaState,
      attrs: (state) => ({
        ...overflowAttrs(state),
        style: css({
          overflow: "auto",
          "scrollbar-width": !state.counted || hasScrollbars(state) ? "none" : undefined,
        }),
      }),
      live: scrollAttrs,
      bind: (el, { api }) => api.internal.bindViewport(el),
    }),
    content: slot({
      state: areaState,
      attrs: (state) => ({
        ...overflowAttrs(state),
        style: css({
          "min-width": state.scrollbarsX > 0 ? "fit-content" : undefined,
          ...contentShield,
        }),
      }),
      live: scrollAttrs,
    }),
    // Spec: hidden from assistive technology; the viewport scrolls natively, which screen readers already use.
    scrollbar: slot<{ orientation?: Orientation }, ScrollAreaScrollbarState>({
      props: { orientation: "string" },
      state: (state, { props }) => {
        const axis = axisOf(props.orientation)
        return {
          orientation: orientationOf(props.orientation),
          visible: axis === "x" ? state.visibleX : state.visibleY,
          scrolling: axis === "x" ? state.scrollingX : state.scrollingY,
          hovering: state.hovering,
          dragging: state.dragging === axis,
        }
      },
      attrs: (state, { props }) => {
        const axis = axisOf(props.orientation)
        const overflow = axis === "x" ? state.overflowX : state.overflowY
        return {
          "aria-hidden": "true",
          "data-orientation": orientationOf(props.orientation),
          ...overflowAttrs(state),
          style: css({
            position: "absolute",
            "touch-action": "none",
            "user-select": "none",
            "-webkit-user-select": "none",
            ...(axis === "y"
              ? {
                  top: 0,
                  bottom: "var(--scroll-area-corner-height,0px)",
                  "inset-inline-end": 0,
                }
              : {
                  bottom: 0,
                  "inset-inline-start": 0,
                  "inset-inline-end": "var(--scroll-area-corner-width,0px)",
                }),
            display: overflow || state.type === "always" ? undefined : "none",
          }),
        }
      },
      live: live((state, { props }) => {
        const axis = axisOf(props.orientation)
        const visible = axis === "x" ? state.visibleX : state.visibleY
        return {
          "data-visible": flag(visible),
          "data-scrolling": flag(axis === "x" ? state.scrollingX : state.scrollingY),
          "data-hovering": flag(state.hovering),
          "data-dragging": flag(state.dragging === axis),
          style: visible ? undefined : "pointer-events:none",
        }
      }),
      bind: (el, part) => part.api.internal.bindScrollbar(el, axisOf(part.props.orientation)),
    }),
    thumb: slot<{ orientation?: Orientation }, ScrollAreaThumbState>({
      props: { orientation: { kind: "string", from: "scrollbar" } },
      state: (state, { props }) => ({
        orientation: orientationOf(props.orientation),
        dragging: state.dragging === axisOf(props.orientation),
      }),
      attrs: (state, { props }) => {
        const axis = axisOf(props.orientation)
        const overflow = axis === "x" ? state.overflowX : state.overflowY
        return {
          "data-orientation": orientationOf(props.orientation),
          style: css(
            axis === "y"
              ? {
                  height: "var(--scroll-area-thumb-height)",
                  transform: "translate3d(0,var(--scroll-area-thumb-offset,0px),0)",
                  display: overflow ? undefined : "none",
                }
              : {
                  width: "var(--scroll-area-thumb-width)",
                  transform: "translate3d(var(--scroll-area-thumb-offset,0px),0,0)",
                  display: overflow ? undefined : "none",
                },
          ),
        }
      },
      live: live((state, { props }) => ({
        "data-dragging": flag(state.dragging === axisOf(props.orientation)),
      })),
      bind: (el, part) => part.api.internal.bindThumb(el, axisOf(part.props.orientation)),
    }),
    corner: slot({
      attrs: (state) => ({
        "aria-hidden": "true",
        style: css({
          position: "absolute",
          bottom: 0,
          "inset-inline-end": 0,
          width: "var(--scroll-area-corner-width)",
          height: "var(--scroll-area-corner-height)",
          display:
            state.overflowX && state.overflowY && state.scrollbarsX > 0 && state.scrollbarsY > 0 ? undefined : "none",
        }),
      }),
    }),
    "scroll-to-end": slot({
      state: (state) => ({ visible: endButtonShown(state) }),
      attrs: () => ({ type: "button" }),
      live: live((state) => ({
        "data-visible": flag(endButtonShown(state)),
        inert: flag(!endButtonShown(state)),
      })),
      press: ({ api, el }, event) => {
        if (el && el.ownerDocument.activeElement === el) api.internal.focusViewport()
        api.scrollToEnd()
        event?.preventDefault()
      },
    }),
  }),
  agent: { actions: ["scrollToStart", "scrollToEnd"] },
})

export {
  createScrollAreaController,
  scrollArea,
  type Orientation,
  type ScrollAreaController,
  type ScrollAreaOptions,
  type ScrollAreaScrollbarState,
  type ScrollAreaThumbState,
}
