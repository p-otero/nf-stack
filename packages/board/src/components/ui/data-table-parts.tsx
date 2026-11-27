"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import type { ReactNode } from "react"
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox, CheckboxIndicator, type CheckedState } from "@/components/ui/checkbox"
import type {
  DataTableController,
  DataTablePageChangeReason,
  DataTableSelectionChangeReason,
  DataTableSortChangeReason,
} from "@/components/ui/data-table-primitive"
import { Pagination } from "@/components/ui/pagination"
import { TableHead } from "@/components/ui/table"
import type { DataTableSort, SortDirection, SortValue } from "@/lib/data-table-model"
import { cn } from "@/lib/utils"
import type { Virtualize } from "@/components/ui/virtual-rows"

type DataTableAlign = "start" | "center" | "end"

type DataTableColumn<Row> = {
  id: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  sortValue?: (row: Row) => SortValue
  /** The field a server sorts by, in `manual` mode: the column sorts without a `sortValue`. */
  sortField?: string
  align?: DataTableAlign
  /** Wraps the column's cells onto more lines; by default they stay on one line, cut with an ellipsis and a tooltip. */
  wrap?: boolean
  /** Classes for every body cell of the column, such as a width. */
  cellClassName?: string
  /** Classes for the column's header cell. */
  headerClassName?: string
}

type DataTableLabels = {
  sortBy: (header: string) => string
  selectAll: string
  selectRow: (rowLabel: string) => string
  previousPage: string
  nextPage: string
  pageStatus: (page: number, pageCount: number) => string
  /** A secondary sort's place, read after the sort button's name: "sorted second". */
  sortRank: (rank: number) => string
}

const ordinals = ["first", "second", "third", "fourth", "fifth"]

const dataTableLabels: DataTableLabels = {
  sortBy: (header) => `Sort by ${header}`,
  selectAll: "Select all rows on this page",
  selectRow: (rowLabel) => `Select ${rowLabel}`,
  previousPage: "Previous page",
  nextPage: "Next page",
  pageStatus: (page, pageCount) => `Page ${page} of ${pageCount}`,
  sortRank: (rank) => `sorted ${ordinals[rank - 1] ?? `${String(rank)}th`}`,
}

type DataTablePageOptions = { reason?: DataTablePageChangeReason; event?: Event }

type DataTablePaginationProps = {
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPageChange: (page: number, options?: DataTablePageOptions) => void
}

function SortIcon({ direction }: { direction?: SortDirection }) {
  if (direction === "ascending") return <ChevronUpIcon />
  if (direction === "descending") return <ChevronDownIcon />
  return <ChevronsUpDownIcon />
}

/** A sort after the first: its header shows the direction and its place; only the first sets `aria-sort`. */
type DataTableSecondarySort = { direction: SortDirection; rank: number }

function DataTableHeaderCell<Row>({
  column,
  sort,
  sortable,
  secondary,
  labels,
  onSort,
}: {
  column: DataTableColumn<Row>
  sort: DataTableSort | null
  sortable: boolean
  secondary?: DataTableSecondarySort
  labels: Pick<DataTableLabels, "sortBy" | "sortRank">
  onSort: (event: MouseEvent) => void
}) {
  const primary = sort?.columnId === column.id ? sort.direction : undefined
  const header = typeof column.header === "string" ? column.header : column.id
  // oxlint-disable-next-line shadcn/require-static-classes -- the column's own classes, passed through like className
  const headerClassName = cn("data-[align=center]:text-center data-[align=end]:text-end", column.headerClassName)
  const name = secondary ? `${labels.sortBy(header)}, ${labels.sortRank(secondary.rank)}` : labels.sortBy(header)
  return (
    <TableHead
      scope="col"
      aria-sort={sortable ? (primary ?? "none") : undefined}
      data-align={column.align}
      className={headerClassName}
    >
      {sortable ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={name}
          render={(part) => <button {...part} data-slot="data-table-sort" />}
          data-align={column.align}
          className="-mx-(--item-padding-x) gap-inline px-(--item-padding-x) text-foreground data-[align=end]:flex-row-reverse [&_svg]:size-3.5"
          onClick={(event) => onSort(event.nativeEvent)}
        >
          {column.header}
          <SortIcon direction={primary ?? secondary?.direction} />
          {secondary && (
            <span aria-hidden="true" className="text-caption text-muted-foreground tabular-nums">
              {secondary.rank}
            </span>
          )}
        </Button>
      ) : (
        column.header
      )}
    </TableHead>
  )
}

