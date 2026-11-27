"use client"

import type { ReactNode } from "react"
import type { TooltipPayloadEntry } from "recharts"

import { useLocale } from "@/lib/locale"
import { chartSwatchColor, formatChartValue, resolveChartSeries, type ChartFormatOptions } from "@/lib/chart-config"
import { cn, cssVars } from "@/lib/utils"
import { useChart } from "@/components/ui/chart-context"
import { isRecord } from "@/lib/narrow"

type ChartIndicator = "dot" | "line" | "dashed"

// Recharts clones the content with every Tooltip prop, so only these are read and nothing is spread onto the DOM.
type ChartTooltipContentProps = ChartFormatOptions & {
  active?: boolean
  payload?: readonly TooltipPayloadEntry[]
  label?: string | number
  labelKey?: string
  nameKey?: string
  indicator?: ChartIndicator
  hideLabel?: boolean
  hideIndicator?: boolean
  color?: string
  labelFormatter?: (label: ReactNode, payload: readonly TooltipPayloadEntry[]) => ReactNode
  formatter?: (value: unknown, name: unknown, item: TooltipPayloadEntry, index: number) => ReactNode
  className?: string
  labelClassName?: string
}

const tooltipSurfaceClassName =
  "grid min-w-32 items-start gap-inline rounded-lg border border-floating-border bg-floating px-inset-item py-inset-item text-xs text-popover-foreground shadow-floating backdrop-floating"

const indicatorClassName =
  "shrink-0 rounded-xs border-(--indicator-color) bg-(--indicator-color) data-[indicator=dot]:size-2.5 data-[indicator=line]:w-1 data-[indicator=dashed]:w-0 data-[indicator=dashed]:border-2 data-[indicator=dashed]:border-dashed data-[indicator=dashed]:bg-transparent"

function ChartTooltipContent({
  active,
  payload,
  label,
  labelKey,
  nameKey,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  color,
  locale: localeProp,
  format,
  labelFormatter,
  formatter,
  className,
  labelClassName,
}: ChartTooltipContentProps) {
  const { config } = useChart()
  const locale = useLocale(localeProp)
  const items = (payload ?? []).filter((item) => item.type !== "none")
  if (!active || items.length === 0) return null

  const first = items[0]
  const firstKey = labelKey ?? String(first?.dataKey ?? first?.name ?? "value")
  const labelSeries = resolveChartSeries(config, first, firstKey).series
  const labelValue =
    !labelKey && (typeof label === "string" || typeof label === "number")
      ? (config[String(label)]?.label ?? label)
      : labelSeries?.label
  const labelContent = labelFormatter ? labelFormatter(labelValue, items) : labelValue
  const labelNode =
    hideLabel || labelContent == null || labelContent === "" ? null : (
      <div data-slot="chart-tooltip-label" className={cn("font-medium", labelClassName)}>
        {labelContent}
      </div>
    )
  const nested = items.length === 1 && indicator !== "dot"

  return (
    <div data-slot="chart-tooltip" className={cn(tooltipSurfaceClassName, className)}>
      {nested ? null : labelNode}
      <div className="grid gap-inline">
        {items.map((item, index) => {
          const key = nameKey ?? String(item.name ?? item.dataKey ?? "value")
          const { key: seriesKey, series } = resolveChartSeries(config, item, key)
          const fill = isRecord(item.payload) && typeof item.payload.fill === "string" ? item.payload.fill : undefined
          const indicatorColor = color ?? chartSwatchColor(config, seriesKey, fill ?? item.color)
          const Icon = series?.icon
          return (
            <div
              key={`${String(item.dataKey ?? item.name)}-${item.graphicalItemId}`}
              data-slot="chart-tooltip-item"
              className={cn("flex w-full flex-wrap items-stretch gap-inline", indicator === "dot" && "items-center")}
            >
              {formatter && item.value !== undefined ? (
                formatter(item.value, item.name, item, index)
              ) : (
                <>
                  {Icon ? <Icon className="size-3 text-muted-foreground" /> : null}
                  {!Icon && !hideIndicator ? (
                    <div
                      data-slot="chart-indicator"
                      data-indicator={indicator}
                      aria-hidden="true"
                      style={cssVars({ "--indicator-color": indicatorColor })}
                      // oxlint-disable-next-line p-otero/spacing-tokens -- centres the dashed bar on the label's line
                      className={cn(indicatorClassName, nested && indicator === "dashed" && "my-0.5")}
                    />
                  ) : null}
                  <div
                    className={cn(
                      "flex flex-1 justify-between gap-items leading-none",
                      nested ? "items-end" : "items-center",
                    )}
                  >
                    <div className="grid gap-inline">
                      {nested ? labelNode : null}
                      <span className="text-muted-foreground">{series?.label ?? item.name}</span>
                    </div>
                    {item.value == null ? null : (
                      <span className="font-mono font-medium text-popover-foreground tabular-nums">
                        {formatChartValue(item.value, { locale, format })}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ChartTooltipContent }
export type { ChartIndicator, ChartTooltipContentProps }
