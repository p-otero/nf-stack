import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

type FloatingSide = "top" | "bottom" | "start" | "end"
type FloatingAlign = "start" | "center" | "end"
type FloatingStrategy = "sticky" | "fixed" | "absolute"

// Safe-area insets are physical, so the inline sides swap them under rtl.
const sideClassName: Record<FloatingSide, string> = {
  top: "inset-x-0 top-[calc(var(--floating-offset)+env(safe-area-inset-top))] flex-row ps-[max(var(--floating-offset),env(safe-area-inset-left))] pe-[max(var(--floating-offset),env(safe-area-inset-right))] rtl:ps-[max(var(--floating-offset),env(safe-area-inset-right))] rtl:pe-[max(var(--floating-offset),env(safe-area-inset-left))]",
  bottom:
    "inset-x-0 bottom-[calc(var(--floating-offset)+env(safe-area-inset-bottom))] flex-row ps-[max(var(--floating-offset),env(safe-area-inset-left))] pe-[max(var(--floating-offset),env(safe-area-inset-right))] rtl:ps-[max(var(--floating-offset),env(safe-area-inset-right))] rtl:pe-[max(var(--floating-offset),env(safe-area-inset-left))]",
  start:
    "inset-y-0 start-[calc(var(--floating-offset)+env(safe-area-inset-left))] rtl:start-[calc(var(--floating-offset)+env(safe-area-inset-right))] flex-col pt-[max(var(--floating-offset),env(safe-area-inset-top))] pb-[max(var(--floating-offset),env(safe-area-inset-bottom))]",
  end: "inset-y-0 end-[calc(var(--floating-offset)+env(safe-area-inset-right))] rtl:end-[calc(var(--floating-offset)+env(safe-area-inset-left))] flex-col pt-[max(var(--floating-offset),env(safe-area-inset-top))] pb-[max(var(--floating-offset),env(safe-area-inset-bottom))]",
}

const alignClassName: Record<FloatingAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
}

type FloatingProps = ComponentProps<"div"> & {
  side?: FloatingSide
  align?: FloatingAlign
  strategy?: FloatingStrategy
}

// The positioner spans the edge and lets clicks through; only its children catch them.
function Floating({ side = "bottom", align = "center", strategy = "sticky", className, ...props }: FloatingProps) {
  return (
    <div
      data-slot="floating"
      data-side={side}
      data-align={align}
      data-strategy={strategy}
      className={cn(
        "group/floating pointer-events-none z-sticky flex *:pointer-events-auto",
        strategy,
        sideClassName[side],
        alignClassName[align],
        className,
      )}
      {...props}
    />
  )
}

function FloatingContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="floating-content"
      className={cn(
        "flex max-w-full items-center gap-items surface-floating p-inline text-sm group-data-[side=end]/floating:flex-col group-data-[side=start]/floating:flex-col",
        className,
      )}
      {...props}
    />
  )
}

export { Floating, FloatingContent }
export type { FloatingAlign, FloatingProps, FloatingSide, FloatingStrategy }
