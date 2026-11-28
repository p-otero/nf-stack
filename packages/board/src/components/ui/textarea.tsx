"use client"

import { Textarea as TextareaPrimitive, createInputController } from "@ui-sdk/react/textarea"
import type { ComponentProps } from "react"

import { fieldSurfaceClassName, floatingLabelControls } from "@/components/ui/field"
import { cnState } from "@/lib/utils"

function Textarea({ className, ...props }: ComponentProps<typeof TextareaPrimitive>) {
  return (
    <TextareaPrimitive
      className={cnState(
        `${fieldSurfaceClassName} min-h-20 w-full min-w-0 rounded-choice px-control-x py-inset-item text-entry outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring`,
        className,
      )}
      {...props}
    />
  )
}

floatingLabelControls.add(Textarea)

export { Textarea, createInputController }
export type { InputController, TextareaState } from "@ui-sdk/react/textarea"
