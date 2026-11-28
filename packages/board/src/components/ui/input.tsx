"use client"

import {
  Input as InputPrimitive,
  InputClear as InputClearPrimitive,
  InputGroup as InputGroupPrimitive,
} from "@ui-sdk/react/input"
import {
  PasswordInput as PasswordInputPrimitive,
  PasswordInputControl as PasswordInputControlPrimitive,
  PasswordInputToggle as PasswordInputTogglePrimitive,
  type PasswordInputController,
} from "@ui-sdk/react/password-input"
import type { ComponentProps } from "react"
import { EyeIcon, EyeOffIcon, XIcon } from "lucide-react"

import { fieldSurfaceClassName, floatingLabelControls, useFloatingPlaceholder } from "@/components/ui/field"
import { ControlTooltip, type ControlTooltipOption } from "@/components/ui/tooltip"
import { cnState } from "@/lib/utils"

type InputProps = ComponentProps<typeof InputPrimitive> & {
  /**
   * A secret, like an API key: an uncontrolled password field (UI SDK's PasswordInput, which agents always read as
   * redacted) whose value never reaches a DOM attribute. It takes no `value` or `defaultValue`. Read it through
   * `sensitiveController` or the `ref`, or bind it with `FormField`, which reads it on submit and clears it after.
   * `autoComplete` is `new-password` by default, so browsers never fill a saved sign-in password into it.
   */
  sensitive?: boolean
  /** With `sensitive`: a toggle that shows and hides the value; it hides again on submit and when the page is hidden. */
  revealable?: boolean
  /** Names the toggle; "Show" by default. */
  revealLabel?: string
  /** With `sensitive`: reads, clears and focuses the field from anywhere; `createPasswordInputController()`. */
  sensitiveController?: PasswordInputController
}

const passwordManagerOptOut = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
}

const sensitiveRootClassName = `${fieldSurfaceClassName} flex h-field-control w-full min-w-0 items-center gap-inline rounded-control ps-control-x text-entry has-aria-invalid:border-destructive has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring`

type AttributeValue = string | number | boolean | undefined

type PassThrough = Record<`data-${string}` | `aria-${string}`, AttributeValue>

const isPassThroughKey = (key: string): key is keyof PassThrough => key.startsWith("data-") || key.startsWith("aria-")

const isAttributeValue = (value: unknown): value is AttributeValue =>
  value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean"

const noManagedAttributes: ReadonlySet<string> = new Set()

/** The `data-*` and `aria-*` props, without the ones in `managed`, which the receiving element sets itself. */
function namingAndMarkingAttributesOf(props: object, managed = noManagedAttributes): PassThrough {
  const attributes: PassThrough = {}
  for (const [key, value] of Object.entries(props)) {
    if (isPassThroughKey(key) && isAttributeValue(value) && !managed.has(key)) attributes[key] = value
  }
  return attributes
}

function SensitiveInput({
  className,
  style,
  revealable = false,
  revealLabel = "Show",
  sensitiveController,
  autoComplete = "new-password",
  value,
  defaultValue,
  name,
  form,
  id,
  required,
  disabled,
  readOnly,
  placeholder,
  tabIndex,
  maxLength,
  minLength,
  pattern,
  inputMode,
  onValueChange,
  onBlur,
  onFocus,
  onClick,
  onPointerDown,
  onPointerUp,
  onMouseEnter,
  onMouseLeave,
  ref,
  ...rest
}: InputProps) {
  if (value !== undefined || defaultValue !== undefined) {
    throw new Error("A sensitive Input is uncontrolled: drop value and defaultValue, and read it on submit.")
  }
  return (
    <PasswordInputPrimitive
      data-agent-secret=""
      controller={sensitiveController}
      autoComplete={autoComplete}
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      onValueChange={onValueChange}
      style={style}
      className={cnState(
        `${sensitiveRootClassName} ${revealable ? "pe-inline" : "pe-control-x"}`,
        typeof className === "string" ? className : undefined,
      )}
    >
      <PasswordInputControlPrimitive
        {...namingAndMarkingAttributesOf(rest)}
        ref={ref}
        id={id}
        placeholder={useFloatingPlaceholder(placeholder)}
        tabIndex={tabIndex}
        maxLength={maxLength}
        minLength={minLength}
        pattern={pattern}
        inputMode={inputMode}
        onBlur={onBlur}
        onFocus={onFocus}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...passwordManagerOptOut}
        className="h-full w-full min-w-0 bg-transparent font-mono outline-none placeholder:font-sans placeholder:text-muted-foreground data-disabled:cursor-not-allowed"
      />
      {revealable ? (
        <ControlTooltip label={revealLabel}>
          <PasswordInputTogglePrimitive
            aria-label={revealLabel}
            className="touch-target inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:cursor-not-allowed data-disabled:hover:bg-transparent [&_svg]:size-4"
          >
            {(state) => (state.visible ? <EyeOffIcon /> : <EyeIcon />)}
          </PasswordInputTogglePrimitive>
        </ControlTooltip>
      ) : null}
    </PasswordInputPrimitive>
  )
}

function Input({ className, sensitive = false, revealable, revealLabel, sensitiveController, ...props }: InputProps) {
  if (sensitive) {
    return (
      <SensitiveInput
        className={className}
        revealable={revealable}
        revealLabel={revealLabel}
        sensitiveController={sensitiveController}
        {...props}
      />
    )
  }
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

export { fieldSurfaceClassName, Input, InputClear, InputGroup, namingAndMarkingAttributesOf }
export type { InputProps }
