import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import { cn } from "@/lib/utils"

function Kbd({ className, render, ...props }: PartProps<"kbd">) {
  return renderElement(
    "kbd",
    {
      "data-slot": "kbd",
      className: cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-inline rounded-sm border bg-muted px-inset-chip font-sans text-xs font-medium text-muted-foreground select-none [&_svg]:size-3 [&_svg]:shrink-0",
        className,
      ),
      ...props,
    },
    render,
  )
}

function KbdGroup({ className, render, ...props }: PartProps<"kbd">) {
  return renderElement(
    "kbd",
    { "data-slot": "kbd-group", className: cn("inline-flex items-center gap-inline", className), ...props },
    render,
  )
}

export { Kbd, KbdGroup }
