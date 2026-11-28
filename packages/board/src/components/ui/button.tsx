"use client"

import { Button as ButtonPrimitive, type ButtonState } from "@ui-sdk/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Children, isValidElement, useRef, type ComponentProps, type ReactNode } from "react"

import { ShortcutHint, useAriaKeyshortcuts, useShortcut } from "@/components/ui/shortcuts"
import { Spinner } from "@/components/ui/spinner"
import { ControlTooltip, type ControlTooltipOption } from "@/components/ui/tooltip"
import { cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

const buttonVariants = cva(
  "touch-target inline-flex shrink-0 not-data-pending:[&>[data-show=pending]]:hidden cursor-pointer items-center justify-center gap-inline rounded-control text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:not-data-pending:cursor-not-allowed data-disabled:not-data-pending:opacity-50 active:not-data-disabled:translate-y-px data-pending:relative data-pending:cursor-progress data-pending:[&>[data-slot=spinner]+*]:hidden data-pending:has-[>[data-slot=spinner][data-overlay]]:text-transparent! [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-secondary/(--control-glass-opacity) text-secondary-foreground glass-control glass-control-edge hover:bg-secondary/80",
        outline:
          "border border-control-edge bg-background/(--glass-opacity) glass-control hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground hover:glass-control",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-control-sm px-control-x",
        default: "h-control px-control-x",
        lg: "h-control-lg px-control-x text-base",
        icon: "size-control",
      },
      wrap: {
        true: "h-auto shrink whitespace-normal py-inset-chip text-center",
        false: "",
      },
    },
    compoundVariants: [
      { wrap: true, size: "sm", class: "min-h-control-sm" },
      { wrap: true, size: "default", class: "min-h-control" },
      { wrap: true, size: "lg", class: "min-h-control-lg" },
    ],
    defaultVariants: { variant: "default", size: "default", wrap: false },
  },
)

type ButtonVariants = VariantProps<typeof buttonVariants>

type ButtonBaseProps = Omit<ComponentProps<typeof ButtonPrimitive>, "aria-label"> & {
  variant?: ButtonVariants["variant"]
  /** Shows a spinner, sets `aria-busy` and ignores presses while keeping focus, for work this button didn't start. */
  loading?: boolean
  /** Lets a text button shrink and wrap its label onto more lines in a tight row, instead of overflowing it. */
  wrap?: boolean
  /**
   * A key that presses the button while it is mounted, in the enclosing `ShortcutScope`: `"u"`, `"mod+s"`, `"g i"`.
   * Shows the keys after the label and sets `aria-keyshortcuts`. People only: agents press the button by name.
   */
  shortcut?: string
  /** What `ShortcutsDialog` lists the shortcut as; defaults to the `aria-label` or a plain-text label. */
  shortcutDescription?: string
  /** `false` binds the key without showing it. */
  shortcutHint?: boolean
  /** Checked on every key press: `false` leaves the key to the page, like Cmd/Ctrl+Z to a focused text field. */
  shortcutWhen?: () => boolean
  /**
   * An icon button shows its `aria-label`, and its shortcut, in a tooltip on hover and keyboard focus. `false` turns
   * it off when a visible label sits beside the button; a string or `{ content, side, align }` replaces or places it,
   * on any button.
   */
  tooltip?: ControlTooltipOption
}

/**
 * The look of a button-like trigger (`DialogTrigger`, `DrawerClose`…): an icon size needs an `aria-label`, which its
 * tooltip shows.
 */
type ButtonLookProps =
  | {
      variant?: ButtonVariants["variant"]
      size?: Exclude<ButtonVariants["size"], "icon">
      "aria-label"?: string
      tooltip?: ControlTooltipOption
    }
  | { variant?: ButtonVariants["variant"]; size: "icon"; "aria-label": string; tooltip?: ControlTooltipOption }

type ButtonProps =
  | (ButtonBaseProps & { size?: Exclude<ButtonVariants["size"], "icon">; "aria-label"?: string })
  | (ButtonBaseProps & { size: "icon"; "aria-label": string })

const overlaySpinnerVariants = cva("absolute inset-0 m-auto", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive-foreground",
      link: "text-link",
    },
  },
  defaultVariants: { variant: "default" },
})

/** Renders the spinner only while `busy`; a caller that can't tell leaves it true and lets `data-pending` show it. */
function withSpinner(children: ReactNode, iconOnly: boolean, variant: ButtonVariants["variant"], busy = true) {
  const items = Children.toArray(children)
  const leadingIcon = isValidElement(items[0]) && (items.length > 1 || iconOnly)
  let spinner: ReactNode = null
  if (busy && leadingIcon) spinner = <Spinner data-show="pending" />
  else if (busy)
    spinner = <Spinner data-show="pending" data-overlay="" className={overlaySpinnerVariants({ variant })} />
  // Workaround: Chrome drops text in a wrapper from a busy button's name, so the text stays a direct child.
  return (
    <>
      {spinner}
      {children}
    </>
  )
}

function withHint(children: ReactNode, hint: ReactNode) {
  return [...Children.toArray(children), hint]
}

function Button({
  className,
  variant,
  size,
  loading,
  wrap,
  disabled,
  focusableWhenDisabled,
  shortcut,
  shortcutDescription,
  shortcutHint = true,
  shortcutWhen,
  tooltip,
  ref,
  children,
  ...props
}: ButtonProps) {
  const iconOnly = size === "icon"
  const tooltipShown = tooltip !== false && (iconOnly || tooltip !== undefined)
  const element = useRef<HTMLElement | null>(null)
  const description =
    shortcutDescription ?? props["aria-label"] ?? (typeof children === "string" ? children : undefined)
  useShortcut(shortcut, () => element.current?.click(), {
    description,
    when: () =>
      element.current?.isConnected === true && !element.current.closest("[inert]") && (shortcutWhen?.() ?? true),
  })
  const ariaKeyshortcuts = useAriaKeyshortcuts(shortcut)
  const hint =
    shortcut !== undefined && shortcutHint && !(iconOnly && tooltipShown) ? (
      <ShortcutHint key="shortcut-hint" keys={shortcut} className="ms-auto" />
    ) : null
  const content = (inner: ReactNode) => (hint ? withHint(inner, hint) : inner)
  const button = (
    <ButtonPrimitive
      ref={(node: HTMLElement | null) => {
        element.current = node
        // Workaround: UI SDK types the ref for a <button>, though `render` can make the button any element.
        if (typeof ref === "function") return ref(assumeType<HTMLButtonElement | null>(node))
        if (ref) (ref as { current: unknown }).current = node
        return undefined
      }}
      aria-keyshortcuts={ariaKeyshortcuts}
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      {...(loading ? { "data-pending": "", "aria-busy": true } : {})}
      disabled={disabled || loading}
      focusableWhenDisabled={focusableWhenDisabled || loading}
      className={cnState(buttonVariants({ variant, size, wrap: wrap && !iconOnly }), className)}
      {...props}
    >
      {(state: ButtonState) =>
        withSpinner(
          content(typeof children === "function" ? children(state) : children),
          iconOnly,
          variant,
          loading === true || state.pending,
        )
      }
    </ButtonPrimitive>
  )
  if (!tooltipShown) return button
  return (
    <ControlTooltip
      label={props["aria-label"]}
      tooltip={tooltip}
      iconOnly={iconOnly}
      shortcut={shortcutHint ? shortcut : undefined}
    >
      {button}
    </ControlTooltip>
  )
}

export { Button, buttonVariants, withSpinner as withPendingSpinner }
export type { ButtonLookProps, ButtonProps }
