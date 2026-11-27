"use client"

import { useEffect, useEffectEvent, useLayoutEffect, type RefObject } from "react"

import type { BoardCardStop } from "@/components/ui/board-navigation"

const focusable = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [data-board-tabindex]'

function applyTabStops(root: HTMLElement, primary: string, active: boolean) {
  for (const control of root.querySelectorAll<HTMLElement>(focusable)) {
    if (control.matches(primary)) continue
    const saved = control.dataset.boardTabindex
    if (active && saved !== undefined) {
      if (saved === "") control.removeAttribute("tabindex")
      else control.setAttribute("tabindex", saved)
      delete control.dataset.boardTabindex
    } else if (!active && saved === undefined) {
      control.dataset.boardTabindex = control.getAttribute("tabindex") ?? ""
      control.tabIndex = -1
    }
  }
}

/**
 * Keeps a board card's own controls out of the tab order unless the card holds the board's stop, following it by
 * subscription so a move never renders the card. Leaves `primary`, the card's roving part, alone. Focus landing on
 * one of its controls gives the card the stop.
 */
function useCardTabStops(card: RefObject<HTMLElement | null>, primary: string, stop: BoardCardStop | null) {
  const sync = useEffectEvent(() => {
    if (card.current) applyTabStops(card.current, primary, !stop || stop.holds())
  })
  useLayoutEffect(() => sync())
  useEffect(() => {
    const root = card.current
    if (!root || !stop) return undefined
    const unsubscribe = stop.subscribe(sync)
    root.addEventListener("focusin", stop.take)
    return () => {
      unsubscribe()
      root.removeEventListener("focusin", stop.take)
    }
  }, [card, stop])
}

export { useCardTabStops }
