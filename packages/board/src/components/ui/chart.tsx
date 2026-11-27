"use client"

import { useId, type ComponentProps, type ReactNode } from "react"
import { Legend, ResponsiveContainer, Tooltip } from "recharts"

import {
  chartStyleSheet,
  type ChartConfig,
  type ChartName,
  type ChartFormat,
  type ChartSeriesConfig,
} from "@/lib/chart-config"
import { cn } from "@/lib/utils"
import { ChartContext, useChart } from "@/components/ui/chart-context"
import { ChartTooltipContent, type ChartTooltipContentProps } from "@/components/ui/chart-tooltip"
import { ChartLegendContent, type ChartLegendContentProps } from "@/components/ui/chart-legend"
import { ChartDataTable, type ChartDataTableProps } from "@/components/ui/chart-data-table"

// Recharts paints grid, axis and cursor with fixed hex colors; these map them to theme tokens.
// The focus ring stays on the keyboard-focusable surface the accessibility layer adds.
const rechartsClassName = [
  "[&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground",
  "[&_.recharts-polar-angle-axis-tick-value]:fill-muted-foreground [&_.recharts-polar-radius-axis-tick-value]:fill-muted-foreground",
  "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border",
  "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border",
  "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border",
  "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
  "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted",
  "[&_.recharts-radial-bar-background-sector]:fill-muted",
  "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
  "[&_.recharts-sector]:outline-hidden [&_.recharts-layer]:outline-hidden",
  "[&_.recharts-surface]:rounded-sm [&_.recharts-surface]:outline-hidden",
  "[&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-ring",
].join(" ")

type ChartContainerProps = Omit<ComponentProps<"figure">, "children" | "aria-label" | "aria-labelledby"> &
  ChartName & {
    config: ChartConfig
    children: ReactNode
    initialDimension?: { width: number; height: number }
  }

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const css = chartStyleSheet(config, id)
  return css ? <style data-slot="chart-style">{css}</style> : null
}

function ChartContainer({ id, config, className, children, initialDimension, ...props }: ChartContainerProps) {
  const generatedId = useId()
  const chartId = `chart-${(id ?? generatedId).replaceAll(/[^\w-]/g, "")}`
  return (
    <ChartContext value={{ config }}>
      <figure
        id={id}
        data-slot="chart"
        data-chart={chartId}
        className={cn("relative flex aspect-video w-full justify-center text-xs", rechartsClassName, className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <ResponsiveContainer initialDimension={initialDimension}>{children}</ResponsiveContainer>
      </figure>
    </ChartContext>
  )
}

const ChartTooltip = Tooltip
const ChartLegend = Legend

export { ChartContainer, ChartLegend, ChartStyle, ChartTooltip }
export { ChartTooltipContent }
export { ChartLegendContent }
export { ChartDataTable }
export { useChart }
export type { ChartContainerProps }
export type { ChartTooltipContentProps }
export type { ChartLegendContentProps }
export type { ChartDataTableProps }
export type { ChartConfig, ChartFormat, ChartSeriesConfig }
