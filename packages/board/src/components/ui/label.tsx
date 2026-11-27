"use client"

import { Label as LabelPrimitive } from "@ui-sdk/react/label"
import type { ComponentProps } from "react"

import { cnState } from "@/lib/utils"

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive>) {
  return (
    <LabelPrimitive
      className={cnState(
        "inline-flex items-center gap-inline text-sm font-medium select-none pointer-coarse:has-[[data-slot=checkbox],[data-slot=radio],[data-slot=switch]]:min-h-(--control-height-touch) has-data-disabled:cursor-not-allowed has-data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
