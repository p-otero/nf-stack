"use client"

import { createParts } from "@ui-sdk/react/primitive"
import { useCallback, useMemo, useState } from "react"

import {
  DataTableCheckbox,
  DataTableHeaderCell,
  dataTableLabels,
  DataTablePagination,
  type DataTableColumn,
  type DataTableLabels,
  type DataTablePageOptions,
  type DataTablePaginationProps,
  type DataTableProps,
} from "@/components/ui/data-table-parts"
import { createDataTableController, dataTable } from "@/components/ui/data-table-primitive"
import { DataTableEmptyRow, DataTableGapRow, DataTableLoadingRows, DataTableRow } from "@/components/ui/data-table-row"
import { CellNavigationProvider, useCellNavigation } from "@/components/ui/cell-navigation"
import { RowNavigationProvider, useRowNavigation } from "@/components/ui/row-navigation"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  clampPage,
  pageCountOf,
  paginate,
  selectionState,
  sortRows,
  type DataTableSort,
  type SortDirection,
  type SortValue,
} from "@/lib/data-table-model"
import { cn } from "@/lib/utils"
import { useVirtualRows } from "@/components/ui/virtual-rows"

const { Root: DataTableRoot } = createParts(dataTable, { root: "div" })

function useMirror<Value>(controlled: Value | undefined, initial: Value) {
  const [own, setOwn] = useState(initial)
  return [controlled === undefined ? own : controlled, setOwn] as const
}

// Stable between renders, so a virtualized table's find-in-page stubs re-render only when the rows change.
function useVisibleRows<Row>(
  rows: readonly Row[],
  columns: DataTableProps<Row>["columns"],
  sort: DataTableSort | null,
  page: number,
  pageSize: number | undefined,
  manual: boolean,
) {
  return useMemo(() => {
    if (manual) return rows
    const sortValue = columns.find((column) => column.id === sort?.columnId)?.sortValue
    return paginate(sortRows(rows, sort, sortValue), page, pageSize).rows
  }, [rows, columns, sort, page, pageSize, manual])
}

function isSortable<Row>(column: DataTableColumn<Row>, manual: boolean) {
  return column.sortValue !== undefined || (manual && column.sortField !== undefined)
}

function manualPageCount(pageCount: number | undefined, total: number | undefined, pageSize: number | undefined) {
  if (pageCount !== undefined) return Math.max(1, Math.trunc(pageCount))
  return total === undefined ? 1 : pageCountOf(total, pageSize)
}

