"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import type { ReactNode } from "react"

import { Sortable } from "@/components/ui/sortable"
import type { SortableLabels } from "@/components/ui/sortable-labels"
import type { SortableReason } from "@/components/ui/sortable-primitive"

const containerClassNames = {
  row: "gap-0",
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- the List's own card grid, which the sortable replaces
  card: "grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]",
}

type ListSortableRowsProps = {
  label: string
  grid: boolean
  ids: string[]
  indexOf: ReadonlyMap<string, number>
  textAt: (index: number) => string
  checkedIds?: readonly string[]
  onCheckedIdsChange?: (ids: string[]) => void
  onReorder?: (ids: string[], details: ChangeDetails<SortableReason>) => void
  labels?: Partial<SortableLabels>
  renderRow: (index: number) => ReactNode
}

function ListSortableRows({
  label,
  grid,
  ids,
  indexOf,
  textAt,
  checkedIds,
  onCheckedIdsChange,
  onReorder,
  labels,
  renderRow,
}: ListSortableRowsProps) {
  return (
    <Sortable
      aria-label={label}
      handle
      variant="plain"
      orientation={grid ? "grid" : "vertical"}
      value={ids}
      onValueChange={(next, details) => onReorder?.(next, details)}
      selected={checkedIds}
      onSelectedChange={onCheckedIdsChange && ((next) => onCheckedIdsChange(next))}
      itemLabel={(id) => {
        const index = indexOf.get(id)
        return index === undefined ? undefined : textAt(index)
      }}
      labels={labels}
      render={<ul />}
      className={grid ? containerClassNames.card : containerClassNames.row}
    >
      {({ order }) =>
        order.map((id) => {
          const index = indexOf.get(id)
          return index === undefined ? null : renderRow(index)
        })
      }
    </Sortable>
  )
}

export { ListSortableRows }
export type { ListSortableRowsProps }
