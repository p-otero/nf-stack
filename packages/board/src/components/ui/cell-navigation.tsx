"use client"

import { usePart, usePrimitive, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { cloneElement, createContext, isValidElement, use, useId, type ReactElement, type ReactNode } from "react"

import { cellNavigation, type CellNavigationOptions } from "@/components/ui/cell-navigation-primitive"

type CellNavigationHandle = PrimitiveHandle<typeof cellNavigation>

const CellNavigationContext = createContext<CellNavigationHandle | null>(null)
const CellIdContext = createContext("")

/** The instance that gives a table's cells one tab stop; pass it to `CellNavigationProvider`. */
function useCellNavigation(options: CellNavigationOptions) {
  return usePrimitive(cellNavigation, options)
}

function CellNavigationProvider({ handle, children }: { handle: CellNavigationHandle | null; children: ReactNode }) {
  const prefix = useId()
  return (
    <CellNavigationContext value={handle}>
      <CellIdContext value={prefix}>{children}</CellIdContext>
    </CellNavigationContext>
  )
}

function NavigableCellPart({
  handle,
  row,
  col,
  render,
}: {
  handle: CellNavigationHandle
  row: number
  col: number
  render: ReactElement
}) {
  const id = `${use(CellIdContext)}-${String(row)}-${String(col)}`
  // The cell keeps its own `data-slot` (`table-cell`), which the part would otherwise replace with its slot's.
  return usePart(
    handle,
    "cell",
    { row, col, id },
    {
      render: (part: Record<string, unknown>) =>
        isValidElement<Record<string, unknown>>(render)
          ? cloneElement(render, { ...part, "data-slot": "table-cell" })
          : render,
    },
  )
}

/** Makes `render`, a table cell, the cell at `row` and `col`. Outside a `CellNavigationProvider` it renders unchanged. */
function NavigableCell({ row, col, render }: { row: number; col: number; render: ReactElement }) {
  const handle = use(CellNavigationContext)
  if (!handle) return render
  return <NavigableCellPart handle={handle} row={row} col={col} render={render} />
}

/** Whether cells take the keys here, so rows leave the tab stop to them. */
function useCellNavigationActive() {
  return use(CellNavigationContext) !== null
}

export { CellNavigationProvider, NavigableCell, useCellNavigation, useCellNavigationActive }
export type { CellNavigationHandle, CellNavigationOptions }
