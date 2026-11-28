import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import { cn } from "@/lib/utils"

// Spec: reduced motion stops the pulse outright; the theme's shortened durations would turn an infinite loop into
// flicker.
function Skeleton({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "skeleton",
      "aria-hidden": true,
      className: cn("animate-pulse rounded-control bg-skeleton motion-reduce:animate-none", className),
      ...props,
    },
    render,
  )
}

export { Skeleton }
