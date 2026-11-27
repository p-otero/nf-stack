"use client"

import { createContext, use } from "react"

import type { ListSortableRowsProps } from "@/components/ui/list-sortable"

type ListVariant = "row" | "card"
type ItemHandle = { label: string; activate: () => boolean }

type ListContextValue = {
  variant: ListVariant
  selectable: boolean
  /** Rows hold actions: the list is a grid, each row a primary cell and one cell per action. */
  grid: boolean
  register: (id: string, handle: ItemHandle) => () => void
  select: (id: string, event: Event) => boolean
  /** Rows that Space or `x` check, for bulk actions; undefined when the list has none. */
  checked?: { has: (id: string) => boolean; toggle: (id: string) => void }
  /** Set while rows reorder: each row gets a drag handle. */
  sortable?: { labels?: ListSortableRowsProps["labels"] }
}

/** Where a data row sits among all rows, while the list is virtualized. */
type ListItemPosition = {
  index: number
  setsize: number
  /** The virtualizer's ref for the row; it returns the cleanup that stops measuring. */
  measure?: (node: HTMLElement | null) => (() => void) | undefined
}

const ListContext = createContext<ListContextValue | null>(null)
const PositionContext = createContext<ListItemPosition | null>(null)

function useListContext() {
  return use(ListContext)
}

function useListItemPosition() {
  return use(PositionContext)
}

const containerClassNames = {
  row: "flex flex-col",
  card: "grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-items",
} satisfies Record<ListVariant, string>

export { containerClassNames, ListContext, PositionContext, useListContext, useListItemPosition }
export type { ItemHandle, ListContextValue, ListItemPosition, ListVariant }
