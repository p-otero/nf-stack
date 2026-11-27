"use client"

import { usePart, usePrimitive, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { createContext, use, type ReactElement, type ReactNode } from "react"

import { rowNavigation, type RowNavigationOptions } from "@/components/ui/row-navigation-primitive"

type RowNavigationHandle = PrimitiveHandle<typeof rowNavigation>

const RowNavigationContext = createContext<RowNavigationHandle | null>(null)

/** The instance that gives a collection's rows one tab stop; pass it to `RowNavigationProvider`. */
function useRowNavigation(options: RowNavigationOptions) {
  return usePrimitive(rowNavigation, options)
}

function RowNavigationProvider({ handle, children }: { handle: RowNavigationHandle; children: ReactNode }) {
  return <RowNavigationContext value={handle}>{children}</RowNavigationContext>
}

function NavigableRowPart({ handle, id, render }: { handle: RowNavigationHandle; id: string; render: ReactElement }) {
  return usePart(handle, "row", { value: id }, { render })
}

/**
 * Makes `render` (a row, or a row's link or button) one of the collection's rows. Outside a
 * `RowNavigationProvider` it renders `render` unchanged.
 */
function NavigableRow({ id, render }: { id: string; render: ReactElement }) {
  const handle = use(RowNavigationContext)
  if (!handle) return render
  return <NavigableRowPart handle={handle} id={id} render={render} />
}

export { NavigableRow, RowNavigationProvider, useRowNavigation }
export type { RowNavigationHandle, RowNavigationOptions }
