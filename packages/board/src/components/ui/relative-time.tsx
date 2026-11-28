"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import { useNow, type UseNowOptions } from "@/components/ui/use-now"
import { useLocale } from "@/lib/locale"
import { formatInstant, formatRelative, toISO, type Instant } from "@/lib/time"
import { cn } from "@/lib/utils"

type RelativeTimeProps = Omit<PartProps<"time">, "children" | "dateTime"> & {
  value: Instant
  now?: Instant
  locale?: string
  timeZone?: string
  intervalMs?: number
  /** "short" ("2 min. ago") or "narrow" where space is tight; "long" by default. */
  formatStyle?: Intl.RelativeTimeFormatStyle
}

function RelativeTime({
  value,
  now,
  locale: localeProp,
  timeZone,
  intervalMs,
  formatStyle,
  className,
  render,
  ...props
}: RelativeTimeProps) {
  const current = useNow({ now, intervalMs })
  const locale = useLocale(localeProp)
  return renderElement(
    "time",
    {
      "data-slot": "relative-time",
      dateTime: toISO(value),
      title: formatInstant(value, { locale, timeZone }),
      className: cn("tabular-nums", className),
      // Spec: server and browser differ in clock and time zone; the effect in useNow resyncs the text.
      suppressHydrationWarning: true,
      ...props,
      children: formatRelative(value, { now: current, locale, style: formatStyle }),
    },
    render,
  )
}

export { RelativeTime, useNow }
export type { RelativeTimeProps, UseNowOptions }
