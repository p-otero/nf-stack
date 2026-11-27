import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function part(slot: string, base: string) {
  return function EmptyPart({ className, render, ...props }: PartProps<"div">) {
    return renderElement("div", { "data-slot": slot, className: cn(base, className), ...props }, render)
  }
}

type EmptySize = "inline" | "panel" | "page"

const emptyVariants = cva("group/empty flex min-w-0 flex-col text-balance", {
  variants: {
    size: {
      inline: "items-start gap-items text-start",
      panel:
        "flex-1 items-center justify-center gap-group rounded-surface border border-dashed p-inset-surface text-center",
      page: "flex-1 items-center justify-center gap-group px-inset-surface py-section text-center",
    },
  },
  defaultVariants: { size: "panel" },
})

/** `inline` sits in a list or table without a box, `panel` (default) fills a card or column, `page` is a whole screen. */
function Empty({ className, size, render, ...props }: PartProps<"div"> & VariantProps<typeof emptyVariants>) {
  return renderElement(
    "div",
    {
      "data-slot": "empty",
      "data-size": size ?? "panel",
      className: cn(emptyVariants({ size }), className),
      ...props,
    },
    render,
  )
}

const EmptyHeader = part(
  "empty-header",
  "flex max-w-sm flex-col items-center gap-items group-data-[size=inline]/empty:max-w-none group-data-[size=inline]/empty:items-start group-data-[size=inline]/empty:gap-inline",
)
const EmptyTitle = part(
  "empty-title",
  "text-title-sm group-data-[size=inline]/empty:text-body group-data-[size=inline]/empty:font-medium group-data-[size=page]/empty:text-title",
)
const EmptyDescription = part(
  "empty-description",
  "text-sm text-muted-foreground [&>a]:text-link [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:decoration-2",
)
const EmptyContent = part(
  "empty-content",
  "flex w-full max-w-sm flex-col items-center gap-group text-sm text-balance group-data-[size=inline]/empty:items-start",
)

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "size-10 rounded-control bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function EmptyMedia({
  className,
  variant,
  render,
  ...props
}: PartProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return renderElement(
    "div",
    {
      "data-slot": "empty-media",
      "data-variant": variant ?? "default",
      className: cn(emptyMediaVariants({ variant }), className),
      ...props,
    },
    render,
  )
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, emptyMediaVariants, EmptyTitle, emptyVariants }
export type { EmptySize }
