"use client"

import {
  Dialog,
  DialogBackdrop as DialogBackdropPrimitive,
  DialogClose as DialogClosePrimitive,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  createDialogController,
} from "@ui-sdk/react/dialog"
import { mergeProps, renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { cva, type VariantProps } from "class-variance-authority"
import { useCallback, useRef, type ComponentProps, type ReactNode, type Ref, type RefObject } from "react"

import { buttonVariants, type ButtonLookProps } from "@/components/ui/button"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { ControlTooltip } from "@/components/ui/tooltip"
import {
  focusedElement,
  mayReturnFocus,
  useFocusAboveKeyboard,
  useKeepPageStill,
  useRecordFocusMove,
  useRecordOpener,
  type FocusMemory,
} from "@/components/ui/use-dialog-focus"
import { useVisualViewportBox } from "@/components/ui/use-dialog-viewport"
import { cn, cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

// While they animate out, the backdrop and content let presses through, so the first click on the page counts.
const backdropClassName =
  "fixed inset-0 z-overlay bg-overlay transition-opacity duration-dialog ease-standard data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0"

// Sizes come from the containing block through %, never viewport units. The content stays in the visible part of the
// page (`useVisualViewportBox`), cut to the containing block: iOS Safari can leave `innerHeight` stale and keep a closed
// keyboard's `offsetTop` with the full height. While the keyboard is up (`data-dialog-keyboard`), which covers the
// layout viewport without resizing it, the content sits on the visible part's bottom edge.

// Placed from one edge with an auto height (centered: the middle of the visible part, moved up by half), never
// `fit-content` between two: Safari 26 sizes such a box from its column flex children's `flex-basis: 0%`, which cut
// a FormDialog or StepDialog (`flex-1` form and body) down to its header.
const dialogContentVariants = cva(
  [
    // oxlint-disable-next-line eskais/scroll-area -- the dialog element's fallback for content without a DialogBody, which is the scroll area
    "fixed inset-x-0 z-overlay mx-auto flex w-(--dialog-width) min-w-0 -translate-y-1/2 flex-col gap-group overflow-y-auto overscroll-contain rounded-floating border border-floating-border bg-popover p-inset-surface field-label-surface-popover text-popover-foreground wrap-anywhere shadow-floating outline-none transition duration-dialog ease-standard data-ending-style:pointer-events-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
    // oxlint-disable-next-line shadcn/no-arbitrary-values -- no token can read the visual viewport, which useVisualViewportBox sets on the content itself
    "top-[calc((clamp(0px,var(--dialog-viewport-top,0px),100%-var(--dialog-viewport-height,100%))+min(100%,var(--dialog-viewport-bottom,100%)))/2)] bottom-auto max-h-[min(var(--dialog-max-height),calc(var(--dialog-viewport-height,100%)-2*var(--floating-offset)))]",
    // oxlint-disable-next-line shadcn/no-arbitrary-values -- no token can read the visual viewport, which useVisualViewportBox sets on the content itself
    "data-dialog-keyboard:top-auto data-dialog-keyboard:bottom-[max(0px,100%-var(--dialog-viewport-bottom,100%))] data-dialog-keyboard:mb-floating data-dialog-keyboard:translate-y-0",
  ],
  {
    variants: {
      size: {
        sm: "max-w-sm",
        md: "max-w-lg",
        lg: "max-w-3xl",
        xl: "max-w-6xl",
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- no token can read the visual viewport, which useVisualViewportBox sets on the content itself
        full: "h-[min(var(--dialog-max-height),calc(var(--dialog-viewport-height,100%)-2*var(--floating-offset)))] max-w-none",
      },
      sheet: {
        true: [
          "narrow:top-auto narrow:bottom-[max(0px,100%-var(--dialog-viewport-bottom,100%))] narrow:mb-0 narrow:translate-y-0 narrow:data-dialog-keyboard:mb-0 narrow:max-h-[min(var(--sheet-max-height),calc(var(--dialog-viewport-height,100%)-var(--floating-offset)))] narrow:w-full narrow:max-w-none narrow:rounded-b-none narrow:border-b-0 narrow:data-ending-style:translate-y-full narrow:data-ending-style:scale-100 narrow:data-starting-style:translate-y-full narrow:data-starting-style:scale-100 narrow:motion-reduce:data-ending-style:translate-y-0 narrow:motion-reduce:data-starting-style:translate-y-0",
          // The sheet reaches the bottom edge, so it clears the home indicator when the page extends under it
          // (`viewport-fit=cover`); the keyboard covers that edge while it is up.
          "narrow:pb-[max(var(--spacing-inset-surface),env(safe-area-inset-bottom))] narrow:data-dialog-keyboard:pb-inset-surface narrow:data-dialog-flush:pb-[env(safe-area-inset-bottom)] narrow:data-dialog-flush:data-dialog-keyboard:pb-0",
        ].join(" "),
        false: "",
      },
    },
    defaultVariants: { size: "md", sheet: true },
  },
)

/** The default content look (`md`, a bottom sheet on narrow screens), for an AlertDialog or other content part. */
const contentClassName = dialogContentVariants()

type DialogSize = NonNullable<VariantProps<typeof dialogContentVariants>["size"]>

function DialogTrigger({
  className,
  variant = "outline",
  size,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof DialogTriggerPrimitive>, "aria-label"> & ButtonLookProps) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <DialogTriggerPrimitive className={cnState(buttonVariants({ variant, size }), className)} {...props} />
    </ControlTooltip>
  )
}

function DialogBackdrop({ className, ...props }: ComponentProps<typeof DialogBackdropPrimitive>) {
  return <DialogBackdropPrimitive className={cnState(backdropClassName, className)} {...props} />
}

type DialogContentProps = ComponentProps<typeof DialogContentPrimitive> & {
  /** `sm` 24rem, `md` 32rem (default), `lg` 48rem, `xl` 72rem; `full` fills its container less `--floating-offset`. */
  size?: DialogSize
  /** On narrow screens it rises from the bottom as a full-width sheet; `false` keeps it centered. */
  sheet?: boolean
}

type FinalFocus = ComponentProps<typeof DialogContentPrimitive>["finalFocus"]

// Mounts before the content's children, so its layout effect runs before React's `autoFocus` inside them, and
// records the element to return to.
function FocusOpener({ memoryRef }: { memoryRef: RefObject<FocusMemory> }) {
  useRecordOpener(memoryRef)
  return null
}

// Mounts after the children: focus that moved between the two was taken by `autoFocus`, before UI SDK could
// record where it came from (UI SDK 0.1.0-beta.10 then returns focus past the opener, to the next control).
function FocusMoved({ memoryRef }: { memoryRef: RefObject<FocusMemory> }) {
  useRecordFocusMove(memoryRef)
  return null
}

// Mounts with the content, so it follows the keyboard and the page's scroll only while the content is in the page.
function OpenGuards({
  contentRef,
  parentClassName,
}: {
  contentRef: RefObject<HTMLElement | null>
  parentClassName?: string
}) {
  useVisualViewportBox(contentRef, parentClassName)
  useFocusAboveKeyboard(contentRef)
  useKeepPageStill(contentRef)
  return null
}

function withFocusMarkers(
  content: ReactNode,
  memoryRef: RefObject<FocusMemory>,
  contentRef: RefObject<HTMLElement | null>,
  parentClassName?: string,
) {
  return (
    <>
      <FocusOpener memoryRef={memoryRef} />
      {content}
      <FocusMoved memoryRef={memoryRef} />
      <OpenGuards contentRef={contentRef} parentClassName={parentClassName} />
    </>
  )
}

function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement | null) {
  if (typeof ref === "function") return ref(element)
  if (ref) ref.current = element
  return undefined
}

