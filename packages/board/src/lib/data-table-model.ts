type SortDirection = "ascending" | "descending"
type SortValue = string | number | bigint | boolean | Date | null | undefined

interface DataTableSort {
  columnId: string
  direction: SortDirection
}

interface DataTablePage<Row> {
  rows: Row[]
  page: number
  pageCount: number
  total: number
}

type SelectionState = "none" | "some" | "all"

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

function isMissing(value: SortValue): value is null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))
}

function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === "string" && typeof b === "string") return collator.compare(a, b)
  const left = a instanceof Date ? a.getTime() : a
  const right = b instanceof Date ? b.getTime() : b
  if (left === right) return 0
  return lessThan(left, right) ? -1 : 1
}

// Workaround: `<` on mixed values compares them as numbers, which TypeScript only allows on numbers, bigints or two strings.
function lessThan(left: Exclude<SortValue, Date>, right: Exclude<SortValue, Date>) {
  if (typeof left === "bigint" && typeof right === "bigint") return left < right
  if (typeof left === "string" && typeof right === "string") return left < right
  return Number(left) < Number(right)
}

function sortRows<Row>(
  rows: readonly Row[],
  sort: DataTableSort | null | undefined,
  sortValue: ((row: Row) => SortValue) | undefined,
): Row[] {
  if (!sort || !sortValue) return [...rows]
  const sign = sort.direction === "ascending" ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .toSorted((a, b) => {
      const missingA = isMissing(a.value)
      const missingB = isMissing(b.value)
      if (missingA || missingB) return missingA === missingB ? a.index - b.index : missingA ? 1 : -1
      return sign * compareSortValues(a.value, b.value) || a.index - b.index
    })
    .map((entry) => entry.row)
}

function nextSort(current: DataTableSort | null | undefined, columnId: string): DataTableSort {
  if (current?.columnId === columnId && current.direction === "ascending") return { columnId, direction: "descending" }
  return { columnId, direction: "ascending" }
}

function pageCountOf(total: number, pageSize: number | undefined): number {
  if (!pageSize || pageSize <= 0 || !Number.isFinite(pageSize)) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.trunc(page)), pageCount)
}

function paginate<Row>(rows: readonly Row[], page: number, pageSize: number | undefined): DataTablePage<Row> {
  const total = rows.length
  const pageCount = pageCountOf(total, pageSize)
  const current = clampPage(page, pageCount)
  if (pageCount === 1) return { rows: [...rows], page: current, pageCount, total }
  const size = pageSize ?? total
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pageCount, total }
}

function selectionState(ids: readonly string[], selected: ReadonlySet<string>): SelectionState {
  if (ids.length === 0) return "none"
  const count = ids.reduce((sum, id) => sum + (selected.has(id) ? 1 : 0), 0)
  if (count === 0) return "none"
  return count === ids.length ? "all" : "some"
}

function toggleIds(selected: readonly string[], ids: readonly string[], checked: boolean): string[] {
  const next = new Set(selected)
  for (const id of ids) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return [...next]
}

export { clampPage, compareSortValues, nextSort, pageCountOf, paginate, selectionState, sortRows, toggleIds }
export type { DataTablePage, DataTableSort, SelectionState, SortDirection, SortValue }
