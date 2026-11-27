"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useLocale } from "@/lib/locale"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

type StatDeltaDirection = "up" | "down" | "flat"

type StatDeltaLabels = Record<StatDeltaDirection, (formatted: string) => string>

/** What screen readers hear before the comparison; the arrow and the colour are hidden from them. */
const statDeltaLabels: StatDeltaLabels = {
  up: (formatted) => `up ${formatted}`,
  down: (formatted) => `down ${formatted}`,
  flat: () => "no change",
}

const chipVariants = cva(
  "inline-flex items-center gap-inline rounded-full border px-inset-chip py-inset-chip font-medium tabular-nums [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
        info: "border-info-border bg-info-soft text-info-soft-foreground",
        success: "border-success-border bg-success-soft text-success-soft-foreground",
        warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
        destructive: "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
        violet: "border-violet-border bg-violet-soft text-violet-soft-foreground",
      } satisfies Record<Tone, string>,
    },
  },
)

const icons = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: MinusIcon }

type StatDeltaProps = Omit<PartProps<"span">, "children"> & {
  /** The change, as a ratio by default: 0.12 reads "12%". Its sign gives the direction. */
  value: number
  /** Overrides the direction the sign gives, as for a value that rounds to zero. */
  direction?: StatDeltaDirection
  /** For a metric where down is good, like cost or errors: down reads success and up destructive. */
  invert?: boolean
  /** Overrides the tone the direction gives. */
  tone?: Tone
  /** What the change is measured against, like "vs. last week"; shown after the change, and read with it. */
  comparison?: ReactNode
  /** `Intl.NumberFormat` options for the change's size (a percent by default), or a function of it. */
  format?: Intl.NumberFormatOptions | ((value: number) => string)
  locale?: string
  labels?: Partial<StatDeltaLabels>
}

const percent: Intl.NumberFormatOptions = { style: "percent", maximumFractionDigits: 1 }

function directionOf(value: number): StatDeltaDirection {
  if (value > 0) return "up"
  if (value < 0) return "down"
  return "flat"
}

function toneOf(direction: StatDeltaDirection, invert: boolean): Tone {
  if (direction === "flat") return "neutral"
  return (direction === "up") !== invert ? "success" : "destructive"
}

/** A change beside a Stat's value: an arrow and the size of the change in a tone, then what it compares against. */
function StatDelta({
  value,
  direction: directionProp,
  invert = false,
  tone: toneProp,
  comparison,
  format = percent,
  locale: localeProp,
  labels: labelOverrides,
  className,
  render,
  ...props
}: StatDeltaProps) {
  const labels = { ...statDeltaLabels, ...labelOverrides }
  const locale = useLocale(localeProp)
  const direction = directionProp ?? directionOf(value)
  const tone = toneProp ?? toneOf(direction, invert)
  const size = Math.abs(value)
  const formatted = typeof format === "function" ? format(size) : new Intl.NumberFormat(locale, format).format(size)
  const Arrow = icons[direction]
  return renderElement(
    "span",
    {
      "data-slot": "stat-delta",
      "data-direction": direction,
      "data-tone": tone,
      className: cn("inline-flex flex-wrap items-center gap-x-inline gap-y-inline text-caption", className),
      ...props,
      children: (
        <>
          <span aria-hidden="true" className={chipVariants({ tone })}>
            <Arrow className="rtl:-scale-x-100" />
            {direction === "flat" ? null : formatted}
          </span>
          <span className="sr-only">{labels[direction](formatted)}</span>
          {comparison === undefined ? null : (
            <span data-slot="stat-delta-comparison" className="text-muted-foreground">
              {" "}
              {comparison}
            </span>
          )}
        </>
      ),
    },
    render,
  )
}

export { StatDelta, statDeltaLabels }
export type { StatDeltaDirection, StatDeltaLabels, StatDeltaProps }