function resolveFocusTarget(target: Exclude<FinalFocus, "none">) {
  if (target === undefined || target === "trigger") return null
  if (typeof target === "function") return target()
  if (typeof target === "string") return document.querySelector<HTMLElement>(target)
  return target
}

/**
 * Keeps focus return working where UI SDK misses it (an `autoFocus` field, another modal opening while this one
 * closes), a focused field above the keyboard and the locked page still. Give the content the returned `finalFocus`
 * and `attach` (its ref) and wrap its children. `viewportParentClassName` puts the visible box on its parent instead.
 */
function useFocusReturn(
  finalFocus: FinalFocus,
  forwarded?: Ref<HTMLElement>,
  { viewportParentClassName }: { viewportParentClassName?: string } = {},
) {
  const memoryRef = useRef<FocusMemory>({ opener: null, movedBeforeOpen: false })
  const contentRef = useRef<HTMLElement | null>(null)
  const returnTo = () => {
    const { opener, movedBeforeOpen } = memoryRef.current
    return movedBeforeOpen && opener?.isConnected ? opener : null
  }
  // Returning the focused element leaves focus where it is; null sends UI SDK down its own fallback chain.
  const guarded = () => {
    // The body, or an SVG element, which can hold focus too: returned as it is so focus stays there. UI SDK types the
    // final focus as an HTMLElement but only focuses it.
    if (!mayReturnFocus(contentRef.current))
      return focusedElement() ?? assumeType<HTMLElement | null>(document.activeElement)
    return finalFocus === undefined ? returnTo() : resolveFocusTarget(finalFocus as Exclude<FinalFocus, "none">)
  }
  function wrap<State>(children: ReactNode | ((state: State) => ReactNode)) {
    return typeof children === "function"
      ? (state: State) => withFocusMarkers(children(state), memoryRef, contentRef, viewportParentClassName)
      : withFocusMarkers(children, memoryRef, contentRef, viewportParentClassName)
  }
  const attach = useCallback(
    (element: HTMLElement | null) => {
      contentRef.current = element
      return assignRef(forwarded, element)
    },
    [forwarded],
  )
  return { finalFocus: finalFocus === "none" ? finalFocus : guarded, wrap, attach }
}

