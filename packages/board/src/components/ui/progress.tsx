"use client"

import {
  Progress as ProgressPrimitive,
  ProgressIndicator as ProgressIndicatorPrimitive,
  ProgressLabel as ProgressLabelPrimitive,
  ProgressTrack as ProgressTrackPrimitive,
  ProgressValue as ProgressValuePrimitive,
} from "@ui-sdk/react/progress"
import { createContext, use, useMemo, type ComponentProps, type ReactNode } from "react"

import type { Tone } from "@/lib/tone"
import { cnState } from "@/lib/utils"

const gaugeClassNames = {
  root: "group/gauge flex w-full flex-wrap items-baseline justify-between gap-inline",
  label: "text-sm font-medium",
  value: "text-sm text-muted-foreground tabular-nums",
  track: "relative h-2 w-full basis-full overflow-hidden rounded-full bg-input/40",
  indicator:
    // oxlint-disable-next-line shadcn/no-arbitrary-values -- transitions only the properties that move; transition-all also eased every colour and shadow change
    "absolute inset-y-0 rounded-full bg-primary transition-[width,background-color] motion-reduce:transition-none group-data-[tone=neutral]/gauge:bg-muted-foreground group-data-[tone=info]/gauge:bg-info group-data-[tone=success]/gauge:bg-success group-data-[tone=warning]/gauge:bg-warning group-data-[tone=destructive]/gauge:bg-destructive group-data-[tone=violet]/gauge:bg-violet",
}

/** Colours the indicator by what the value means; without it the indicator takes the primary colour. */
type GaugeToneProps = { tone?: Tone }

type GaugeRange = { min: number; max: number }

/** The root's range, for a Value part's `formatValue`, which UI SDK's state doesn't carry. */
const GaugeRangeContext = createContext<GaugeRange>({ min: 0, max: 100 })

type GaugeValueDetails<Value> = GaugeRange & {
  /** Where the value sits between `min` and `max`, from 0 to 100. */
  percent: Value
  /** The text the root's `format` and `locale` make, which screen readers also hear. */
  text: string
}

/**
 * Replaces the visible value only; screen readers keep the root's `format` (or `getValueLabel`). To change both, pass
 * `format` to the root: `Intl.NumberFormat` options, or a function of the value.
 */
type GaugeValueFormatProps<Value> = { formatValue?: (value: Value, details: GaugeValueDetails<Value>) => ReactNode }

function Progress({ className, tone, ...props }: ComponentProps<typeof ProgressPrimitive> & GaugeToneProps) {
  const { min = 0, max = 100 } = props
  const range = useMemo(() => ({ min, max }), [min, max])
  return (
    <GaugeRangeContext value={range}>
      <ProgressPrimitive data-tone={tone} className={cnState(gaugeClassNames.root, className)} {...props} />
    </GaugeRangeContext>
  )
}

function ProgressLabel({ className, ...props }: ComponentProps<typeof ProgressLabelPrimitive>) {
  return <ProgressLabelPrimitive className={cnState(gaugeClassNames.label, className)} {...props} />
}

function ProgressValue({
  className,
  formatValue,
  children,
  ...props
}: ComponentProps<typeof ProgressValuePrimitive> & GaugeValueFormatProps<number | null>) {
  const range = use(GaugeRangeContext)
  return (
    <ProgressValuePrimitive className={cnState(gaugeClassNames.value, className)} {...props}>
      {children ??
        (formatValue && ((state) => formatValue(state.value, { ...range, percent: state.percent, text: state.text })))}
    </ProgressValuePrimitive>
  )
}

function ProgressTrack({ className, children, ...props }: ComponentProps<typeof ProgressTrackPrimitive>) {
  return (
    <ProgressTrackPrimitive className={cnState(gaugeClassNames.track, className)} {...props}>
      {children ?? <ProgressIndicator />}
    </ProgressTrackPrimitive>
  )
}

// Indeterminate has no width to show, so the whole track pulses; reduced motion keeps it still.
function ProgressIndicator({ className, ...props }: ComponentProps<typeof ProgressIndicatorPrimitive>) {
  return (
    <ProgressIndicatorPrimitive
      className={cnState(
        `${gaugeClassNames.indicator} data-indeterminate:inset-x-0 data-indeterminate:motion-safe:animate-pulse`,
        className,
      )}
      {...props}
    />
  )
}

export { GaugeRangeContext, gaugeClassNames, Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue }
export type { GaugeToneProps, GaugeValueDetails, GaugeValueFormatProps }
export type { ProgressState } from "@ui-sdk/react/progress"