function DataTableCheckbox({
  label,
  checked,
  disabled,
  onChange,
  tabIndex,
}: {
  label: string
  checked: CheckedState
  disabled?: boolean
  onChange: (checked: boolean, event?: Event) => void
  /** -1 inside a cell that holds the tab stop itself. */
  tabIndex?: number
}) {
  return (
    <Checkbox
      // The part writes its own tabindex over a prop's; the rendered element's wins.
      render={tabIndex === undefined ? undefined : (part) => <button {...part} tabIndex={tabIndex} />}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next, details) => onChange(next === true, details.event)}
    >
      <CheckboxIndicator />
    </Checkbox>
  )
}

function DataTablePagination({
  page,
  pageCount,
  onPageChange,
  labels,
}: DataTablePaginationProps & { labels: Pick<DataTableLabels, "previousPage" | "nextPage" | "pageStatus"> }) {
  return (
    <div data-slot="data-table-pagination" className="flex flex-wrap items-center justify-end gap-items">
      <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {labels.pageStatus(page, pageCount)}
      </span>
      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={(next, details) => onPageChange(next, { reason: details.reason, event: details.event })}
        labels={{ previous: labels.previousPage, next: labels.nextPage }}
        className="w-auto"
      />
    </div>
  )
}

export { DataTableCheckbox, DataTableHeaderCell, dataTableLabels, DataTablePagination }
type DataTableProps<Row> = {
  label: string
  rows: readonly Row[]
  columns: readonly DataTableColumn<Row>[]
  getRowId: (row: Row) => string
  getRowLabel?: (row: Row) => string
  sort?: DataTableSort | null
  defaultSort?: DataTableSort | null
  onSortChange?: (sort: DataTableSort | null, details: ChangeDetails<DataTableSortChangeReason>) => void
  selectable?: boolean
  selection?: readonly string[]
  defaultSelection?: readonly string[]
  onSelectionChange?: (selection: string[], details: ChangeDetails<DataTableSelectionChangeReason>) => void
  pageSize?: number
  /**
   * The server sorts and pages: `rows` is the current page as given, sort and page changes are only reported, and
   * `pageCount` (or `total` with `pageSize`) sets the pages. Columns sort by `sortField`.
   */
  manual?: boolean
  /** Every row on the server, in `manual` mode. */
  total?: number
  /** The number of pages in `manual` mode; wins over `total`. */
  pageCount?: number
  /** The sorts after `sort`, in `manual` mode: each header shows its place. */
  secondarySorts?: readonly DataTableSort[]
  /** The rows are being refreshed: `aria-busy` on the table while the current rows stay. */
  busy?: boolean
  page?: number
  defaultPage?: number
  onPageChange?: (page: number, details: ChangeDetails<DataTablePageChangeReason>) => void
  renderPagination?: (props: DataTablePaginationProps) => ReactNode
  loading?: boolean
  loadingRows?: number
  empty?: ReactNode
  labels?: Partial<DataTableLabels>
  controller?: DataTableController
  /** Enter on a focused row, or on a cell with `navigation="cells"`. */
  onRowOpen?: (row: Row) => void
  /**
   * What the keys move between. `"rows"` (default): rows are one tab stop, the arrows or j/k move, Home/End and the
   * page keys jump. `"cells"`: the cells are, as in a spreadsheet; ←/→ move along a row, ↑/↓ keep the column,
   * Home/End reach a row's ends and Ctrl/⌘ with them the table's corners, Space selects the row.
   */
  navigation?: "rows" | "cells"
  /** `"auto"` (default) renders only the rows in view past 200 rows. Bound the table's height to scroll inside it. */
  virtualize?: Virtualize
  /** A row's estimated height in px before it is measured. */
  estimateSize?: number
  className?: string
  tableClassName?: string
}

export type {
  DataTableSecondarySort,
  DataTableAlign,
  DataTableColumn,
  DataTableLabels,
  DataTablePageOptions,
  DataTablePaginationProps,
  DataTableProps,
}
