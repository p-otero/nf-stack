"use client"

import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator as SegmentedControlIndicatorPrimitive,
  SegmentedControlItem as SegmentedControlItemPrimitive,
  createSegmentedControlController,
  type SegmentedControlController,
} from "@ui-sdk/react/segmented-control"
import { createContext, use, useState, type ComponentProps, type PointerEvent } from "react"

import { cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

// Set only while activateOnPress is on: the controller an item checks through on pointerdown.
const SegmentedControlPressContext = createContext<SegmentedControlController | null>(null)

type SegmentedControlProps<T extends string = string> = ComponentProps<typeof SegmentedControlPrimitive<T>> & {
  /**
   * Checks an item as soon as a mouse or pen presses it, before release, like a macOS segmented control. Touch
   * still checks on release, so scrolling past the control doesn't change it. Keyboard and agents are unchanged.
   * Off by default.
   */
  activateOnPress?: boolean
}

function SegmentedControl<T extends string = string>({
  className,
  activateOnPress = false,
  controller,
  ...props
}: SegmentedControlProps<T>) {
  const [ownController] = useState(() => createSegmentedControlController<T>())
  const active = controller ?? ownController
  // UI SDK types an item's `value` as a string, so the items below check through a controller of strings; each of
  // them passes its own value, one of this control's `T`.
  const pressController = activateOnPress ? assumeType<SegmentedControlController>(active) : null
  return (
    <SegmentedControlPressContext value={pressController}>
      <SegmentedControlPrimitive<T>
        controller={active}
        className={cnState(
          "relative isolate inline-flex w-fit rounded-control border bg-muted/(--glass-opacity) p-control-inset data-disabled:opacity-50 data-[orientation=horizontal]:h-control data-[orientation=vertical]:flex-col",
          className,
        )}
        {...props}
      />
    </SegmentedControlPressContext>
  )
}

// The indicator is the checked state, so it takes the primary fill: muted against background is far below 3:1.
function SegmentedControlIndicator({ className, ...props }: ComponentProps<typeof SegmentedControlIndicatorPrimitive>) {
  return (
    <SegmentedControlIndicatorPrimitive
      className={cnState(
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- transitions only the properties that move; transition-all also eased every colour and shadow change
        "absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-control bg-primary shadow-sm transition-[top,left,width,height] duration-panel ease-standard motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  )
}

function SegmentedControlItem({
  className,
  onPointerDown,
  ...props
}: ComponentProps<typeof SegmentedControlItemPrimitive>) {
  const pressController = use(SegmentedControlPressContext)
  // Checking on press is allowed by WCAG 2.5.2 (Pointer Cancellation) because it's reversible: pressing another
  // item undoes it. It goes through the controller, so onValueChange, cancel(), disabled and read-only still apply.
  const checkOnPress = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event)
    if (!pressController || event.defaultPrevented || event.button !== 0 || event.pointerType === "touch") return
    pressController.setValue(props.value, { reason: "item-press", event: event.nativeEvent })
  }
  return (
    <SegmentedControlItemPrimitive
      onPointerDown={checkOnPress}
      className={cnState(
        "touch-target inline-flex cursor-pointer items-center justify-center gap-inline rounded-control px-control-x text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring in-data-[orientation=vertical]:h-control-sm data-checked:text-primary-foreground data-checked:hover:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:hover:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem, createSegmentedControlController }
export type { SegmentedControlProps }
export type { SegmentedControlController, SegmentedControlItemState } from "@ui-sdk/react/segmented-control"
