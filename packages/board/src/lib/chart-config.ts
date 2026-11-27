import type { ComponentType, ReactNode } from "react"
import { isRecord } from "@/lib/narrow"

type ChartSeriesTheme = { light: string; dark: string }

type ChartSeriesConfig = {
  label?: ReactNode
  icon?: ComponentType<{ className?: string }>
} & ({ color?: string; theme?: never } | { color?: never; theme: ChartSeriesTheme })

type ChartConfig = Record<string, ChartSeriesConfig>

type ChartName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-label"?: string; "aria-labelledby": string }

type ChartFormat = Intl.NumberFormatOptions | ((value: number) => string)

interface ChartFormatOptions {
  locale?: string
  format?: ChartFormat
}

const seriesKeyPattern = /^[\w-]+$/
// Colors are written into a <style> element, so a value that could end the declaration or the element is dropped.
const unsafeColor = /[;{}<>\\]/

function chartColorDeclarations(config: ChartConfig, mode: keyof ChartSeriesTheme) {
  const declarations: string[] = []
  for (const [key, series] of Object.entries(config)) {
    const color = series.theme?.[mode] ?? series.color
    if (!color || !seriesKeyPattern.test(key) || unsafeColor.test(color)) continue
    declarations.push(`--color-${key}: ${color};`)
  }
  return declarations
}

function chartStyleSheet(config: ChartConfig, chartId: string) {
  const scope = `[data-chart="${chartId.replaceAll(/[^\w-]/g, "")}"]`
  const light = chartColorDeclarations(config, "light")
  const dark = chartColorDeclarations(config, "dark")
  const rules = []
  if (light.length > 0) rules.push(`${scope} { ${light.join(" ")} }`)
  if (dark.join() !== light.join() && dark.length > 0) rules.push(`.dark ${scope}, ${scope}.dark { ${dark.join(" ")} }`)
  return rules.join("\n")
}

function formatChartValue(value: unknown, { locale, format }: ChartFormatOptions = {}) {
  if (typeof value !== "number") return value == null ? "" : String(value)
  if (typeof format === "function") return format(value)
  return new Intl.NumberFormat(locale, format).format(value)
}

type ChartPayloadItem = { dataKey?: unknown; name?: unknown; payload?: unknown }

// A pie's payload names its series in a data field (nameKey), so that field's value is the config key.
function resolveChartSeries(config: ChartConfig, item: ChartPayloadItem | undefined, key: string) {
  const own = item as Record<string, unknown> | undefined
  const payload = item?.payload
  const row = isRecord(payload) ? payload : undefined
  let configKey = key
  if (typeof own?.[key] === "string") configKey = own[key] as string
  else if (typeof row?.[key] === "string") configKey = row[key] as string
  return { key: configKey, series: config[configKey] ?? config[key] }
}

// A series filled with an SVG pattern reports url(#id), which a CSS background can't paint, so its swatch uses the series color.
function chartSwatchColor(config: ChartConfig, key: string, color: string | undefined) {
  if (color && !color.startsWith("url(")) return color
  const series = config[key]
  return series?.color || series?.theme ? `var(--color-${key})` : color
}

export { chartStyleSheet, chartSwatchColor, formatChartValue, resolveChartSeries }
export type { ChartConfig, ChartFormat, ChartFormatOptions, ChartName, ChartSeriesConfig, ChartSeriesTheme }