function DataTable<Row>({
  label,
  rows,
  columns,
  getRowId,
  getRowLabel = getRowId,
  selectable = false,
  pageSize,
  manual = false,
  total,
  pageCount: pageCountProp,
  secondarySorts,
  busy = false,
  renderPagination,
  loading = false,
  loadingRows = 5,
  empty,
  labels: labelOverrides,
  controller: controllerProp,
  onRowOpen,
  navigation: keys = "rows",
  virtualize = "auto",
  estimateSize = 41,
  className,
  tableClassName,
  ...state
}: DataTableProps<Row>) {
  const labels = { ...dataTableLabels, ...labelOverrides }
  const [ownController] = useState(createDataTableController)
  const controller = controllerProp ?? ownController
  const [sort, setSort] = useMirror(state.sort, state.defaultSort ?? null)
  const [selection, setSelection] = useMirror(state.selection, state.defaultSelection ?? [])
  const [requestedPage, setPage] = useMirror(state.page, state.defaultPage ?? 1)

  const pageCount = manual ? manualPageCount(pageCountProp, total, pageSize) : pageCountOf(rows.length, pageSize)
  const page = clampPage(requestedPage, pageCount)
  const visible = useVisibleRows(rows, columns, sort, page, pageSize, manual)
  const visibleIds = useMemo(() => visible.map(getRowId), [visible, getRowId])
  const selected = new Set(selection)
  const pageSelection = selectionState(visibleIds, selected)
  const rowItems = rows.map((row) => ({
    value: getRowId(row),
    label: getRowLabel(row),
  }))
  const columnCount = columns.length + (selectable ? 1 : 0)
  const indexOf = new Map(visibleIds.map((id, index) => [id, index]))

  const keyAt = useCallback((index: number) => visibleIds[index] ?? String(index), [visibleIds])
  const textAt = useCallback(
    (index: number) => (visible[index] === undefined ? "" : getRowLabel(visible[index])),
    [visible, getRowLabel],
  )
  const { anchor, ...virtual } = useVirtualRows({
    count: loading ? 0 : visible.length,
    findable: textAt,
    virtualize,
    estimateSize,
    getKey: keyAt,
  })

  // Stable, so a memoized row re-renders only when its own row, selection or position changes.
  const toggleRow = useCallback(
    (id: string, checked?: boolean, event?: Event) => controller.toggleRows([id], checked, { reason: "press", event }),
    [controller],
  )
  const navigation = useRowNavigation({
    ids: visibleIds,
    onOpen: onRowOpen
      ? (id) => {
          const index = indexOf.get(id)
          if (index !== undefined && visible[index] !== undefined) onRowOpen(visible[index])
        }
      : undefined,
    onToggle: selectable ? (id, event) => toggleRow(id, undefined, event) : undefined,
    reveal: (id) => {
      const index = indexOf.get(id)
      if (index !== undefined) virtual.scrollToIndex(index)
    },
  })

  const cells = useCellNavigation({
    rows: visible.length,
    cols: columnCount,
    reveal: (index) => virtual.scrollToIndex(index),
    onOpen: onRowOpen
      ? ({ row }) => {
          if (visible[row] !== undefined) onRowOpen(visible[row])
        }
      : undefined,
    onToggle: selectable
      ? ({ row }, event) => {
          const id = visibleIds[row]
          if (id !== undefined) toggleRow(id, undefined, event)
        }
      : undefined,
  })

  const pagination: DataTablePaginationProps = {
    page,
    pageCount,
    pageSize: pageSize ?? rows.length,
    total: manual ? (total ?? rows.length) : rows.length,
    onPageChange: (next: number, options?: DataTablePageOptions) =>
      controller.setPage(clampPage(next, pageCount), options),
  }

  return (
    <DataTableRoot
      aria-label={label}
      controller={controller}
      sortableColumns={columns.filter((column) => isSortable(column, manual)).map((column) => column.id)}
      rowItems={rowItems}
      pageCount={pageCount}
      sort={sort}
      onSortChange={(next, details) => {
        state.onSortChange?.(next, details)
        if (!details.canceled) setSort(next)
      }}
      selection={selection}
      onSelectionChange={(next, details) => {
        state.onSelectionChange?.(next, details)
        if (!details.canceled) setSelection(next)
      }}
      page={page}
      onPageChange={(next, details) => {
        state.onPageChange?.(next, details)
        if (!details.canceled) setPage(next)
      }}
      className={cn("flex w-full flex-col gap-items", className)}
    >
      <Table
        role={keys === "cells" ? "grid" : undefined}
        aria-label={label}
        aria-busy={loading || busy || undefined}
        aria-rowcount={virtual.enabled ? visible.length + 1 : undefined}
        containerClassName="min-h-0"
        className={tableClassName}
      >
        <TableHeader className={cn(virtual.enabled && "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background")}>
          <TableRow className="hover:bg-transparent">
            {selectable && (
              <TableHead scope="col" className="w-0">
                <DataTableCheckbox
                  label={labels.selectAll}
                  disabled={loading || visibleIds.length === 0}
                  checked={pageSelection === "some" ? "indeterminate" : pageSelection === "all"}
                  onChange={(checked, event) =>
                    controller.toggleRows(visibleIds, checked, {
                      reason: "select-all",
                      event,
                    })
                  }
                />
              </TableHead>
            )}
            {columns.map((column) => {
              const rank = secondarySorts?.findIndex((secondary) => secondary.columnId === column.id) ?? -1
              const secondary = rank === -1 ? undefined : secondarySorts?.[rank]
              return (
                <DataTableHeaderCell
                  key={column.id}
                  column={column}
                  sort={sort}
                  sortable={isSortable(column, manual)}
                  secondary={
                    secondary && {
                      direction: secondary.direction,
                      rank: rank + 2,
                    }
                  }
                  labels={labels}
                  onSort={(event) =>
                    controller.sortBy(column.id, undefined, {
                      reason: "item-press",
                      event,
                    })
                  }
                />
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody ref={anchor} className={cn(virtual.enabled && "relative")}>
          {loading ? (
            <DataTableLoadingRows rows={loadingRows} columns={columnCount} />
          ) : visible.length === 0 ? (
            <DataTableEmptyRow columns={columnCount}>{empty}</DataTableEmptyRow>
          ) : (
            <RowNavigationProvider handle={navigation}>
              <CellNavigationProvider handle={keys === "cells" ? cells : null}>
                {virtual.segments.map((segment) => {
                  if (segment.type === "gap") {
                    return <DataTableGapRow key={segment.key} columns={columnCount} size={segment.size} />
                  }
                  const row = visible[segment.index]
                  const id = visibleIds[segment.index]
                  if (row === undefined || id === undefined) return null
                  return (
                    <DataTableRow
                      key={id}
                      row={row}
                      id={id}
                      columns={columns}
                      index={virtual.enabled ? segment.index : undefined}
                      position={segment.index}
                      measure={virtual.measureElement}
                      selectLabel={selectable ? labels.selectRow(getRowLabel(row)) : undefined}
                      selected={selected.has(id)}
                      onToggle={selectable ? toggleRow : undefined}
                    />
                  )
                })}
              </CellNavigationProvider>
            </RowNavigationProvider>
          )}
        </TableBody>
      </Table>
      {pageSize !== undefined &&
        pageCount > 1 &&
        (renderPagination ? renderPagination(pagination) : <DataTablePagination {...pagination} labels={labels} />)}
    </DataTableRoot>
  )
}

export { createDataTableController, DataTable, dataTableLabels }
export type { DataTableColumn, DataTableLabels, DataTablePaginationProps, DataTableProps }
export type { DataTableSort, SortDirection, SortValue }
