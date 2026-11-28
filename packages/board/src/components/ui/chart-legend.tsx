"use client"

import type { LegendPayload } from "recharts"

import { chartSwatchColor, resolveChartSeries } from "@/lib/chart-config"
import { cn, cssVars } from "@/lib/utils"
import { useChart } from "@/components/ui/chart-context"

type ChartLegendContentProps = {
  className?: string
  payload?: readonly LegendPayload[]
  verticalAlign?: "top" | "middle" | "bottom"
  nameKey?: string
  hideIcon?: boolean
}

function ChartLegendContent({
  payload,
  verticalAlign = "bottom",
  nameKey,
  hideIcon = false,
  className,
}: ChartLegendContentProps) {
  const { config } = useChart()
  const items = (payload ?? []).filter((item) => item.type !== "none")
  if (items.length === 0) return null
  return (
    <ul
      data-slot="chart-legend"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-group gap-y-items text-xs",
        verticalAlign === "top" ? "pb-group" : "pt-group",
        className,
      )}
    >
      {items.map((item) => {
        const key = nameKey ?? String(item.dataKey ?? item.value ?? "value")
        const { key: seriesKey, series } = resolveChartSeries(config, item, key)
        const Icon = series?.icon
        return (
          <li key={seriesKey} data-slot="chart-legend-item" className="flex items-center gap-inline">
            {Icon && !hideIcon ? <Icon className="size-3 text-muted-foreground" /> : null}
            {!Icon && !hideIcon ? (
              <span
                aria-hidden="true"
                data-slot="chart-legend-swatch"
                style={cssVars({ "--indicator-color": chartSwatchColor(config, seriesKey, item.color) })}
                className="size-2.5 shrink-0 rounded-xs bg-(--indicator-color)"
              />
            ) : null}
            <span>{series?.label ?? item.value}</span>
          </li>
        )
      })}
    </ul>
  )
}

export { ChartLegendContent }
export type { ChartLegendContentProps }
