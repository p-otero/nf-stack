"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"
import { Children, isValidElement, useId, useState } from "react"

import { CardTitleContext, useCardTitleRegistration } from "@/components/ui/use-card-title"
import { cn } from "@/lib/utils"

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

function part(slot: string, base: string) {
  return function CardPart({ className, render, ...props }: PartProps<"div">) {
    return renderElement("div", { "data-slot": slot, className: cn(base, className), ...props }, render)
  }
}

type CardSurface = "card" | "none" | "dashed"

const cardVariants = cva("flex flex-col gap-group text-card-foreground", {
  variants: {
    surface: {
      card: "rounded-surface border bg-card/(--glass-opacity) py-inset-surface field-label-surface-card shadow-surface backdrop-surface",
      dashed: "rounded-surface border border-dashed py-inset-surface",
      none: "[&>[data-slot^=card-]]:px-0",
    },
  },
  defaultVariants: { surface: "card" },
})

type CardProps = PartProps<"section"> & {
  /** `dashed` is an outlined, unfilled tile, like a "create" placeholder; `none` drops the box and its padding. */
  surface?: CardSurface
}

// A titled card is a named region; the title registers its id after mount, so the section is always the same element.
function Card({ className, render, children, surface = "card", ...props }: CardProps) {
  const [titleId, setTitleId] = useState<string>()
  return (
    <CardTitleContext value={setTitleId}>
      {renderElement(
        "section",
        {
          "data-slot": "card",
          "data-surface": surface,
          "aria-labelledby": titleId,
          className: cn(cardVariants({ surface }), className),
          children,
          ...props,
        },
        render,
      )}
    </CardTitleContext>
  )
}

const CardEyebrow = part("card-eyebrow", "text-meta tracking-meta text-muted-foreground uppercase")

const CardAction = part("card-action", "flex max-w-full min-w-0 flex-wrap items-center gap-items")

// With an action, the header is a wrapping row: the heading (eyebrow, title, description) grows from a basis of
// --card-heading-basis, so the action wraps below it as soon as the heading would get narrower than that, whatever
// the action's width. A CardAction must be a direct child.
function CardHeader({ className, render, children, ...props }: PartProps<"div">) {
  const parts = typeof children === "function" ? [] : Children.toArray(children)
  const actions = parts.filter((child) => isValidElement(child) && child.type === CardAction)
  if (actions.length === 0) {
    return renderElement(
      "div",
      {
        "data-slot": "card-header",
        className: cn("flex flex-col gap-inline px-inset-surface", className),
        children,
        ...props,
      },
      render,
    )
  }
  return renderElement(
    "div",
    {
      "data-slot": "card-header",
      className: cn("flex flex-wrap items-start gap-x-group gap-y-items px-inset-surface", className),
      children: (
        <>
          <div data-slot="card-heading" className="flex min-w-0 grow basis-(--card-heading-basis) flex-col gap-inline">
            {parts.filter((child) => !actions.includes(child))}
          </div>
          {actions}
        </>
      ),
      ...props,
    },
    render,
  )
}

type CardTitleProps = PartProps<"div"> & {
  /** Renders an `h1`–`h6`. Without it the title is a `div` that still names the card. */
  headingLevel?: HeadingLevel
}

function CardTitle({ className, render, headingLevel, id, ...props }: CardTitleProps) {
  const generatedId = useId()
  const renderedId = isValidElement<{ id?: string }>(render) ? render.props.id : undefined
  const titleId = renderedId ?? id ?? generatedId
  useCardTitleRegistration(titleId)
  return renderElement(
    headingLevel === undefined ? "div" : `h${headingLevel}`,
    {
      "data-slot": "card-title",
      id: titleId,
      className: cn("text-title-sm leading-none wrap-anywhere", className),
      ...props,
    },
    render,
  )
}

const CardDescription = part("card-description", "text-sm text-muted-foreground")
const CardContent = part("card-content", "px-inset-surface")
const CardFooter = part("card-footer", "flex items-center gap-items px-inset-surface")

export { Card, CardAction, CardContent, CardDescription, CardEyebrow, CardFooter, CardHeader, CardTitle, cardVariants }
export type { CardProps, CardSurface, CardTitleProps, HeadingLevel as CardHeadingLevel }
