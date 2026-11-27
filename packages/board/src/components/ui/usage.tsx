import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import type { UsageSummary } from "@/lib/agent-task-types"
import { formatQuantity, type Quantity, type QuantityLabels } from "@/lib/quantity"
import { cn } from "@/lib/utils"
import { QuantityValue } from "@/components/ui/quantity-value"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type UsageMetric = keyof UsageSummary
type UsageKind = "tokens" | "duration" | "cost"

const usageMetrics: UsageMetric[] = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "durationMs",
  "activeMs",
  "costUsd",
]

const metricKind: Record<UsageMetric, UsageKind> = {
  inputTokens: "tokens",
  outputTokens: "tokens",
  cacheReadTokens: "tokens",
  cacheWriteTokens: "tokens",
  reasoningTokens: "tokens",
  durationMs: "duration",
  activeMs: "duration",
  costUsd: "cost",
}

type UsageLabels = Record<UsageMetric, string> & {
  table: string
  metric: string
  value: string
  quantity: QuantityLabels
}

const usageLabels: UsageLabels = {
  table: "Usage",
  metric: "Metric",
  value: "Value",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cacheReadTokens: "Cache read",
  cacheWriteTokens: "Cache write",
  reasoningTokens: "Reasoning tokens",
  durationMs: "Duration",
  activeMs: "Active time",
  costUsd: "Cost",
  quantity: { measured: "measured", estimated: "estimated", derived: "derived", unknown: "unknown" },
}

const usageLabelsEs: UsageLabels = {
  table: "Consumo",
  metric: "Métrica",
  value: "Valor",
  inputTokens: "Tokens de entrada",
  outputTokens: "Tokens de salida",
  cacheReadTokens: "Lectura de caché",
  cacheWriteTokens: "Escritura de caché",
  reasoningTokens: "Tokens de razonamiento",
  durationMs: "Duración",
  activeMs: "Tiempo activo",
  costUsd: "Coste",
  quantity: { measured: "medido", estimated: "estimado", derived: "derivado", unknown: "desconocido" },
}

interface UsageFormatOptions {
  locale?: string
  formatCurrency?: (usd: number) => string
}

const UNKNOWN: Quantity = { value: null, quality: "unknown" }

function formatDuration(ms: number, locale?: string) {
  const [unit, size] = ms < 60_000 ? ["second", 1000] : ms < 3_600_000 ? ["minute", 60_000] : ["hour", 3_600_000]
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(ms / size)
}

function usageFormatter(kind: UsageKind, { locale, formatCurrency }: UsageFormatOptions) {
  if (kind === "cost")
    return formatCurrency ?? new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format
  if (kind === "duration") return (ms: number) => formatDuration(ms, locale)
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format
}

function exactFormatter(kind: UsageKind, locale?: string) {
  if (kind === "duration")
    return new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", unitDisplay: "long" }).format
  return kind === "tokens" ? new Intl.NumberFormat(locale).format : undefined
}

type UsageQuantityProps = Omit<PartProps<"span">, "children"> &
  UsageFormatOptions & { value?: Quantity; kind: UsageKind; labels?: Partial<QuantityLabels> }

// Compact text hides the exact count, so the title carries it next to the quality and source.
function UsageQuantity({ value = UNKNOWN, kind, locale, formatCurrency, labels, ...props }: UsageQuantityProps) {
  const exact = exactFormatter(kind, locale)
  const quality = formatQuantity(value, { locale, labels }).title
  const exactText = exact && value.value !== null && value.quality !== "unknown" ? exact(value.value) : undefined
  const title = [exactText, quality].filter(Boolean).join(" · ") || undefined
  return (
    <QuantityValue
      value={value}
      format={usageFormatter(kind, { locale, formatCurrency })}
      locale={locale}
      labels={labels}
      title={title}
      {...props}
    />
  )
}

type UsageStatProps = PartProps<"div"> &
  UsageFormatOptions & { label: string; value?: Quantity; kind?: UsageKind; labels?: Partial<QuantityLabels> }

function UsageStat({
  label,
  value,
  kind = "tokens",
  locale,
  formatCurrency,
  labels,
  className,
  render,
  ...props
}: UsageStatProps) {
  return renderElement(
    "div",
    {
      "data-slot": "usage-stat",
      className: cn("flex min-w-0 flex-col gap-inline", className),
      ...props,
      children: (
        <>
          <span className="truncate text-xs text-muted-foreground">{label}</span>
          <UsageQuantity
            value={value}
            kind={kind}
            locale={locale}
            formatCurrency={formatCurrency}
            labels={labels}
            className="text-sm font-medium"
          />
        </>
      ),
    },
    render,
  )
}

interface UsageColumn {
  id: string
  label: string
  usage?: UsageSummary
}

type UsageTableProps = Omit<PartProps<"table">, "children"> &
  UsageFormatOptions & {
    /** One summary, shown as a single value column. */
    usage?: UsageSummary
    /** Several summaries side by side, such as one per attempt; wins over `usage`. */
    columns?: readonly UsageColumn[]
    labels?: Partial<UsageLabels>
  }

function UsageTable({ usage, columns, labels, locale, formatCurrency, className, ...props }: UsageTableProps) {
  const text = { ...usageLabels, ...labels }
  const shown = columns ?? [{ id: "value", label: text.value, usage }]
  return (
    <Table aria-label={text.table} className={cn("text-xs", className)} {...props}>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{text.metric}</TableHead>
          {shown.map((column) => (
            <TableHead key={column.id} scope="col" className="text-end">
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {usageMetrics.map((metric) => (
          <TableRow key={metric} data-metric={metric}>
            <TableHead scope="row" className="h-auto py-inset-item font-normal">
              {text[metric]}
            </TableHead>
            {shown.map((column) => (
              <TableCell key={column.id} className="text-end">
                <UsageQuantity
                  value={column.usage?.[metric]}
                  kind={metricKind[metric]}
                  locale={locale}
                  formatCurrency={formatCurrency}
                  labels={text.quantity}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export { UsageQuantity, UsageStat, UsageTable, usageFormatter, usageLabels, usageLabelsEs, usageMetrics }
export type { UsageColumn, UsageKind, UsageLabels, UsageMetric, UsageQuantityProps, UsageStatProps, UsageTableProps }
