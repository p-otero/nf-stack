"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { Children, isValidElement, type ReactNode } from "react"

import { useLocale } from "@/lib/locale"
import { formatQuantity, isQuantity, type FormatQuantityOptions, type Quantity } from "@/lib/quantity"
import { cn } from "@/lib/utils"
import { QuantityValue } from "@/components/ui/quantity-value"
import {
  StatDelta,
  statDeltaLabels,
  type StatDeltaDirection,
  type StatDeltaLabels,
  type StatDeltaProps,
} from "@/components/ui/stat-delta"

function part(slot: string, base: string) {
  return function StatPart({ className, render, ...props }: PartProps<"div">) {
    return renderElement("div", { "data-slot": slot, className: cn(base, className), ...props }, render)
  }
}

const Stat = part(
  "stat",
  "flex h-full flex-col gap-inline rounded-surface border bg-card/(--glass-opacity) p-inset-surface text-card-foreground backdrop-surface",
)
const StatLabel = part("stat-label", "text-sm text-muted-foreground")
const StatHint = part("stat-hint", "text-xs text-muted-foreground")

type StatValueProps = PartProps<"div"> & FormatQuantityOptions & { value?: number | Quantity }

function StatValue({ value, format, locale, labels, className, render, children, ...props }: StatValueProps) {
  const options = { format, locale: useLocale(locale), labels }
  const numeric = isQuantity(value) || typeof value === "number"
  let content = children
  if (isQuantity(value)) content = <QuantityValue value={value} {...options} />
  else if (typeof value === "number") content = formatQuantity({ value, quality: "measured" }, options).text
  return renderElement(
    "div",
    {
      "data-slot": "stat-value",
      "data-kind": numeric ? "number" : "text",
      title: !numeric && typeof children === "string" ? children : undefined,
      // Text such as "2 minutes ago" would wrap at display size, so it stays on one line, smaller.
      className: cn("tabular-nums", numeric ? "text-display-sm leading-none" : "truncate text-title", className),
      ...props,
      children: content,
    },
    render,
  )
}

type StatGroupProps = Omit<PartProps<"ul">, "children"> & { children?: ReactNode }

function StatGroup({ className, render, children, ...props }: StatGroupProps) {
  return renderElement(
    "ul",
    {
      "data-slot": "stat-group",
      // Preflight's list-style: none strips list semantics in Safari unless the role is explicit.
      role: "list",
      className: cn("flex flex-wrap gap-section", className),
      ...props,
      children: Children.map(children, (child) =>
        isValidElement(child) ? (
          <li data-slot="stat-group-item" className="min-w-40 flex-1">
            {child}
          </li>
        ) : (
          child
        ),
      ),
    },
    render,
  )
}

export { Stat, StatDelta, statDeltaLabels, StatGroup, StatHint, StatLabel, StatValue }
export type { StatDeltaDirection, StatDeltaLabels, StatDeltaProps, StatGroupProps, StatValueProps }
