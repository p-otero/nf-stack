"use client"

import { useCallback, useLayoutEffect, useRef } from "react"

type Intent = "panel" | "card" | null

function selectButton(root: HTMLElement | null, id: string | null) {
  if (!root || id === null) return null
  const escaped = CSS.escape(id)
  return root.querySelector<HTMLElement>(
    `[data-task-select][data-task-id="${escaped}"], [data-item-id="${escaped}"] [data-slot="list-item-primary"]`,
  )
}

/**
 * Moves focus into the side panel when a person opens it, and back to the task's card or row
 * when it closes. An agent's selection leaves focus where it is, unless closing the panel
 * dropped it on the body. A modal detail moves focus itself; `cardOfLastTask` is where it
 * returns focus to.
 */
function useBoardFocus(selectedId: string | null, { modal = false } = {}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const intent = useRef<Intent>(null)
  const previous = useRef<string | null>(selectedId)
  const lastTask = useRef<string | null>(selectedId)

  useLayoutEffect(() => {
    const wanted = intent.current
    const closed = previous.current
    intent.current = null
    previous.current = selectedId
    if (selectedId !== null) lastTask.current = selectedId
    const root = bodyRef.current
    if (!root || modal) return
    if (selectedId !== null) {
      if (wanted === "panel") root.querySelector<HTMLElement>('[data-slot="task-detail-title"]')?.focus()
      return
    }
    const lost = document.activeElement === null || document.activeElement === document.body
    if (closed !== null && (wanted === "card" || lost)) selectButton(root, closed)?.focus()
  }, [selectedId, modal])

  const focusPanelNext = useCallback(() => {
    intent.current = "panel"
  }, [])
  const focusCardNext = useCallback(() => {
    intent.current = "card"
  }, [])
  const cardOfLastTask = useCallback(() => selectButton(bodyRef.current, lastTask.current), [])

  return { bodyRef, focusPanelNext, focusCardNext, cardOfLastTask }
}

export { useBoardFocus }
