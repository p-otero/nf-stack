"use client"

import { useFieldControl } from "@ui-sdk/react/field"
import { ToggleGroup as ToggleGroupPrimitive, createToggleGroupController } from "@ui-sdk/react/toggle"
import type { ComponentProps } from "react"

import { cnState } from "@/lib/utils"
import { Toggle, ToggleIcon, toggleVariants } from "@/components/ui/toggle"

// UI SDK's ToggleGroup doesn't join a Field on its own, so it does through the field's public custom-control hook.
function ToggleGroup<T extends string = string>({
  className,
  disabled,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive<T>>) {
  const field = useFieldControl()
  const own = {
    ...props,
    "data-slot": "toggle-group",
    disabled: disabled ?? field?.disabled,
    className: cnState(
      "inline-flex w-fit items-center gap-inline rounded-control data-disabled:opacity-50 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
      className,
    ),
  }
  return <ToggleGroupPrimitive<T> {...(field ? { ...own, ...field.props(own) } : own)} />
}

export { createToggleGroupController, ToggleGroup }
export { Toggle, ToggleIcon, toggleVariants }
export type { ToggleGroupController, ToggleGroupState, ToggleGroupValueChangeReason } from "@ui-sdk/react/toggle"
