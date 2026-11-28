"use client"

import { useEffect, type RefObject } from "react"

const keyboardless = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
])

function opensKeyboard(target: EventTarget | null) {
  let element = target instanceof Element ? target : null
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable || element instanceof HTMLTextAreaElement || element instanceof HTMLIFrameElement) {
    return true
  }
  return element instanceof HTMLInputElement && !keyboardless.has(element.type)
}

const viewportProperties = ["--dialog-viewport-top", "--dialog-viewport-bottom", "--dialog-viewport-height"]

// Workaround: writes the visual viewport for CSS to place against the containing block, not `innerHeight` (stale on iOS 26).
// Toolbars also shorten the visible part, where UI SDK's `data-keyboard` (beta.12) misfires, so `data-dialog-keyboard`
// also needs a focused field. Pinch-zoomed, the visual viewport is a window into the page: the last box stays.
function useVisualViewportBox(contentRef: RefObject<HTMLElement | null>, parentClassName?: string) {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    let pageScale = 1
    let written: HTMLElement | null = null
    // Perf: with `parentClassName`, the box and the classes go on the parent (a Drawer's viewport). Its `!` classes outrank
    // the inline `--keyboard-inset` UI SDK lays it out from, before UI SDK measures; a rule on the content would need
    // `:has()`, which makes every DOM change on the page check ancestors again.
    const classes = parentClassName?.split(" ").filter(Boolean) ?? []
    const clear = () => {
      for (const name of viewportProperties) written?.style.removeProperty(name)
      written?.classList.remove(...classes)
      written?.removeAttribute("data-dialog-keyboard")
    }
    const update = (event?: Event) => {
      const content = parentClassName ? (contentRef.current?.parentElement ?? null) : contentRef.current
      if (content !== written) {
        clear()
        content?.classList.add(...classes)
      }
      written = content
      if (!content) return undefined
      if (Math.abs(viewport.height - window.innerHeight) <= 1) pageScale = viewport.scale
      if (viewport.scale > pageScale + 0.01) return undefined
      const bottom = viewport.offsetTop + viewport.height
      content.style.setProperty("--dialog-viewport-top", `${String(Math.round(viewport.offsetTop))}px`)
      content.style.setProperty("--dialog-viewport-bottom", `${String(Math.round(bottom))}px`)
      content.style.setProperty("--dialog-viewport-height", `${String(Math.round(viewport.height))}px`)
      const typing =
        opensKeyboard(document.activeElement) ||
        (event instanceof FocusEvent && event.type === "focusout" && opensKeyboard(event.relatedTarget))
      content.toggleAttribute("data-dialog-keyboard", typing && window.innerHeight - bottom > 1)
      return undefined
    }
    update()
    const frame = requestAnimationFrame(() => update())
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    document.addEventListener("focusin", update)
    document.addEventListener("focusout", update)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      document.removeEventListener("focusin", update)
      document.removeEventListener("focusout", update)
      clear()
    }
  }, [contentRef, parentClassName])
}

export { useVisualViewportBox }
