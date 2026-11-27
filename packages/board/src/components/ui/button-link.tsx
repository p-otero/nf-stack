import type { VariantProps } from "class-variance-authority"

import { buttonVariants } from "@/components/ui/button"
import { Link, type LinkProps } from "@/components/ui/link"
import { cn } from "@/lib/utils"

type ButtonVariantProps = VariantProps<typeof buttonVariants>

type ButtonLinkProps = Omit<LinkProps, "variant"> & {
  /** The Button look: a call to action that navigates is still a link. */
  variant?: ButtonVariantProps["variant"]
  /** `icon` needs an `aria-label`. */
  size?: Exclude<ButtonVariantProps["size"], null>
}

/** A link that looks like a Button, for calls to action that go somewhere instead of doing something. */
function ButtonLink({ variant = "default", size = "default", className, ...props }: ButtonLinkProps) {
  return (
    <Link
      data-look={variant}
      variant="plain"
      // oxlint-disable-next-line shadcn/require-static-classes -- the Button's own variants, on a link
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { ButtonLink }
export type { ButtonLinkProps }
