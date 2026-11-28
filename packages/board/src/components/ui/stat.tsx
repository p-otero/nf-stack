"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { Children, isValidElement, type ReactNode } from "react"

import { useLocale } from "@/lib/locale"
import type { Tone } from "@/lib/tone"
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

const besideMedia = [
  "has-[>[data-slot=stat-media]]:grid has-[>[data-slot=stat-media]]:grid-cols-[minmax(0,1fr)_auto] has-[>[data-slot=stat-media]]:content-start has-[>[data-slot=stat-media]]:gap-x-group",
  "*:col-start-1 [&>[data-slot=stat-media]]:col-start-2 [&>[data-slot=stat-media]]:row-span-2 [&>[data-slot=stat-media]]:row-start-1",
].join(" ")

const Stat = part(
  "stat",
  cn(
    "flex h-full flex-col gap-inline rounded-surface border bg-card/(--glass-opacity) p-inset-surface text-card-foreground backdrop-surface",
    besideMedia,
  ),
)
const StatLabel = part("stat-label", "text-sm text-muted-foreground")
const StatHint = part("stat-hint", "text-xs text-muted-foreground")

const mediaToneClassNames = {
  neutral: "bg-neutral-soft text-neutral-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  violet: "bg-violet-soft text-violet-soft-foreground",
} satisfies Record<Tone, string>

type StatMediaProps = PartProps<"div"> & {
  /** The chip's soft fill and the colour of the icon on it. Default `neutral`. */
  tone?: Tone
  /** Names what the media shows (`role="img"`); without it the chip is decorative and hidden from assistive technology. */
  label?: string
}

/** An icon or a small chart at the end of a `Stat`, top-aligned beside its label, value and hint. */
function StatMedia({ tone = "neutral", label, className, render, ...props }: StatMediaProps) {
  const named = label !== undefined && label !== ""
  return renderElement(
    "div",
    {
      "data-slot": "stat-media",
      "data-tone": tone,
      ...(named ? { role: "img", "aria-label": label } : { "aria-hidden": true }),
      className: cn(
        "flex h-control min-w-control shrink-0 items-center justify-center self-start rounded-choice [&_svg]:size-5",
        mediaToneClassNames[tone],
        className,
      ),
      ...props,
    },
    render,
  )
}

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
      // Workaround: Safari drops list semantics under Preflight's `list-style: none` unless the role is explicit.
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

export { Stat, StatDelta, statDeltaLabels, StatGroup, StatHint, StatLabel, StatMedia, StatValue }
export type { StatDeltaDirection, StatDeltaLabels, StatDeltaProps, StatGroupProps, StatMediaProps, StatValueProps }
