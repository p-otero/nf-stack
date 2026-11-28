"use client"

import {
  Meter as MeterPrimitive,
  MeterIndicator as MeterIndicatorPrimitive,
  MeterLabel as MeterLabelPrimitive,
  MeterTrack as MeterTrackPrimitive,
  MeterValue as MeterValuePrimitive,
} from "@ui-sdk/react/meter"
import { cva } from "class-variance-authority"
import { use, useMemo, type ComponentProps, type ReactNode } from "react"

import {
  GaugeRangeContext,
  gaugeClassNames,
  type GaugeToneProps,
  type GaugeValueFormatProps,
} from "@/components/ui/progress"
import { cnState } from "@/lib/utils"

type MeterVariant = "bar" | "ring"

const meterVariants = cva("", {
  variants: {
    variant: {
      bar: gaugeClassNames.root,
      ring: "group/gauge inline-flex w-fit max-w-full min-w-0 flex-col items-center gap-inline text-center",
    },
  },
})

type MeterProps = ComponentProps<typeof MeterPrimitive> &
  GaugeToneProps & {
    /** `bar` (default) lays out a label, a value and a `MeterTrack`; `ring` centres a label under a `MeterRing`. */
    variant?: MeterVariant
  }

function Meter({ className, tone, variant = "bar", ...props }: MeterProps) {
  const { min = 0, max = 100 } = props
  const range = useMemo(() => ({ min, max }), [min, max])
  return (
    <GaugeRangeContext value={range}>
      <MeterPrimitive
        data-tone={tone}
        data-variant={variant}
        className={cnState(meterVariants({ variant }), className)}
        {...props}
      />
    </GaugeRangeContext>
  )
}

function MeterLabel({ className, ...props }: ComponentProps<typeof MeterLabelPrimitive>) {
  return (
    <MeterLabelPrimitive className={cnState(`${gaugeClassNames.label} max-w-full min-w-0`, className)} {...props} />
  )
}

function MeterValue({
  className,
  formatValue,
  children,
  ...props
}: ComponentProps<typeof MeterValuePrimitive> & GaugeValueFormatProps<number>) {
  const range = use(GaugeRangeContext)
  return (
    <MeterValuePrimitive className={cnState(gaugeClassNames.value, className)} {...props}>
      {children ??
        (formatValue && ((state) => formatValue(state.value, { ...range, percent: state.percent, text: state.text })))}
    </MeterValuePrimitive>
  )
}

function MeterTrack({ className, children, ...props }: ComponentProps<typeof MeterTrackPrimitive>) {
  return (
    <MeterTrackPrimitive className={cnState(gaugeClassNames.track, className)} {...props}>
      {children ?? <MeterIndicator />}
    </MeterTrackPrimitive>
  )
}

function MeterIndicator({ className, ...props }: ComponentProps<typeof MeterIndicatorPrimitive>) {
  return <MeterIndicatorPrimitive className={cnState(gaugeClassNames.indicator, className)} {...props} />
}

type MeterRingSize = "sm" | "md" | "lg"

const ringVariants = cva("relative inline-grid shrink-0 place-items-center", {
  variants: {
    size: {
      sm: "size-12 [&_[data-slot=meter-value]]:text-caption",
      md: "size-20 [&_[data-slot=meter-value]]:text-body",
      lg: "size-28 [&_[data-slot=meter-value]]:text-title-sm",
    },
  },
})

const arcClassName =
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- transitions only the properties that move; transition-all also eased every colour and shadow change
  "stroke-primary transition-[stroke-dasharray,stroke] duration-panel ease-standard motion-reduce:transition-none group-data-[tone=destructive]/gauge:stroke-destructive group-data-[tone=info]/gauge:stroke-info group-data-[tone=neutral]/gauge:stroke-muted-foreground group-data-[tone=success]/gauge:stroke-success group-data-[tone=violet]/gauge:stroke-violet group-data-[tone=warning]/gauge:stroke-warning"

const RADIUS_OF_CIRCUMFERENCE_100 = 100 / (2 * Math.PI)

type MeterRingProps = Omit<ComponentProps<typeof MeterTrackPrimitive>, "children"> & {
  size?: MeterRingSize
  /** Replaces the value in the centre. */
  children?: ReactNode
}

/**
 * The meter as a ring gauge, with the value in the centre (`children` replaces it). Put it in a
 * `Meter variant="ring"`, whose root keeps `role="meter"` and the value screen readers hear.
 */
function MeterRing({ size = "md", className, children, ...props }: MeterRingProps) {
  return (
    <MeterTrackPrimitive data-size={size} className={cnState(ringVariants({ size }), className)} {...props}>
      {(state) => (
        <>
          {/* oxlint-disable-next-line eskais/no-inline-icons -- the gauge's own drawing, not an icon */}
          <svg
            viewBox="0 0 36 36"
            aria-hidden="true"
            className="col-start-1 row-start-1 size-full -rotate-90 rtl:-scale-y-100"
          >
            <circle
              cx="18"
              cy="18"
              r={RADIUS_OF_CIRCUMFERENCE_100}
              fill="none"
              strokeWidth="3"
              className="stroke-input/40"
            />
            <circle
              data-slot="meter-ring-arc"
              cx="18"
              cy="18"
              r={RADIUS_OF_CIRCUMFERENCE_100}
              fill="none"
              strokeWidth="3"
              strokeLinecap={state.percent > 0 ? "round" : "butt"}
              strokeDasharray={`${String(state.percent)} 100`}
              className={arcClassName}
            />
          </svg>
          <span className="col-start-1 row-start-1 flex items-center justify-center font-medium tabular-nums">
            {children ?? <MeterValue className="text-foreground" />}
          </span>
        </>
      )}
    </MeterTrackPrimitive>
  )
}

export { Meter, MeterIndicator, MeterLabel, MeterRing, MeterTrack, MeterValue }
export type { MeterProps, MeterRingProps, MeterRingSize, MeterVariant }
export type { MeterState } from "@ui-sdk/react/meter"
