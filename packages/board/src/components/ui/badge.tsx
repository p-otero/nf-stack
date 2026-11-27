import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"

import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

const toneClassNames = {
  neutral: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
  info: "border-info-border bg-info-soft text-info-soft-foreground",
  success: "border-success-border bg-success-soft text-success-soft-foreground",
  warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
  destructive: "border-destructive-border bg-destructive-soft text-destructive-soft-foreground",
  violet: "border-violet-border bg-violet-soft text-violet-soft-foreground",
} satisfies Record<Tone, string>

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-inline rounded-control border px-inset-chip py-inset-chip text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: toneClassNames.success,
        warning: toneClassNames.warning,
        info: toneClassNames.info,
        destructive: toneClassNames.destructive,
      },
      tone: toneClassNames,
    },
    defaultVariants: { variant: "default" },
  },
)

type BadgeLook = "default" | "secondary" | "outline"
type DeprecatedBadgeTone = Exclude<Tone, "neutral" | "violet">

type BadgeProps = PartProps<"span"> & {
  /** What the badge means; takes precedence over `variant`. */
  tone?: Tone
  /**
   * The look of a badge without a tone. `success`, `warning`, `info` and `destructive` still work but are
   * deprecated: use `tone`.
   */
  variant?: BadgeLook | DeprecatedBadgeTone
}

function isLook(variant: BadgeProps["variant"]): variant is BadgeLook {
  return variant === undefined || variant === "default" || variant === "secondary" || variant === "outline"
}

function Badge({ className, variant, tone, render, ...props }: BadgeProps) {
  const resolvedTone = tone ?? (isLook(variant) ? undefined : variant)
  return renderElement(
    "span",
    {
      "data-slot": "badge",
      "data-variant": variant ?? "default",
      "data-tone": resolvedTone,
      className: cn(badgeVariants(resolvedTone ? { variant: null, tone: resolvedTone } : { variant }), className),
      ...props,
    },
    render,
  )
}

export { Badge, badgeVariants }
export type { BadgeProps }
