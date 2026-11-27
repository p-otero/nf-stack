"use client"

import {
  Field as FieldPrimitive,
  FieldDescription as FieldDescriptionPrimitive,
  FieldError as FieldErrorPrimitive,
  FieldGroup as FieldGroupPrimitive,
  FieldLabel as FieldLabelPrimitive,
  FieldLegend as FieldLegendPrimitive,
  FieldSet as FieldSetPrimitive,
} from "@ui-sdk/react/field"
import { Children, createContext, isValidElement, useContext, type ComponentProps, type ReactNode } from "react"

import { cnState } from "@/lib/utils"

/** Where a Field's label sits: above the control, inside it (floating up once there's a value), or on its border. */
type FieldLabelPlacement = "top" | "in" | "on"

const FieldLabelPlacementContext = createContext<FieldLabelPlacement>("top")

/**
 * A default placement for the Fields inside, like a Form's `labelPlacement`. A Field that sets its own wins; one that
 * isn't in the floating layout (see `inFloatingLayout`) keeps its label on top.
 */
const FieldLabelPlacementDefault = createContext<FieldLabelPlacement | undefined>(undefined)

/** The label placement of the Field around a control; controls give `in` a blank placeholder to float on. */
function useFieldLabelPlacement() {
  return useContext(FieldLabelPlacementContext)
}

// Controls that can hold a floating label. FormField applies a Form's default placement only to these, so radio
// groups, sliders and switches keep their label on top. Each control's module adds itself.
const floatingLabelControls = new WeakSet<object>()

/** How a control takes its value: the prop names, and how the form's value maps to the control and back. */
type FormControlAdapter = {
  value: string
  change: string
  toControl?: (value: unknown) => unknown
  fromControl?: (value: unknown) => unknown
  /** Chains the field's `onBlur`, so a form that validates on blur sees the control lose focus. */
  blur?: boolean
}

// How FormField binds each control, by component. It lives here, not in form-field, so a control's module can add
// itself without pulling in react-hook-form; a control missing from it binds `value`/`onValueChange` as is.
const formControlAdapters = new Map<unknown, FormControlAdapter>()

/** A blank placeholder for an input in a `labelPlacement="in"` Field: the label floats on `:placeholder-shown`. */
function useFloatingPlaceholder(placeholder: string | undefined) {
  const placement = useFieldLabelPlacement()
  return placeholder ?? (placement === "in" ? " " : undefined)
}

const checkboxRowClassName =
  "has-[>[data-slot=checkbox]]:flex-row has-[>[data-slot=checkbox]]:items-start has-[>[data-slot=checkbox]]:gap-inline has-[>[data-slot=switch]]:flex-row has-[>[data-slot=switch]]:items-center has-[>[data-slot=switch]]:gap-inline pointer-coarse:has-[>[data-slot=checkbox]]:items-center pointer-coarse:has-[>[data-slot=checkbox],>[data-slot=switch]]:min-h-(--control-height-touch)"

const textControls =
  "[data-slot=input],[data-slot=native-select],[data-slot=select-value],[data-slot=number-input-control],[data-slot=date-picker-input],[data-slot=combobox-input],[data-slot=autocomplete-input],[data-slot=password-input-control],[data-slot=date-input],[data-slot=time-input]"

// Every control sizes from --field-control-height, so `in` makes the text controls taller and moves their text below
// the floated label. A placeholder would collide with the resting label, so it shows only while its control is focused.
const placementClassName: Record<FieldLabelPlacement, string> = {
  top: "[--field-control-height:var(--control-height)]",
  in: [
    "relative [--field-control-height:calc(var(--control-height)+var(--field-label-offset))]",
    "[--field-label-start:calc(var(--control-padding)+1px)] [--field-label-rest-y:calc((var(--field-control-height)-1lh)/2)]",
    "has-[>[data-slot=input-group]>svg:first-child]:[--field-label-start:calc(var(--control-padding)+1rem+var(--gap-inline)+1px)]",
    "has-[[data-slot=number-input-group]>[data-slot=number-input-decrement]:first-child]:[--field-label-start:calc(var(--control-height)+var(--gap-inline)+1px)]",
    "has-[>[data-slot=textarea]]:[--field-label-rest-y:calc(var(--field-label-offset)+var(--item-padding-y)+1px)]",
    `[&_:is(${textControls})]:pt-(--field-label-offset)`,
    "[&>[data-slot=textarea]]:pt-[calc(var(--field-label-offset)+var(--item-padding-y))]",
    "[&_:is(input,textarea):not(:focus,[data-slot=time-input-segment],[data-slot=date-input-segment])]:placeholder:text-transparent",
    "[&:not(:focus-within)_[data-slot=date-input-segment]]:placeholder:text-transparent",
    "[&_[data-slot=select-trigger]:not(:focus)_[data-placeholder]]:invisible",
    '[&_select:not(:focus):has(option[value=""]:checked)]:text-transparent',
  ].join(" "),
  on: [
    "relative pt-[calc(var(--type-caption-leading)/2)] [--field-control-height:var(--control-height)]",
    "[--field-label-start:calc(max(var(--control-padding),min(var(--control-radius),var(--control-height)/2))-var(--gap-inline))]",
  ].join(" "),
}

