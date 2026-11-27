"use client"

import type { ReactNode } from "react"

import { formatQuantity, type Quantity, type QuantityLabels } from "@/lib/quantity"
import { cn } from "@/lib/utils"
import { QuantityValue } from "@/components/ui/quantity-value"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usageFormatter } from "@/components/ui/usage"

type DetailValueProps = {
  term: string
  children?: ReactNode
  /** Shown instead of `children`; an estimate or a sourced value gets a tooltip saying so. */
  quantity?: Quantity
  locale?: string
  formatCurrency?: (usd: number) => string
  quantityLabels?: Partial<QuantityLabels>
  /** Term and value on one row. */
  inline?: boolean
  /** Lets the value wrap instead of truncating. */
  wrap?: boolean
}

function DetailValue({
  term,
  children,
  quantity,
  locale,
  formatCurrency,
  quantityLabels,
  inline = false,
  wrap = false,
}: DetailValueProps) {
  let value = children
  if (quantity) {
    const format = usageFormatter("cost", { locale, formatCurrency })
    const hint = formatQuantity(quantity, {
      format,
      locale,
      labels: quantityLabels,
    }).title
    const shown = (
      <QuantityValue value={quantity} format={format} locale={locale} labels={quantityLabels} title={undefined} />
    )
    value = hint ? (
      <Tooltip>
        <TooltipTrigger
          aria-label={`${term}: ${formatQuantity(quantity, { format, locale, labels: quantityLabels }).srText}`}
          className="cursor-help rounded-control underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shown}
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    ) : (
      shown
    )
  }
  return (
    <div
      data-slot="task-detail-value"
      className={cn("flex min-w-0 gap-inline", inline ? "items-baseline justify-between" : "flex-col")}
    >
      <dt className="min-w-0 truncate text-xs text-muted-foreground">{term}</dt>
      <dd className={cn("min-w-0", wrap ? "wrap-anywhere" : "truncate", inline && "shrink-0 tabular-nums")}>{value}</dd>
    </div>
  )
}

// Escape inside a popup the panel holds (a reject confirmation, a tooltip) belongs to that popup.
const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const

function insidePopup(target: EventTarget, panel: Element) {
  const popup = target instanceof Element ? target.closest('[role="dialog"],[role="alertdialog"],[popover]') : null
  return popup !== null && popup !== panel && panel.contains(popup)
}

function Block({
  title,
  level,
  className,
  children,
}: {
  title: string
  level: number
  className?: string
  children: ReactNode
}) {
  const Heading = headingTags[Math.min(level, 6) - 1] ?? "h6"
  return (
    <section className={cn("flex flex-col gap-inline", className)}>
      <Heading className="text-meta tracking-meta text-muted-foreground uppercase">{title}</Heading>
      {children}
    </section>
  )
}

export { Block, DetailValue, insidePopup }
export type { DetailValueProps }
