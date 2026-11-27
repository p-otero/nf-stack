"use client"

import {
  Checkbox as CheckboxPrimitive,
  CheckboxGroup as CheckboxGroupPrimitive,
  CheckboxIndicator as CheckboxIndicatorPrimitive,
  createCheckboxController,
  createCheckboxGroupController,
} from "@ui-sdk/react/checkbox"
import type { ComponentProps } from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cnState } from "@/lib/utils"

// Not rounded-control: in the default theme it turns the box into a circle that reads as a radio.
function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive>) {
  return (
    <CheckboxPrimitive
      className={cnState(
        // oxlint-disable-next-line p-otero/spacing-tokens -- aligns the size-4 box with the label's first 20px line
        "touch-target inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-choice border border-input-strong bg-background/(--glass-opacity) text-primary-foreground shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 data-indeterminate:border-primary data-indeterminate:bg-primary in-data-[slot=field]:mt-0.5",
        className,
      )}
      {...props}
    />
  )
}

function CheckboxIndicator({ className, children, ...props }: ComponentProps<typeof CheckboxIndicatorPrimitive>) {
  return (
    <CheckboxIndicatorPrimitive
      className={cnState("inline-flex items-center justify-center [&_svg]:size-3.5", className)}
      {...props}
    >
      {children ?? ((state) => (state.indeterminate ? <MinusIcon strokeWidth={3} /> : <CheckIcon strokeWidth={3} />))}
    </CheckboxIndicatorPrimitive>
  )
}

function CheckboxGroup({ className, ...props }: ComponentProps<typeof CheckboxGroupPrimitive>) {
  return <CheckboxGroupPrimitive className={cnState("flex flex-col gap-items", className)} {...props} />
}

export { Checkbox, CheckboxGroup, CheckboxIndicator, createCheckboxController, createCheckboxGroupController }
export type { CheckboxController, CheckboxState, CheckedState } from "@ui-sdk/react/checkbox"
