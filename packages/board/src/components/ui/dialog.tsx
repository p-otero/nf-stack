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

const backdropClassName =
  "fixed inset-0 z-overlay bg-overlay transition-opacity duration-dialog ease-standard data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0"

// Workaround: iOS Safari can leave innerHeight stale and keep a closed keyboard's offsetTop, so sizes come from % and
// the visible viewport box (`useVisualViewportBox`), never viewport units. Safari 26 sizes a `fit-content` box placed
// between two edges from its flex children's 0% basis, so the content is placed from one edge with an auto height.
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
          "narrow:pb-[max(var(--spacing-inset-surface),env(safe-area-inset-bottom))] narrow:data-dialog-keyboard:pb-inset-surface narrow:data-dialog-flush:pb-[env(safe-area-inset-bottom)] narrow:data-dialog-flush:data-dialog-keyboard:pb-0",
        ].join(" "),
        false: "",
      },
    },
    defaultVariants: { size: "md", sheet: true },
  },
)

/** `md`, a bottom sheet on narrow screens. */
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

// Workaround: UI SDK 0.1.0-beta.10 records the opener after a React `autoFocus` inside the content has moved focus,
// then returns focus past the opener; these two mount before and after the children to record it first.
function RecordOpenerBeforeChildren({ memoryRef }: { memoryRef: RefObject<FocusMemory> }) {
  useRecordOpener(memoryRef)
  return null
}

function RecordFocusMoveAfterChildren({ memoryRef }: { memoryRef: RefObject<FocusMemory> }) {
  useRecordFocusMove(memoryRef)
  return null
}

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
      <RecordOpenerBeforeChildren memoryRef={memoryRef} />
      {content}
      <RecordFocusMoveAfterChildren memoryRef={memoryRef} />
      <OpenGuards contentRef={contentRef} parentClassName={parentClassName} />
    </>
  )
}

function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement | null) {
  if (typeof ref === "function") return ref(element)
  if (ref) ref.current = element
  return undefined
}

function focusWhereItIs() {
  // Workaround: UI SDK types the final focus as an HTMLElement, though it only focuses it (the body or an SVG can hold focus).
  return focusedElement() ?? assumeType<HTMLElement | null>(document.activeElement)
}

function resolveFocusTarget(target: Exclude<FinalFocus, "none">) {
  if (target === undefined || target === "trigger") return null
  if (typeof target === "function") return target()
  if (typeof target === "string") return document.querySelector<HTMLElement>(target)
  return target
}

/**
 * Give the content the returned `finalFocus` and `attach` (as its ref), and its children through `wrap`. Focus returns
 * to the opener after an `autoFocus` field took it and stays where it is while another modal holds it.
 * `viewportParentClassName` puts the visible viewport box on the content's parent instead.
 */
function useFocusReturn(
  finalFocus: FinalFocus,
  forwarded?: Ref<HTMLElement>,
  { viewportParentClassName }: { viewportParentClassName?: string } = {},
) {
  const memoryRef = useRef<FocusMemory>({ opener: null, movedBeforeOpen: false })
  const contentRef = useRef<HTMLElement | null>(null)
  const openerOrUiSdkFallback = () => {
    const { opener, movedBeforeOpen } = memoryRef.current
    return movedBeforeOpen && opener?.isConnected ? opener : null
  }
  const guarded = () => {
    if (!mayReturnFocus(contentRef.current)) return focusWhereItIs()
    return finalFocus === undefined
      ? openerOrUiSdkFallback()
      : resolveFocusTarget(finalFocus as Exclude<FinalFocus, "none">)
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
 * Scrolls between the header and footer and clips the hidden inputs of Select and Checkbox. Under
 * `data-dialog-flush` it drops its padding; keep the sides with `in-data-dialog-flush:px-inset-surface`.
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
