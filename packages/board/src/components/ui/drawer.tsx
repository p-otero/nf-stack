"use client"

import {
  Drawer,
  DrawerBackdrop as DrawerBackdropPrimitive,
  DrawerClose as DrawerClosePrimitive,
  DrawerContent as DrawerContentPrimitive,
  DrawerDescription as DrawerDescriptionPrimitive,
  DrawerHandle as DrawerHandlePrimitive,
  DrawerTitle as DrawerTitlePrimitive,
  DrawerTrigger as DrawerTriggerPrimitive,
  createDrawerController,
} from "@ui-sdk/react/drawer"
import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import type { ComponentProps, Ref } from "react"

import { buttonVariants, type ButtonLookProps } from "@/components/ui/button"
import { ControlTooltip } from "@/components/ui/tooltip"
import { useFocusReturn } from "@/components/ui/dialog"
import { cn, cnState } from "@/lib/utils"

const drawerBackdropClassName = "fixed inset-0 z-overlay bg-overlay data-ending-style:pointer-events-none"

const drawerContentClassName = [
  // oxlint-disable-next-line eskais/scroll-area -- the drawer element's fallback for content with no scrolling body of its own
  "data-ending-style:pointer-events-none! flex flex-col gap-group overflow-y-auto overscroll-contain border border-floating-border bg-popover p-inset-surface field-label-surface-popover wrap-anywhere text-popover-foreground shadow-floating outline-none",
  "data-[side=bottom]:mx-auto data-[side=bottom]:max-h-[calc(min(100%,var(--dialog-viewport-height,100%))-2rem)] data-[side=bottom]:w-full data-[side=bottom]:max-w-2xl data-[side=bottom]:rounded-t-surface data-[side=bottom]:border-b-0 data-[side=bottom]:pb-[max(var(--spacing-inset-surface),env(safe-area-inset-bottom))]",
  "data-[side=top]:mx-auto data-[side=top]:max-h-[calc(min(100%,var(--dialog-viewport-height,100%))-2rem)] data-[side=top]:w-full data-[side=top]:max-w-2xl data-[side=top]:rounded-b-surface data-[side=top]:border-t-0",
  "data-[side=right]:h-full data-[side=right]:w-[calc(100%-2rem)] data-[side=right]:max-w-sm data-[side=right]:rounded-l-surface data-[side=right]:border-r-0",
  "data-[side=left]:h-full data-[side=left]:w-[calc(100%-2rem)] data-[side=left]:max-w-sm data-[side=left]:rounded-r-surface data-[side=left]:border-l-0",
].join(" ")

// Workaround: UI SDK beta.12 lays the drawer's viewport out from `--keyboard-inset` against innerHeight, which iOS 26 can
// leave stale, so the viewport takes the visible viewport box instead, as DialogContent does.
const drawerViewportClassName =
  "top-[clamp(0px,var(--dialog-viewport-top,0px),100%-var(--dialog-viewport-height,100%))]! [--keyboard-inset:max(0px,100%-var(--dialog-viewport-bottom,100%))]!"

function DrawerTrigger({
  className,
  variant = "outline",
  size,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof DrawerTriggerPrimitive>, "aria-label"> & ButtonLookProps) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <DrawerTriggerPrimitive className={cnState(buttonVariants({ variant, size }), className)} {...props} />
    </ControlTooltip>
  )
}

function DrawerBackdrop({ className, ...props }: ComponentProps<typeof DrawerBackdropPrimitive>) {
  return <DrawerBackdropPrimitive className={cnState(drawerBackdropClassName, className)} {...props} />
}

function DrawerContent({
  className,
  finalFocus,
  ref,
  children,
  ...props
}: ComponentProps<typeof DrawerContentPrimitive>) {
  const {
    attach,
    finalFocus: returnFocus,
    wrap,
  } = useFocusReturn(finalFocus, ref as Ref<HTMLElement> | undefined, {
    viewportParentClassName: drawerViewportClassName,
  })
  return (
    <DrawerContentPrimitive
      ref={attach}
      className={cnState(drawerContentClassName, className)}
      finalFocus={returnFocus}
      {...props}
    >
      {wrap(children)}
    </DrawerContentPrimitive>
  )
}

function DrawerHandle({ className, ...props }: ComponentProps<typeof DrawerHandlePrimitive>) {
  return (
    <DrawerHandlePrimitive
      aria-label="Resize"
      className={cnState(
        "mx-auto flex h-5 w-16 shrink-0 cursor-grab items-center justify-center rounded-full outline-none before:h-1.5 before:w-12 before:rounded-full before:bg-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  )
}

function DrawerHeader({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    { "data-slot": "drawer-header", className: cn("flex flex-col gap-inline", className), ...props },
    render,
  )
}

function DrawerFooter({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "drawer-footer",
      className: cn("mt-auto flex flex-col-reverse gap-items sm:flex-row sm:justify-end", className),
      ...props,
    },
    render,
  )
}

function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerTitlePrimitive>) {
  return <DrawerTitlePrimitive className={cnState("text-title leading-none", className)} {...props} />
}

function DrawerDescription({ className, ...props }: ComponentProps<typeof DrawerDescriptionPrimitive>) {
  return <DrawerDescriptionPrimitive className={cnState("text-sm text-muted-foreground", className)} {...props} />
}

function DrawerClose({
  className,
  variant = "outline",
  size,
  tooltip,
  ...props
}: Omit<ComponentProps<typeof DrawerClosePrimitive>, "aria-label"> & ButtonLookProps) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <DrawerClosePrimitive className={cnState(buttonVariants({ variant, size }), className)} {...props} />
    </ControlTooltip>
  )
}

export {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  createDrawerController,
}
