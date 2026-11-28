"use client"

import { memo, useCallback, type ReactElement, type ReactNode } from "react"

import { DataTableCheckbox, type DataTableColumn } from "@/components/ui/data-table-parts"
import { NavigableCell, useCellNavigationActive } from "@/components/ui/cell-navigation"
import { NavigableRow } from "@/components/ui/row-navigation"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { assumeType } from "@/lib/narrow"
import { cn } from "@/lib/utils"

// Perf: plain values and stable callbacks only, so `memo` skips a row when the table re-renders for a scroll, a sort
// or another row's selection.
type DataTableRowProps<Row> = {
  row: Row
  id: string
  columns: readonly DataTableColumn<Row>[]
  /** The checkbox's name; without it the row has no checkbox. */
  selectLabel?: string
  selected?: boolean
  /** Checks or unchecks the row by id; undefined `checked` flips it. */
  onToggle?: (id: string, checked?: boolean, event?: Event) => void
  /** The row's place among all rows, while the table is virtualized. */
  index?: number
  /** The row's place among the rows shown, for cell navigation. */
  position: number
  /** The virtualizer's ref for a row; it returns the cleanup that stops measuring. */
  measure?: (node: HTMLElement | null) => (() => void) | undefined
}

// Spec: a table row draws no box-shadow, and an outer outline would be clipped by the scroller, so the ring is inset.
const rowClassName =
  "scroll-mt-(--control-height) outline-none data-selected:bg-muted focus-visible:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

const cellClassName = "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

type GenericDataTableRow = <Row>(props: DataTableRowProps<Row>) => ReactNode

// Workaround: `memo` drops the row's type parameter; this gives it back.
const DataTableRow = assumeType<GenericDataTableRow>(
  memo(function DataTableRow<Row>(props: DataTableRowProps<Row>) {
    const cells = useCellNavigationActive()
    if (cells) return <DataTableRowElement {...props} cells />
    return <NavigableRow id={props.id} render={<DataTableRowElement {...props} />} />
  }),
)

function assignRef(ref: unknown, node: HTMLElement | null) {
  if (typeof ref === "function") return Reflect.apply(ref, undefined, [node])
  if (ref && typeof ref === "object") Reflect.set(ref, "current", node)
}

function DataTableRowElement<Row>({
  row,
  id,
  columns,
  selectLabel,
  selected = false,
  onToggle,
  index,
  position,
  measure,
  cells = false,
  ref,
  ...props
}: DataTableRowProps<Row> & { ref?: unknown; cells?: boolean } & Record<string, unknown>) {
  const rowRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      const cleanup = assignRef(ref, node)
      const unmeasure = measure?.(node)
      return () => {
        if (typeof unmeasure === "function") unmeasure()
        if (typeof cleanup === "function") cleanup()
        else assignRef(ref, null)
      }
    },
    [ref, measure],
  )
  const cellAt = (col: number, cell: ReactElement) =>
    cells ? <NavigableCell key={cell.key ?? col} row={position} col={col} render={cell} /> : cell
  return (
    <TableRow
      {...props}
      ref={rowRef}
      data-index={index}
      aria-rowindex={index === undefined ? undefined : index + 2}
      data-row-id={id}
      data-selected={selected ? "" : undefined}
      className={rowClassName}
    >
      {selectLabel !== undefined &&
        cellAt(
          0,
          <TableCell className="w-0">
            <DataTableCheckbox
              label={selectLabel}
              checked={selected}
              tabIndex={cells ? -1 : undefined}
              onChange={(checked, event) => onToggle?.(id, checked, event)}
            />
          </TableCell>,
        )}
      {columns.map((column, col) =>
        cellAt(
          col + (selectLabel === undefined ? 0 : 1),
          <TableCell
            key={column.id}
            data-align={column.align}
            wrap={column.wrap}
            className={cn(
              "data-[align=center]:text-center data-[align=end]:text-end",
              cells && cellClassName,
              column.cellClassName,
            )}
          >
            {column.cell(row)}
          </TableCell>,
        ),
      )}
    </TableRow>
  )
}

function DataTableGapRow({ columns, size, children }: { columns: number; size: number; children?: ReactNode }) {
  return (
    <tr aria-hidden="true" data-slot="data-table-gap" style={{ height: size }}>
      <td colSpan={columns} className="p-0">
        {children}
      </td>
    </tr>
  )
}

function DataTableEmptyRow({ columns, children }: { columns: number; children?: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columns} className="max-w-none">
        {children !== undefined && <Empty className="border-0">{children}</Empty>}
      </TableCell>
    </TableRow>
  )
}

function DataTableLoadingRows({ rows, columns }: { rows: number; columns: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={`loading-${row}`} data-slot="data-table-loading-row" className="hover:bg-transparent">
      {Array.from({ length: columns }, (_cell, column) => (
        <TableCell key={column}>
          <div className="flex h-lh items-center">
            <Skeleton className="h-4 w-full max-w-40" />
          </div>
        </TableCell>
      ))}
    </TableRow>
  ))
}

export { DataTableEmptyRow, DataTableGapRow, DataTableLoadingRows, DataTableRow }
export type { DataTableRowProps }
