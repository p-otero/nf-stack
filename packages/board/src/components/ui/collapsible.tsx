"use client"

import {
  Collapsible as CollapsiblePrimitive,
  CollapsiblePanel as CollapsiblePanelPrimitive,
  CollapsibleTrigger as CollapsibleTriggerPrimitive,
  createCollapsibleController,
} from "@ui-sdk/react/collapsible"
import type { ComponentProps } from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn, cnState } from "@/lib/utils"

function Collapsible({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive>) {
  return <CollapsiblePrimitive className={cnState("flex flex-col", className)} {...props} />
}

function CollapsibleTrigger({ className, ...props }: ComponentProps<typeof CollapsibleTriggerPrimitive>) {
  return (
    <CollapsibleTriggerPrimitive
      className={cnState(
        "group/collapsible-trigger inline-flex min-h-control cursor-pointer items-center justify-between gap-inline rounded-control px-control-x text-start text-sm font-medium transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

function CollapsibleIcon({ className, ...props }: ComponentProps<typeof ChevronDownIcon>) {
  return (
    <ChevronDownIcon
      data-slot="collapsible-icon"
      className={cn("transition-transform group-data-open/collapsible-trigger:rotate-180", className)}
      {...props}
    />
  )
}

function CollapsiblePanel({ className, ...props }: ComponentProps<typeof CollapsiblePanelPrimitive>) {
  return (
    <CollapsiblePanelPrimitive
      className={cnState(
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- transitions only the properties that move; transition-all also eased every colour and shadow change
        "h-(--collapsible-panel-height) transition-[height] duration-panel ease-standard data-ending-style:h-0 data-ending-style:overflow-hidden data-starting-style:h-0 data-starting-style:overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleIcon, CollapsiblePanel, CollapsibleTrigger, createCollapsibleController }
