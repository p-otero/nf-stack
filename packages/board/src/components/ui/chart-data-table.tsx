"use client"

import { use, type ReactNode } from "react"

import { useLocale } from "@/lib/locale"
import { formatChartValue, type ChartConfig, type ChartFormatOptions, type ChartName } from "@/lib/chart-config"
import { ChartContext } from "@/components/ui/chart-context"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** Any row object; an `interface` works too, since rows don't need an index signature. */
type ChartRow = object

// A row typed as an interface has no index signature, so its cells are read by name, as unknown values.
const cell = (row: ChartRow, key: string): unknown => Reflect.get(row, key)

type ChartDataTableProps<TRow extends ChartRow> = ChartName &
  ChartFormatOptions & {
    data: readonly TRow[]
    /** The field that names each row, like a month. */
    labelKey: keyof TRow & string
    /** The value columns, in order; by default the config's series that hold a number. */
    keys?: readonly (keyof TRow & string)[]
    config?: ChartConfig
    caption?: ReactNode
    visuallyHidden?: boolean
    className?: string
  }

function ChartDataTable<TRow extends ChartRow>({
  data,
  labelKey,
  keys,
  config: configProp,
  caption,
  visuallyHidden = true,
  locale: localeProp,
  format,
  className,
  ...name
}: ChartDataTableProps<TRow>) {
  const config = configProp ?? use(ChartContext)?.config ?? {}
  const locale = useLocale(localeProp)
  const columns: readonly string[] =
    keys ??
    Object.keys(config).filter((key) => key !== labelKey && data.some((row) => typeof cell(row, key) === "number"))
  const headerFor = (key: string) => config[key]?.label ?? key

  const table = (
    <Table {...name} className={className}>
      {caption ? <TableCaption>{caption}</TableCaption> : null}
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{headerFor(labelKey)}</TableHead>
          {columns.map((key) => (
            <TableHead key={key} scope="col" className="text-end">
              {headerFor(key)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const category = String(cell(row, labelKey) ?? "")
          return (
            <TableRow key={category}>
              <TableHead scope="row">{config[category]?.label ?? category}</TableHead>
              {columns.map((key) => (
                <TableCell key={key} className="text-end tabular-nums">
                  {formatChartValue(cell(row, key), { locale, format })}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  if (!visuallyHidden) return <div data-slot="chart-data-table">{table}</div>
  // The inner box sizes to the table, so the scroll area never overflows and never adds a tab stop nobody can see.
  return (
    <div data-slot="chart-data-table" data-visually-hidden="" className="sr-only">
      <div className="w-max">{table}</div>
    </div>
  )
}

export { ChartDataTable }
export type { ChartDataTableProps, ChartRow }
