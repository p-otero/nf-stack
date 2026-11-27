"use client"

import { usePart, usePrimitive, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { createContext, use, useMemo, type ReactElement, type ReactNode } from "react"

import { boardNavigation, type BoardNavigationOptions } from "@/components/ui/board-navigation-primitive"

type BoardNavigationHandle = PrimitiveHandle<typeof boardNavigation>

const BoardNavigationContext = createContext<BoardNavigationHandle | null>(null)

/** The instance that gives a board's cards one tab stop; `Board` makes one and passes it down. */
function useBoardNavigation(options: BoardNavigationOptions = {}) {
  return usePrimitive(boardNavigation, options)
}

function BoardNavigationProvider({ handle, children }: { handle: BoardNavigationHandle; children: ReactNode }) {
  return <BoardNavigationContext value={handle}>{children}</BoardNavigationContext>
}

function BoardCardPart({ handle, id, render }: { handle: BoardNavigationHandle; id: string; render: ReactElement }) {
  return usePart(handle, "card", { value: id }, { render })
}

/**
 * Makes `render`, a card's primary link or button, one of the board's cards: one tab stop for the board, and the
 * arrow keys between cards. Outside a `Board` it renders `render` unchanged.
 */
function BoardCard({ id, render }: { id: string; render: ReactElement }) {
  const handle = use(BoardNavigationContext)
  if (!handle) return render
  return <BoardCardPart handle={handle} id={id} render={render} />
}

/** A card's view of the board's tab stop, without rendering it: whether it holds the stop, and a way to take it. */
type BoardCardStop = {
  holds: () => boolean
  subscribe: (listener: () => void) => () => void
  /** Gives the card the stop without moving focus. */
  take: () => void
}

/**
 * The tab stop of the board the card `id` is in, to read in effects and event handlers: reading it never renders
 * the card, so a move renders only the two cards' primary parts. Null outside a `Board`.
 */
function useBoardCardStop(id: string): BoardCardStop | null {
  const handle = use(BoardNavigationContext)
  return useMemo(
    () =>
      handle && {
        holds: () => handle.instance.get().active === id,
        subscribe: handle.instance.subscribe,
        take: () => {
          if (handle.instance.get().active !== id) handle.api.activate(id)
        },
      },
    [handle, id],
  )
}

export { BoardCard, BoardNavigationProvider, useBoardCardStop, useBoardNavigation }
export type { BoardCardStop, BoardNavigationHandle, BoardNavigationOptions }
