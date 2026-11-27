"use client"

import { createParts, usePart, type PartProps } from "@ui-sdk/react/primitive"
import { createContext, use, type ComponentProps } from "react"

import {
  createScrollAreaController,
  scrollArea,
  type Orientation,
  type ScrollAreaScrollbarState,
  type ScrollAreaThumbState,
} from "@/components/ui/scroll-area-primitive"
import { cnState } from "@/lib/utils"

const parts = /* @__PURE__ */ createParts(scrollArea, {
  root: "div",
  viewport: "div",
  content: "div",
  corner: "div",
  "scroll-to-end": "button",
})

const OrientationContext = /* @__PURE__ */ createContext<Orientation>("vertical")

/** The root sets `position: relative` inline, so a sticky or absolute root takes `sticky!` or `absolute!`. */
function ScrollArea({ className, ...props }: ComponentProps<typeof parts.Root>) {
  return <parts.Root className={cnState("relative overflow-hidden", className)} {...props} />
}

function ScrollAreaViewport({ className, ...props }: ComponentProps<typeof parts.Viewport>) {
  return (
    <parts.Viewport
      className={cnState(
        "size-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      {...props}
    />
  )
}

// Functions rather than `const ScrollAreaContent = parts.Content`: a property read at the top of a module counts as a
// side effect to bundlers, which then keep the whole scroll area in every bundle that imports this file.
function ScrollAreaContent(props: ComponentProps<typeof parts.Content>) {
  return <parts.Content {...props} />
}

function ScrollAreaCorner(props: ComponentProps<typeof parts.Corner>) {
  return <parts.Corner {...props} />
}

function ScrollAreaScrollToEnd(props: ComponentProps<typeof parts.ScrollToEnd>) {
  return <parts.ScrollToEnd {...props} />
}

/**
 * A scrollbar for one axis; without children it holds its thumb. `data-agent-hidden` on it leaves its scroll area out
 * of agents' snapshot and keeps what it holds: for one inside a component agents already know by name, which the
 * scroll area would otherwise repeat, making `query({ within })` with that name ambiguous.
 */
function ScrollAreaScrollbar({
  orientation = "vertical",
  className,
  children,
  ...props
}: PartProps<"div", ScrollAreaScrollbarState> & { orientation?: Orientation }) {
  return (
    <OrientationContext value={orientation}>
      {usePart(
        scrollArea,
        "scrollbar",
        { id: orientation, orientation },
        {
          ...props,
          className: cnState(
            // oxlint-disable-next-line p-otero/spacing-tokens -- the thumb's inset inside the size-2 track: geometry, not spacing
            "group/scrollbar flex touch-none p-0.5 opacity-0 transition-opacity select-none data-visible:opacity-100 data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2",
            className,
          ),
          children: children ?? <ScrollAreaThumb />,
        },
      )}
    </OrientationContext>
  )
}

function ScrollAreaThumb({ className, ...props }: PartProps<"div", ScrollAreaThumbState>) {
  const orientation = use(OrientationContext)
  return usePart(
    scrollArea,
    "thumb",
    { id: orientation, orientation },
    {
      ...props,
      className: cnState(
        "relative flex-1 rounded-full bg-muted-foreground/25 transition-colors group-hover/scrollbar:bg-muted-foreground/50 data-dragging:bg-muted-foreground/70",
        className,
      ),
    },
  )
}

export {
  createScrollAreaController,
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaScrollToEnd,
  ScrollAreaThumb,
  ScrollAreaViewport,
}
