"use client"

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

type FocusMemory = { opener: HTMLElement | null; movedBeforeOpen: boolean }

function focusedElement() {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

function openModals() {
  const modals = [...document.querySelectorAll('[aria-modal="true"]')]
  try {
    modals.push(...document.querySelectorAll("dialog:modal"))
  } catch {
    // Engines without :modal (jsdom) still see modals by aria-modal.
  }
  return modals.filter((modal) => !modal.hasAttribute("data-ending-style"))
}

// A closing dialog gives focus back only from inside itself, or from <body> when no other modal is open. Another
// modal opened meanwhile (one of ours or another library's, which may move focus in a frame later) keeps it.
function mayReturnFocus(own: Element | null, active: Element | null = focusedElement()) {
  if (active) return own?.contains(active) ?? false
  return !openModals().some((modal) => modal !== own && !own?.contains(modal))
}

/** Records the focused element once, on mount. */
function useRecordOpener(memoryRef: RefObject<FocusMemory>) {
  const recorded = useRef(false)
  useLayoutEffect(() => {
    if (recorded.current) return
    recorded.current = true
    memoryRef.current = { opener: focusedElement(), movedBeforeOpen: false }
  }, [memoryRef])
}

/** Notes, once, whether focus moved away from the recorded opener between the two markers' layout effects. */
function useRecordFocusMove(memoryRef: RefObject<FocusMemory>) {
  const checked = useRef(false)
  useLayoutEffect(() => {
    if (checked.current) return
    checked.current = true
    memoryRef.current = { ...memoryRef.current, movedBeforeOpen: focusedElement() !== memoryRef.current.opener }
  }, [memoryRef])
}

/**
 * When the on-screen keyboard comes up, the content shrinks to the part of the page above it (`data-dialog-keyboard`
 * on a dialog's content, UI SDK's `data-keyboard` on a drawer's viewport), which can leave the field typed in below the fold of
 * the content's scroll area. Scrolls it back into view once the new size is laid out.
 */
function useFocusAboveKeyboard(contentRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    let frame = 0
    const reveal = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const content = contentRef.current
        const active = focusedElement()
        if (active && content?.closest("[data-keyboard], [data-dialog-keyboard]") && content.contains(active)) {
          active.scrollIntoView({ block: "nearest", inline: "nearest" })
        }
      })
    }
    viewport.addEventListener("resize", reveal)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener("resize", reveal)
    }
  }, [contentRef])
}

function scrollLocked(element: Element) {
  return /hidden|clip/.test(getComputedStyle(element).overflow)
}

function pageLocked() {
  return scrollLocked(document.documentElement) || scrollLocked(document.body)
}

/**
 * Puts the page back where it was when something scrolls it while the dialog is open and the page is locked. WebKit
 * scrolls it for the text selection UI SDK makes in a field it focuses (0.1.0-beta.10, opening by controller, as
 * from a menu item), although the field is in a fixed dialog, so the page moves under the backdrop.
 */
function useKeepPageStill(contentRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let x = window.scrollX
    let y = window.scrollY
    const restore = () => {
      if (contentRef.current?.hasAttribute("data-open") && pageLocked()) {
        if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y)
        return
      }
      x = window.scrollX
      y = window.scrollY
    }
    window.addEventListener("scroll", restore)
    return () => window.removeEventListener("scroll", restore)
  }, [contentRef])
}

export { focusedElement, mayReturnFocus, useFocusAboveKeyboard, useKeepPageStill, useRecordFocusMove, useRecordOpener }
export type { FocusMemory }
