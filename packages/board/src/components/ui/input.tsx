"use client"

import {
  Input as InputPrimitive,
  InputClear as InputClearPrimitive,
  InputGroup as InputGroupPrimitive,
} from "@ui-sdk/react/input"
import type { ComponentProps } from "react"
import { XIcon } from "lucide-react"

import { floatingLabelControls } from "@/components/ui/field"
import { ControlTooltip, type ControlTooltipOption } from "@/components/ui/tooltip"
import { cnState } from "@/lib/utils"

const fieldSurfaceClassName =
  "border border-input bg-field/(--glass-opacity) shadow-xs transition-colors hover:border-input-strong/50 aria-invalid:border-destructive data-disabled:cursor-not-allowed data-disabled:opacity-50"

function Input({ className, ...props }: ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      className={cnState(
        `${fieldSurfaceClassName} h-field-control w-full rounded-control min-w-0 px-control-x text-entry outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring in-data-[slot=input-group]:h-auto in-data-[slot=input-group]:border-0 in-data-[slot=input-group]:bg-transparent in-data-[slot=input-group]:px-0 in-data-[slot=input-group]:shadow-none in-data-[slot=input-group]:focus-visible:ring-0`,
        className,
      )}
      {...props}
    />
  )
}

function InputGroup({ className, ...props }: ComponentProps<typeof InputGroupPrimitive>) {
  return (
    <InputGroupPrimitive
      className={cnState(
        `${fieldSurfaceClassName} flex h-field-control rounded-control w-full items-center gap-inline px-control-x text-entry has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-aria-invalid:border-destructive [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground`,
        className,
      )}
      {...props}
    />
  )
}

function InputClear({
  className,
  children,
  "aria-label": ariaLabel = "Clear",
  tooltip,
  ...props
}: ComponentProps<typeof InputClearPrimitive> & { tooltip?: ControlTooltipOption }) {
  return (
    <ControlTooltip label={ariaLabel} tooltip={tooltip} iconOnly={children === undefined}>
      <InputClearPrimitive
        aria-label={ariaLabel}
        className={cnState(
          // oxlint-disable-next-line p-otero/spacing-tokens -- pulls the icon button into the padding so its glyph lines up with the text inset
          "-me-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      >
        {children ?? <XIcon className="size-4" />}
      </InputClearPrimitive>
    </ControlTooltip>
  )
}

floatingLabelControls.add(Input).add(InputGroup)

export { fieldSurfaceClassName, Input, InputClear, InputGroup }
