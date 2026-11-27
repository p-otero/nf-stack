"use client"

import {
  Popover as PopoverPrimitive,
  PopoverArrow as PopoverArrowPrimitive,
  PopoverClose as PopoverClosePrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
  createPopoverController,
} from "@ui-sdk/react/popover"
import { createContext, use, useMemo, useRef, type ComponentProps, type FocusEvent, type Ref } from "react"

import { buttonVariants, type ButtonLookProps } from "@/components/ui/button"
import { ControlTooltip } from "@/components/ui/tooltip"
import { cnState } from "@/lib/utils"

const floatingSurfaceClassName =
  "z-popover m-0 surface-floating outline-none origin-(--transform-origin) transition duration-micro ease-standard data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100"

const arrowClassName =
  // oxlint-disable-next-line p-otero/spacing-tokens -- half the arrow's size-2.5 (rounded up), so it straddles the edge
  "absolute size-2.5 rotate-45 border border-floating-border bg-popover data-[side=bottom]:-top-1.5 data-[side=bottom]:left-(--arrow-offset) data-[side=bottom]:-translate-x-1/2 data-[side=bottom]:border-e-0 data-[side=bottom]:border-b-0 data-[side=top]:-bottom-1.5 data-[side=top]:left-(--arrow-offset) data-[side=top]:-translate-x-1/2 data-[side=top]:border-s-0 data-[side=top]:border-t-0 data-[side=left]:-right-1.5 data-[side=left]:top-(--arrow-offset) data-[side=left]:-translate-y-1/2 data-[side=left]:border-b-0 data-[side=left]:border-s-0 data-[side=right]:-left-1.5 data-[side=right]:top-(--arrow-offset) data-[side=right]:-translate-y-1/2 data-[side=right]:border-e-0 data-[side=right]:border-t-0"

const popoverContentClassName = `${floatingSurfaceClassName} flex w-72 max-w-(--available-width) flex-col gap-group p-inset-surface`

type PopoverProps = ComponentProps<typeof PopoverPrimitive>

interface PopoverMount {
  setTrigger: (element: HTMLElement | null) => void
  focused: () => void
}

const PopoverMountContext = createContext<PopoverMount | null>(null)

function hostsTrigger(target: EventTarget | null | undefined, trigger: HTMLElement | null) {
  return target instanceof Node && trigger !== null && target !== trigger && target.contains(trigger)
}

/**
 * UI SDK 0.1.0-beta.10 closes a non-modal popover on any focus outside it, even one that never had focus. A
 * popover open from the start inside a dialog so closes as the dialog takes its initial focus
 * (docs/research/09-popover-default-open-in-dialog.md). Until focus first reaches it, a focus move onto an
 * ancestor of its trigger, its own dialog, is ignored.
 */
function Popover({ onOpenChange, ...props }: PopoverProps) {
  const trigger = useRef<HTMLElement | null>(null)
  const unfocused = useRef(props.open ?? props.defaultOpen ?? false)
  const mount = useMemo<PopoverMount>(
    () => ({
      setTrigger: (element) => {
        trigger.current = element
      },
      focused: () => {
        unfocused.current = false
      },
    }),
    [],
  )
  return (
    <PopoverMountContext value={mount}>
      <PopoverPrimitive
        {...props}
        onOpenChange={(open, details) => {
          if (
            !open &&
            unfocused.current &&
            details.reason === "focus-out" &&
            hostsTrigger(details.event?.target, trigger.current)
          ) {
            details.cancel()
            return
          }
          unfocused.current = false
          onOpenChange?.(open, details)
        }}
      />
    </PopoverMountContext>
  )
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

function PopoverTrigger({
  className,
  variant = "outline",
  size,
  tooltip,
  ref,
  ...props
}: Omit<ComponentProps<typeof PopoverTriggerPrimitive>, "aria-label"> & ButtonLookProps) {
  const mount = use(PopoverMountContext)
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <PopoverTriggerPrimitive
        ref={(element: HTMLButtonElement | null) => {
          if (!props.controller) mount?.setTrigger(element)
          assignRef(ref, element)
        }}
        className={cnState(buttonVariants({ variant, size }), className)}
        {...props}
      />
    </ControlTooltip>
  )
}

function PopoverContent({ className, onFocus, ...props }: ComponentProps<typeof PopoverContentPrimitive>) {
  const mount = use(PopoverMountContext)
  return (
    <PopoverContentPrimitive
      className={cnState(popoverContentClassName, className)}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        mount?.focused()
        onFocus?.(event)
      }}
      {...props}
    />
  )
}

function PopoverArrow({ className, ...props }: ComponentProps<typeof PopoverArrowPrimitive>) {
  return <PopoverArrowPrimitive className={cnState(arrowClassName, className)} {...props} />
}

function PopoverTitle({ className, ...props }: ComponentProps<typeof PopoverTitlePrimitive>) {
  return <PopoverTitlePrimitive className={cnState("text-sm leading-none font-semibold", className)} {...props} />
}

function PopoverDescription({ className, ...props }: ComponentProps<typeof PopoverDescriptionPrimitive>) {
  return <PopoverDescriptionPrimitive className={cnState("text-sm text-muted-foreground", className)} {...props} />
}

function PopoverClose({
  className,
  variant = "outline",
  size = "sm",
  tooltip,
  ...props
}: Omit<ComponentProps<typeof PopoverClosePrimitive>, "aria-label"> & ButtonLookProps) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={size === "icon"}>
      <PopoverClosePrimitive className={cnState(buttonVariants({ variant, size }), className)} {...props} />
    </ControlTooltip>
  )
}

export {
  Popover,
  PopoverArrow,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  createPopoverController,
  floatingSurfaceClassName,
}
export type { PopoverProps }
