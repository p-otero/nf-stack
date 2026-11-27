import { assumeType } from "@/lib/narrow"
/**
 * UI SDK's virtualizer puts its findable layers, a stand-in for every row, at the start and end of the element it
 * scrolls. A ScrollArea viewport reads every focusable element below it again whenever a tabindex below it changes,
 * which a roving tree or grid does on every arrow key, so the layers go in the scroll area's root beside the viewport
 * instead: 8 ms a key press on 50,000 commits at 4× CPU. They are absolutely positioned against the root either way.
 */
function layersBesideViewport(scroller: HTMLElement) {
  const root = scroller.parentElement
  if (root?.dataset.slot !== "scroll-area") return () => {}
  scroller.prepend = (...nodes) => root.prepend(...nodes)
  scroller.append = (...nodes) => root.append(...nodes)
  return () => {
    Reflect.deleteProperty(scroller, "prepend")
    Reflect.deleteProperty(scroller, "append")
  }
}

// UI SDK's virtualizer connects to a scrolling element; a list that scrolls with the page goes through this stand-in
// for the window. It has no ResizeObserver of its own: its caller follows the window's resize instead.
function windowScroller(view: Window) {
  const scroller = {
    get scrollTop() {
      return view.scrollY
    },
    set scrollTop(top: number) {
      view.scrollTo({ top })
    },
    get scrollLeft() {
      return view.scrollX
    },
    set scrollLeft(left: number) {
      view.scrollTo({ left })
    },
    get clientHeight() {
      return view.innerHeight
    },
    get clientWidth() {
      return view.innerWidth
    },
    scrollTo: (options: ScrollToOptions) => view.scrollTo(options),
    // The findable layers go in the page's body, positioned against the viewport.
    clientTop: 0,
    clientLeft: 0,
    getBoundingClientRect: () => new DOMRect(0, 0, view.innerWidth, view.innerHeight),
    prepend: (node: Node) => view.document.body.prepend(node),
    append: (node: Node) => view.document.body.append(node),
    addEventListener: (type: string, listener: EventListener, options?: AddEventListenerOptions) =>
      view.addEventListener(type, listener, options),
    removeEventListener: (type: string, listener: EventListener) => view.removeEventListener(type, listener),
    // No defaultView, so the virtualizer adds no ResizeObserver to the stand-in; its caller follows the window.
    ownerDocument: {
      defaultView: {},
      createElement: (tag: string) => view.document.createElement(tag),
      createTextNode: (text: string) => view.document.createTextNode(text),
    },
  }
  // A stand-in with only the members UI SDK's virtualizer reads from its scrolling element, which it types as an
  // HTMLElement.
  return assumeType<HTMLElement>(scroller)
}

export { layersBesideViewport, windowScroller }
