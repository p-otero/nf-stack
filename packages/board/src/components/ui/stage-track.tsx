import { createElement, type ComponentProps } from "react"

import { Link } from "@/components/ui/link"
import { StatusPill } from "@/components/ui/status-pill"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"
import { StageFilter, type StageFilterProps } from "@/components/ui/stage-filter"

type Stage = { id: string; label: string; tone?: Tone }
type StageSize = "sm" | "md"
type StageState = "reached" | "current" | "upcoming"

// Spec: neutral uses the grey that reaches 3:1 as a mark (WCAG 1.4.11).
const fillClassNames = {
  default: "bg-primary text-primary-foreground border-primary",
  neutral: "bg-muted-foreground text-background border-muted-foreground",
  info: "bg-info text-info-foreground border-info",
  success: "bg-success text-success-foreground border-success",
  warning: "bg-warning text-warning-foreground border-warning",
  destructive: "bg-destructive text-destructive-foreground border-destructive",
  violet: "bg-violet text-violet-foreground border-violet",
} satisfies Record<Tone | "default", string>

const lineClassNames = {
  default: "bg-primary",
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  violet: "bg-violet",
} satisfies Record<Tone | "default", string>

const ringClassNames = {
  default: "ring-primary/25",
  neutral: "ring-muted-foreground/25",
  info: "ring-info/25",
  success: "ring-success/25",
  warning: "ring-warning/25",
  destructive: "ring-destructive/25",
  violet: "ring-violet/25",
} satisfies Record<Tone | "default", string>

function stateOf(index: number, currentIndex: number): StageState {
  if (index < currentIndex) return "reached"
  return index === currentIndex ? "current" : "upcoming"
}

function Marker({ state, tone, size }: { state: StageState; tone: Tone | "default"; size: StageSize }) {
  const box = size === "sm" ? "size-3.5 [&_svg]:size-2.5" : "size-5 [&_svg]:size-3"
  if (state === "upcoming") {
    return (
      <span
        className={cn("relative z-10 block shrink-0 rounded-full border-2 border-input-strong bg-background", box)}
      />
    )
  }
  return (
    <span
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center rounded-full border-2",
        fillClassNames[tone],
        box,
        state === "current" && cn("ring-4", ringClassNames[tone]),
      )}
    >
      {state === "reached" ? (
        // oxlint-disable-next-line eskais/no-inline-icons -- a stage marker's tick, scaled with its marker at a heavier stroke
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <path d="m5 12 5 5 9-10" />
        </svg>
      ) : (
        <span className="size-1/3 rounded-full bg-current" />
      )}
    </span>
  )
}

type StagePillProps = Omit<ComponentProps<typeof StatusPill>, "tone" | "children"> & {
  stage: Stage
  size?: StageSize
  href?: string
}

/** The current stage alone, as a pill: "In Dev". */
function StagePill({ stage, size = "sm", href, className, ...props }: StagePillProps) {
  return (
    <StatusPill
      data-slot="stage-pill"
      data-stage={stage.id}
      tone={stage.tone ?? "info"}
      dot
      render={href ? createElement("a", { href }) : undefined}
      className={cn(
        size === "md" && "px-inset-item text-body-sm",
        href &&
          "underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    >
      {stage.label}
    </StatusPill>
  )
}

type StageTrackProps = Omit<ComponentProps<"ol">, "children"> & {
  stages: readonly Stage[]
  /** The id of the stage the work is in. Stages before it count as reached. */
  current: string
  size?: StageSize
  /** `track`: every stage in a row. `pill`: only the current one. */
  variant?: "track" | "pill"
  /** Makes a stage a link, like the PR or the deployment it stands for. */
  getHref?: (stage: Stage) => string | undefined
}

function StageTrack({
  stages,
  current,
  size = "md",
  variant = "track",
  getHref,
  className,
  ...props
}: StageTrackProps) {
  const currentIndex = stages.findIndex((stage) => stage.id === current)

  if (variant === "pill") {
    const stage = stages[currentIndex]
    if (!stage) return null
    return <StagePill stage={stage} size={size} href={getHref?.(stage)} className={className} />
  }

  return (
    <div data-slot="stage-track-container" className={cn("@container w-full min-w-0", className)}>
      <ol
        data-slot="stage-track"
        data-size={size}
        className="flex flex-col gap-inline @sm:flex-row @sm:items-start @sm:gap-0"
        {...props}
      >
        {stages.map((stage, index) => {
          const state = stateOf(index, currentIndex)
          const tone = stage.tone ?? "default"
          const href = getHref?.(stage)
          const labelClassName = cn(
            "min-w-0 text-balance break-words @sm:max-w-full",
            size === "sm" ? "text-caption" : "text-body-sm",
            state === "current" ? "font-semibold text-foreground" : "",
            state === "reached" ? "text-foreground" : "",
            state === "upcoming" ? "text-muted-foreground" : "",
          )
          return (
            <li
              key={stage.id}
              data-slot="stage"
              data-state={state}
              data-stage={stage.id}
              aria-current={state === "current" ? "step" : undefined}
              className="flex min-w-0 items-center gap-items @sm:flex-1 @sm:flex-col @sm:gap-inline @sm:text-center"
            >
              <span aria-hidden="true" className="relative flex shrink-0 justify-center @sm:w-full">
                {index > 0 && (
                  <span
                    className={cn(
                      "absolute top-1/2 end-1/2 hidden h-0.5 w-full -translate-y-1/2 @sm:block",
                      state === "upcoming" ? "bg-border" : lineClassNames[tone],
                    )}
                  />
                )}
                <Marker state={state} tone={tone} size={size} />
              </span>
              {href ? (
                <Link
                  href={href}
                  variant="plain"
                  className={cn(
                    labelClassName,
                    "rounded-choice underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {stage.label}
                </Link>
              ) : (
                <span className={labelClassName}>{stage.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export { StagePill, StageTrack }
export { StageFilter }
export type { Stage, StagePillProps, StageSize, StageTrackProps }
export type { StageFilterProps }
