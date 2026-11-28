import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"

import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

type StatusTone = Tone | "muted"

const statusPillVariants = cva(
  "inline-flex w-fit max-w-full shrink-0 items-center gap-inline rounded-control border px-inset-chip py-inset-chip text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
        info: "border-info-border bg-info-soft text-info-soft-foreground",
        success: "border-success-border bg-success-soft text-success-soft-foreground",
        warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
        destructive: "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
        violet: "border-violet-border bg-violet-soft text-violet-soft-foreground",
        muted: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

// Spec: a dot on its own needs 3:1 against the page (WCAG 1.4.11), so the quiet tones take a stronger grey.
const dotToneClassNames = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  violet: "text-violet",
  muted: "text-input-strong",
} satisfies Record<StatusTone, string>

/** `true` pings three times whenever the status changes, then rests; `"always"` pings until it is turned off. */
type StatusPulse = boolean | "always"

// Perf: a running ping is a transform animation, and Chrome promotes everything painted after one to its own layer in
// case they overlap: twenty pinging cards on a board cost ~15 ms of layerizing on every repaint. So it stops.
const pulseThrice = { animationIterationCount: 3 }

/**
 * The ping behind a status dot. `restartKey` names the status: a new one mounts a new ping, which runs again.
 * Exported for marks that draw their own dot, like a task card's liveness chip.
 */
function StatusPing({ pulse, restartKey }: { pulse?: StatusPulse; restartKey?: string }) {
  if (!pulse) return null
  return (
    <span
      key={restartKey}
      data-slot="status-ping"
      className="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping motion-reduce:hidden"
      style={pulse === "always" ? undefined : pulseThrice}
    />
  )
}

function Dot({ pulse, restartKey }: { pulse?: StatusPulse; restartKey?: string }) {
  return (
    <span aria-hidden="true" data-slot="status-pill-dot" className="relative inline-flex size-1.5 shrink-0">
      <StatusPing pulse={pulse} restartKey={restartKey} />
      <span className="relative size-full rounded-full bg-current" />
    </span>
  )
}

const pulseAttribute = (pulse: StatusPulse | undefined) => (pulse === "always" ? "always" : pulse ? "" : undefined)

type StatusDotProps = Omit<PartProps<"span">, "children"> & {
  /** What the dot means, read by screen readers and agents in place of the colour. */
  label: string
  tone?: StatusTone
  /**
   * Pings to show something live: three times when it turns on or the status changes, then still. `"always"` keeps
   * pinging; avoid it in lists and boards, where every running ping makes the page slower to repaint. Still under
   * reduced motion.
   */
  pulse?: StatusPulse
}

function StatusDot({ className, label, tone, pulse, render, ...props }: StatusDotProps) {
  return renderElement(
    "span",
    {
      "data-slot": "status-dot",
      "data-tone": tone ?? "neutral",
      "data-pulse": pulseAttribute(pulse),
      className: cn("inline-flex shrink-0 items-center", dotToneClassNames[tone ?? "neutral"], className),
      children: (
        <>
          <Dot pulse={pulse} restartKey={`${tone ?? "neutral"}:${label}`} />
          <span className="sr-only">{label}</span>
        </>
      ),
      ...props,
    },
    render,
  )
}

type StatusPillProps = Omit<PartProps<"span">, "children"> & {
  children?: ReactNode
  tone?: StatusTone
  dot?: boolean
  /** With `dot`: pings three times when it turns on or the tone changes; `"always"` keeps pinging (costly in lists). */
  pulse?: StatusPulse
}

function StatusPill({ className, tone, dot, pulse, render, children, ...props }: StatusPillProps) {
  return renderElement(
    "span",
    {
      "data-slot": "status-pill",
      "data-tone": tone ?? "neutral",
      "data-pulse": dot ? pulseAttribute(pulse) : undefined,
      className: cn(statusPillVariants({ tone }), className),
      children: (
        <>
          {dot && <Dot pulse={pulse} restartKey={tone ?? "neutral"} />}
          <span data-slot="status-pill-label" className="inline-flex min-w-0 items-center gap-inline">
            {children}
          </span>
        </>
      ),
      ...props,
    },
    render,
  )
}

export { StatusDot, StatusPill, StatusPing, statusPillVariants }
export type { StatusDotProps, StatusPillProps, StatusPulse, StatusTone }
