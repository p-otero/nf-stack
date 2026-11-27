"use client"

import { usePart, usePrimitive, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { createContext, use, type ReactElement, type ReactNode } from "react"

import { cellKey, listGrid, type ListGridOptions } from "@/components/ui/list-grid-primitive"

type ListGridHandle = PrimitiveHandle<typeof listGrid>

const ListGridContext = createContext<ListGridHandle | null>(null)

/** The instance behind a List whose rows hold actions; its parts render only while the List is a grid. */
function useListGridInstance(options: ListGridOptions) {
  return usePrimitive(listGrid, options)
}

function ListGridProvider({ handle, children }: { handle: ListGridHandle | null; children: ReactNode }) {
  return <ListGridContext value={handle}>{children}</ListGridContext>
}

/** The grid of the List around a row, or null when its rows are a list or a listbox. */
function useListGrid() {
  return use(ListGridContext)
}

/** The List's own element, as the grid: `role="grid"`. It keeps the List's `data-slot`, which the part would replace. */
function ListGridRoot({ handle, ...props }: { handle: ListGridHandle } & Record<string, unknown>) {
  return usePart(
    handle,
    "root",
    {},
    { ...props, render: (part: Record<string, unknown>) => <div {...part} data-slot="list" /> },
  )
}

/** Makes `render` the row with `id`: `role="row"`, with `aria-selected` in a selectable list. */
function ListGridRow({ handle, id, render }: { handle: ListGridHandle; id: string; render: ReactElement }) {
  return usePart(handle, "row", { value: id }, { render })
}

/**
 * Makes `render`, a link or button, the focusable content of a cell, at column `col` of row `id`. A function gets the
 * cell's props to put on the element a Button renders, which keeps the props it doesn't know.
 */
function ListGridCell({
  handle,
  id,
  col,
  render,
}: {
  handle: ListGridHandle
  id: string
  col: number
  render: ReactElement | ((part: Record<string, unknown>) => ReactElement)
}) {
  return usePart(handle, "cell", { value: cellKey(id, col) }, { render })
}

export { ListGridCell, ListGridProvider, ListGridRoot, ListGridRow, useListGrid, useListGridInstance }
export type { ListGridHandle }