const labelPlacementClassName: Record<FieldLabelPlacement, string> = {
  top: "text-sm font-medium",
  in: [
    "pointer-events-none absolute start-(--field-label-start) top-0 z-10 max-w-[calc(100%-2*var(--field-label-start))] origin-top-left truncate text-body text-muted-foreground rtl:origin-top-right",
    "translate-y-(--field-label-rest-y) transition-[translate,scale,color] duration-micro ease-standard",
    "field-floated:translate-y-(--field-label-float-y) field-floated:scale-(--field-label-scale)",
    "[:focus-within>&:not([data-invalid])]:text-foreground data-invalid:text-destructive",
  ].join(" "),
  // A band of the surface's fill covers the border line and the 2px focus ring above it, so the label cuts the
  // line while a translucent (glass) surface still shows through around the text.
  on: [
    "absolute start-(--field-label-start) top-0 z-10 max-w-[calc(100%-2*var(--field-label-start))] truncate px-inline text-caption font-medium text-muted-foreground",
    "bg-[linear-gradient(to_bottom,transparent_calc(50%-3px),var(--field-label-surface)_calc(50%-3px),var(--field-label-surface)_calc(50%+2px),transparent_calc(50%+2px))]",
    "[:focus-within>&:not([data-invalid])]:text-foreground data-invalid:text-destructive",
  ].join(" "),
}

type FieldProps = ComponentProps<typeof FieldPrimitive> & {
  /**
   * `top` (default) above the control; `in` inside it, floating up on focus or a value; `on` on its border, over
   * `--field-label-surface`. For text controls (Input, Textarea, Select, NumberInput, DatePicker, Combobox…). Unset in a
   * Form, it takes the Form's only in the floating layout (`FieldLabel`, such a control, then only a description or
   * error, no padding of its own). Wins over the Form's, `top` included.
   */
  labelPlacement?: FieldLabelPlacement
}

const ownPadding = /^!?-?p[xytbse]?-(?!0$)/

/**
 * Whether a Field's own className pads it. The floating label is placed from the Field's box, so padding (which also
 * replaces the `on` layout's top padding) moves the control away from it and the label lands on the control's value.
 */
function padsItself(className: unknown) {
  if (typeof className !== "string") return false
  return className.split(/\s+/).some((token) => ownPadding.test(token.slice(token.lastIndexOf(":") + 1)))
}

const trailingParts = new Set<unknown>()

// The layout the floating styles assume: the label, the control right under it, and only a description or an error
// after them. Text, a wrapper or any other element between or after them changes where the control sits.
function inFloatingLayout(children: FieldProps["children"], className: unknown) {
  if (typeof children === "function" || padsItself(className)) return false
  const [label, control, ...rest] = Children.toArray(children)
  return (
    isValidElement(label) &&
    label.type === FieldLabel &&
    isValidElement(control) &&
    typeof control.type !== "string" &&
    floatingLabelControls.has(control.type) &&
    rest.every((part) => isValidElement(part) && trailingParts.has(part.type))
  )
}

function Field({ className, labelPlacement: ownPlacement, ...props }: FieldProps) {
  const inherited = useContext(FieldLabelPlacementDefault)
  const labelPlacement =
    ownPlacement ?? (inherited !== undefined && inFloatingLayout(props.children, className) ? inherited : "top")
  return (
    <FieldLabelPlacementContext value={labelPlacement}>
      <FieldPrimitive
        data-label-placement={labelPlacement}
        className={cnState(
          `flex flex-col gap-inline ${checkboxRowClassName} ${placementClassName[labelPlacement]}`,
          className,
        )}
        {...props}
      />
    </FieldLabelPlacementContext>
  )
}

function FieldLabel({ className, ...props }: ComponentProps<typeof FieldLabelPrimitive>) {
  const placement = useFieldLabelPlacement()
  return (
    <FieldLabelPrimitive
      className={cnState(`select-none data-disabled:opacity-50 ${labelPlacementClassName[placement]}`, className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: ComponentProps<typeof FieldDescriptionPrimitive>) {
  return <FieldDescriptionPrimitive className={cnState("text-sm text-muted-foreground", className)} {...props} />
}

function FieldError({ className, ...props }: ComponentProps<typeof FieldErrorPrimitive>) {
  return <FieldErrorPrimitive className={cnState("text-sm text-destructive", className)} {...props} />
}

trailingParts.add(FieldDescription).add(FieldError)

function FieldLegend({ className, ...props }: ComponentProps<typeof FieldLegendPrimitive>) {
  return (
    <FieldLegendPrimitive
      className={cnState("p-0 text-title-sm tracking-tight data-disabled:opacity-50", className)}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: ComponentProps<typeof FieldGroupPrimitive>) {
  return <FieldGroupPrimitive className={cnState("flex flex-col gap-group", className)} {...props} />
}

type FieldSetProps = Omit<ComponentProps<typeof FieldSetPrimitive>, "children"> & {
  /** Names the group, and the radio or checkbox group inside it. */
  legend?: ReactNode
  description?: ReactNode
  children?: ReactNode
}

/** A native fieldset: its legend names the group, and `disabled` disables every control inside. */
function FieldSet({ legend, description, className, children, ...props }: FieldSetProps) {
  return (
    <FieldSetPrimitive className={cnState("m-0 flex min-w-0 flex-col gap-group border-0 p-0", className)} {...props}>
      {legend === undefined ? null : <FieldLegend>{legend}</FieldLegend>}
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      {children}
    </FieldSetPrimitive>
  )
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLabelPlacementDefault,
  FieldLegend,
  FieldSet,
  floatingLabelControls,
  formControlAdapters,
  padsItself,
  useFieldLabelPlacement,
  useFloatingPlaceholder,
}
export type { FieldLabelPlacement, FieldProps, FieldSetProps, FormControlAdapter }
