"use client"

import { createContext, use, useLayoutEffect } from "react"

const CardTitleContext = createContext<((id: string | undefined) => void) | null>(null)

/** Names the enclosing Card by this title's id while the title is mounted. */
function useCardTitleRegistration(titleId: string) {
  const register = use(CardTitleContext)
  useLayoutEffect(() => {
    register?.(titleId)
    return () => register?.(undefined)
  }, [register, titleId])
}

export { CardTitleContext, useCardTitleRegistration }
