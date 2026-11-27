import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const spinnerVariants = cva("shrink-0", {
  variants: {
    size: {
      sm: "size-3",
      md: "size-4",
      lg: "size-6",
    },
  },
  defaultVariants: { size: "md" },
})

type SpinnerProps = Omit<ComponentProps<"svg">, "children"> &
  VariantProps<typeof spinnerVariants> & {
    /** Makes it a status region (`<output>`) that says this text to screen readers. Without it the spinner is decorative. */
    label?: string
  }

// The theme collapses CSS animations under reduced motion, so the reduced-motion arc pulses with SMIL instead of spinning.
function SpinnerGraphic({ className, size, ...props }: Omit<SpinnerProps, "label">) {
  return (
    // oxlint-disable-next-line eskais/no-inline-icons -- an animated progress arc with a reduced-motion pulse
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      data-slot="spinner"
      data-size={size ?? "md"}
      className={cn(spinnerVariants({ size }), "motion-safe:animate-spin", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" className="motion-reduce:hidden" />
      <g className="motion-safe:hidden">
        <path d="M21 12a9 9 0 1 1-9-9">
          <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />
        </path>
      </g>
    </svg>
  )
}

function Spinner({ label, ...props }: SpinnerProps) {
  if (label === undefined) return <SpinnerGraphic {...props} />
  return (
    <output data-slot="spinner-status" className="inline-flex">
      <SpinnerGraphic {...props} />
      <span className="sr-only">{label}</span>
    </output>
  )
}

export { Spinner, spinnerVariants }
export type { SpinnerProps }
