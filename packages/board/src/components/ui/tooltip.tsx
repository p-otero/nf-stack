"use client"

import {
  Tooltip,
  TooltipArrow as TooltipArrowPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipShortcut as TooltipShortcutPrimitive,
  TooltipTrigger,
  createTooltipController,
  type TooltipContentProps,
  type TooltipOpenChangeReason,
} from "@ui-sdk/react/tooltip"
import type { ComponentProps, ReactElement, ReactNode } from "react"

import { cnState } from "@/lib/utils"

const tooltipContentClassName =
  "z-popover m-0 max-w-xs overflow-visible rounded-control border-0 bg-primary px-inset-item py-inline text-xs text-balance text-primary-foreground shadow-floating origin-(--transform-origin) transition duration-micro ease-standard data-instant:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100"

const arrowClassName =
  // oxlint-disable-next-line p-otero/spacing-tokens -- half the arrow's size-2.5 (rounded down), so it sits just inside the bubble's edge
  "absolute size-2.5 rotate-45 data-[side=bottom]:-top-1 data-[side=bottom]:left-(--arrow-offset) data-[side=bottom]:-translate-x-1/2 data-[side=top]:-bottom-1 data-[side=top]:left-(--arrow-offset) data-[side=top]:-translate-x-1/2 data-[side=left]:-right-1 data-[side=left]:top-(--arrow-offset) data-[side=left]:-translate-y-1/2 data-[side=right]:-left-1 data-[side=right]:top-(--arrow-offset) data-[side=right]:-translate-y-1/2"

function TooltipContent({ className, ...props }: ComponentProps<typeof TooltipContentPrimitive>) {
  return <TooltipContentPrimitive className={cnState(tooltipContentClassName, className)} {...props} />
}

function TooltipArrow({ className, ...props }: ComponentProps<typeof TooltipArrowPrimitive>) {
  return <TooltipArrowPrimitive className={cnState(`${arrowClassName} bg-primary`, className)} {...props} />
}

function TooltipShortcut({ className, ...props }: ComponentProps<typeof TooltipShortcutPrimitive>) {
  return (
    <TooltipShortcutPrimitive
      className={cnState("ms-items font-mono text-xs text-primary-foreground/80", className)}
      {...props}
    />
  )
}

/**
 * A control's tooltip: `false` turns it off, a string or `content` replaces the text (which then describes the
 * control instead of repeating its name), `side` and `align` place it.
 */
type ControlTooltipOption =
  | boolean
  | string
  | { content?: ReactNode; side?: TooltipContentProps["side"]; align?: TooltipContentProps["align"] }

type ControlTooltipProps = {
  /** The control's accessible name. The tooltip repeats it unless `tooltip` gives other text. */
  label?: string
  tooltip?: ControlTooltipOption
  /** Shows `label` without being asked to, for a control with no visible text. */
  iconOnly?: boolean
  /** Keys shown after the text, like `"mod+s"`. */
  shortcut?: string
  /**
   * Lists the tooltip in the agent snapshot under the control's name, so an agent can press a control that isn't a
   * component of its own, like a collapsible's trigger. Otherwise it stays out, since it repeats the control's name.
   */
  agentPressable?: boolean
  /**
   * The control, rendered as the tooltip's trigger: it receives the trigger's props and ref. A natively `disabled`
   * one can't be focused, so it gets no tooltip; `focusableWhenDisabled` keeps it. One that is already labelled or
   * described by something else, like the `TooltipTrigger` it renders for, keeps that, and an `aria-hidden` one
   * gets none.
   */
  children: ReactElement<TriggerProps>
}

type TriggerProps = {
  disabled?: boolean
  focusableWhenDisabled?: boolean
  "aria-describedby"?: string
  "aria-labelledby"?: string
  "aria-hidden"?: boolean | "true" | "false"
}

function skipsTooltip({ disabled, focusableWhenDisabled, ...props }: TriggerProps) {
  const wired = props["aria-describedby"] !== undefined || props["aria-labelledby"] !== undefined
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true"
  return wired || hidden || (disabled === true && focusableWhenDisabled !== true)
}

function ignoreTouch(open: boolean, details: { reason: TooltipOpenChangeReason; event?: Event; cancel: () => void }) {
  const event = details.event
  if (open && typeof PointerEvent !== "undefined" && event instanceof PointerEvent && event.pointerType === "touch") {
    details.cancel()
  }
}

function tooltipText(label: string | undefined, tooltip: ControlTooltipOption | undefined, iconOnly: boolean) {
  if (tooltip === false) return undefined
  if (typeof tooltip === "string") return tooltip
  if (typeof tooltip === "object" && tooltip.content !== undefined) return tooltip.content
  return iconOnly || tooltip === true ? label : undefined
}

/**
 * Shows a control's name, or `tooltip` text, on hover and keyboard focus. The tooltip that repeats the name labels
 * the control, so a screen reader hears it once; other text describes it. Agents see the control, not the tooltip.
 */
function ControlTooltip({
  label,
  tooltip,
  iconOnly = true,
  shortcut,
  agentPressable = false,
  children,
}: ControlTooltipProps) {
  const text = tooltipText(label, tooltip, iconOnly)
  if (skipsTooltip(children.props) || text === undefined || text === null || text === "") return children
  const placement = typeof tooltip === "object" ? tooltip : undefined
  return (
    <Tooltip type={text === label ? "label" : "description"} onOpenChange={ignoreTouch}>
      <TooltipTrigger render={children} />
      <TooltipContent
        data-agent-hidden={agentPressable ? undefined : ""}
        side={placement?.side}
        align={placement?.align}
        render={<span />}
      >
        {text}
        {shortcut === undefined ? null : <TooltipShortcut shortcut={shortcut} />}
      </TooltipContent>
    </Tooltip>
  )
}

export {
  ControlTooltip,
  createTooltipController,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
}
export type { ControlTooltipOption, ControlTooltipProps }