function DialogContent({
  className,
  size = "md",
  sheet = true,
  finalFocus,
  ref,
  children,
  ...props
}: DialogContentProps) {
  const { attach, finalFocus: returnFocus, wrap } = useFocusReturn(finalFocus, ref as Ref<HTMLElement> | undefined)
  return (
    <DialogContentPrimitive
      ref={attach}
      data-size={size}
      data-sheet={sheet ? "" : undefined}
      className={cnState(dialogContentVariants({ size, sheet }), className)}
      finalFocus={returnFocus}
      {...props}
    >
      {wrap(children)}
    </DialogContentPrimitive>
  )
}

function DialogHeader({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    { "data-slot": "dialog-header", className: cn("flex shrink-0 flex-col gap-inline", className), ...props },
    render,
  )
}

/**
 * The part that scrolls, so the header and footer stay in view; it clips the hidden inputs of Select and Checkbox.
 * Its scroll area reaches past the content's padding to its edges. Under `data-dialog-flush` the body drops its own
 * padding; a body that still wants its sides says so for that scope (`in-data-dialog-flush:px-inset-surface`).
 */
function DialogBody({ className, render, ...props }: PartProps<"div">) {
  return (
    <ScrollArea className="-mx-inset-surface flex min-h-0 min-w-0 flex-1 flex-col in-data-dialog-flush:mx-0">
      <ScrollAreaViewport
        render={(viewport) =>
          renderElement(
            "div",
            mergeProps(viewport, props, {
              "data-slot": "dialog-body",
              className: cn(
                "relative flex h-auto min-h-0 min-w-0 flex-1 flex-col gap-group overscroll-contain px-inset-surface in-data-dialog-flush:px-0",
                className,
              ),
            }),
            render,
          )
        }
      />
      <ScrollAreaScrollbar data-agent-hidden="" />
    </ScrollArea>
  )
}

function DialogFooter({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "dialog-footer",
      className: cn("flex shrink-0 flex-col-reverse gap-items sm:flex-row sm:justify-end", className),
      ...props,
    },
    render,
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogTitlePrimitive>) {
  return <DialogTitlePrimitive className={cnState("text-title leading-none", className)} {...props} />
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogDescriptionPrimitive>) {
  return <DialogDescriptionPrimitive className={cnState("text-sm text-muted-foreground", className)} {...props} />
}

function DialogClose({
  className,
  variant = "outline",
  size,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof DialogClosePrimitive>, "aria-label"> & ButtonLookProps) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <DialogClosePrimitive className={cnState(buttonVariants({ variant, size }), className)} {...props} />
    </ControlTooltip>
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  backdropClassName,
  contentClassName,
  createDialogController,
  dialogContentVariants,
  useFocusReturn,
}
export type { DialogContentProps, DialogSize }
