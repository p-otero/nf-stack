import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import type { UsageSummary } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { UsageQuantity, usageLabels, type UsageKind, type UsageLabels, type UsageMetric } from "@/components/ui/usage"

/** Key figures first, so the first row answers "how much and how long" at any width. */
const usageGridMetrics: [UsageMetric, UsageKind][] = [
  ["inputTokens", "tokens"],
  ["outputTokens", "tokens"],
  ["cacheReadTokens", "tokens"],
  ["reasoningTokens", "tokens"],
  ["costUsd", "cost"],
  ["durationMs", "duration"],
  ["cacheWriteTokens", "tokens"],
  ["activeMs", "duration"],
]

type UsageGridProps = Omit<PartProps<"div">, "children"> & {
  usage?: UsageSummary
  labels?: Partial<UsageLabels>
  locale?: string
  formatCurrency?: (usd: number) => string
  /** `"compact"` lists the figures as term and value rows, for a narrow side column. */
  variant?: "tiles" | "compact"
}

function UsageGrid({
  usage,
  labels,
  locale,
  formatCurrency,
  variant = "tiles",
  className,
  render,
  "aria-label": ariaLabel,
  ...props
}: UsageGridProps) {
  const text = { ...usageLabels, ...labels }
  const compact = variant === "compact"
  return renderElement(
    "div",
    {
      "data-slot": "usage-grid",
      role: "group",
      "aria-label": ariaLabel ?? text.table,
      "data-variant": variant,
      className: cn("@container/usage-grid", className),
      ...props,
      children: (
        <dl
          className={
            compact
              ? "grid grid-cols-(--detail-value-columns) gap-x-group gap-y-inline"
              : "grid grid-cols-2 gap-items @sm/usage-grid:grid-cols-3 @xl/usage-grid:grid-cols-4"
          }
        >
          {usageGridMetrics.map(([metric, kind]) => (
            <div
              key={metric}
              data-slot="usage-grid-item"
              data-metric={metric}
              className={
                compact
                  ? "flex min-w-0 items-baseline justify-between gap-inline border-b border-border/60 py-inline"
                  : "flex min-w-0 flex-col gap-inline rounded-control border bg-card/(--glass-opacity) px-inset-item py-inset-item"
              }
            >
              <dt className="truncate text-xs text-muted-foreground">{text[metric]}</dt>
              <dd className={cn("text-sm tabular-nums", compact ? "font-medium" : "font-semibold")}>
                <UsageQuantity
                  value={usage?.[metric]}
                  kind={kind}
                  locale={locale}
                  formatCurrency={formatCurrency}
                  labels={text.quantity}
                />
              </dd>
            </div>
          ))}
        </dl>
      ),
    },
    render,
  )
}

export { UsageGrid, usageGridMetrics }
export type { UsageGridProps }
