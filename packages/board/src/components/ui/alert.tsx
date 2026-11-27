import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"

import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

type AlertTone = Tone

const alertVariants = cva(
  // oxlint-disable-next-line shadcn/no-arbitrary-values -- the start padding clears the absolute size-4 icon plus a 12px gap, for the text and a wrapped action; two rows let the action span title and description
  "@container relative grid w-full grid-cols-[minmax(0,1fr)_auto] gap-y-inline rounded-surface border bg-background/(--glass-opacity) p-inset-surface text-sm text-foreground has-[>[data-slot=alert-action]]:grid-rows-[auto_1fr] has-[>svg]:ps-[calc(var(--surface-padding)+1.75rem)] [&>:not([data-slot=alert-action],svg)]:col-start-1 [&>svg]:absolute [&>svg]:start-inset-surface [&>svg]:top-inset-surface [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      tone: {
        neutral: "[&>svg]:text-muted-foreground",
        info: "border-info-border [&>svg]:text-info [&_[data-slot=alert-title]]:text-info",
        success: "border-success-border [&>svg]:text-success [&_[data-slot=alert-title]]:text-success",
        warning: "border-warning-border [&>svg]:text-warning [&_[data-slot=alert-title]]:text-warning",
        destructive: "border-destructive-border [&>svg]:text-destructive [&_[data-slot=alert-title]]:text-destructive",
        violet: "border-violet-border [&>svg]:text-violet [&_[data-slot=alert-title]]:text-violet",
      },
    },
    defaultVariants: { tone: "info" },
  },
)

type AlertProps = PartProps<"div"> & {
  tone?: AlertTone
  /** A trailing control, like a Button. It sits beside the text, and below it when the alert is narrower than 28rem. */
  action?: ReactNode
  /**
   * Makes it a live region for messages that appear after the page loads: `role="alert"` for warning and
   * destructive tones, which interrupts a screen reader, `role="status"` otherwise. Off by default.
   */
  live?: boolean
  /** @deprecated Use `live`. Always `role="alert"`, whatever the tone. */
  announce?: boolean
}

function liveRole(tone: AlertTone, live?: boolean, announce?: boolean) {
  if (announce) return "alert"
  if (!live) return undefined
  return tone === "warning" || tone === "destructive" ? "alert" : "status"
}

function Alert({ className, tone, action, live, announce, render, children, ...props }: AlertProps) {
  const resolvedTone = tone ?? "info"
  return renderElement(
    "div",
    {
      "data-slot": "alert",
      "data-tone": resolvedTone,
      role: liveRole(resolvedTone, live, announce),
      className: cn(alertVariants({ tone }), className),
      ...props,
      children: (
        <>
          {children}
          {action === undefined ? null : (
            <div
              data-slot="alert-action"
              className="col-start-2 row-span-2 row-start-1 flex flex-wrap items-center gap-items self-center ps-group @max-md:col-start-1 @max-md:row-auto @max-md:ps-0 @max-md:pt-inline"
            >
              {action}
            </div>
          )}
        </>
      ),
    },
    render,
  )
}

function AlertTitle({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "alert-title",
      className: cn("min-w-0 leading-snug font-medium wrap-anywhere", className),
      ...props,
    },
    render,
  )
}

function AlertDescription({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "alert-description",
      className: cn("min-w-0 text-muted-foreground wrap-anywhere [&_p]:leading-relaxed", className),
      ...props,
    },
    render,
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
export type { AlertProps, AlertTone }
