"use client"

import { mergeProps, renderElement, usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive"
import { cva } from "class-variance-authority"
import type { AriaAttributes, MouseEvent, ReactNode } from "react"
import { ArrowUpRightIcon } from "lucide-react"

import { useFastLink } from "@/components/ui/fast-link"
import { isPlainClick, link, type LinkOptions } from "@/components/ui/link-primitive"
import { useLinkIntent } from "@/components/ui/use-link-intent"
import { cn } from "@/lib/utils"

type LinkVariant = "inline" | "nav" | "muted" | "standalone" | "plain"

const focusRing =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

const linkVariants = cva("", {
  variants: {
    variant: {
      inline: "text-link underline decoration-1 underline-offset-2 hover:decoration-2",
      nav: "text-muted-foreground underline-offset-4 transition-colors duration-micro ease-standard hover:text-foreground hover:underline aria-[current]:font-medium aria-[current]:text-foreground",
      muted:
        "text-muted-foreground underline-offset-2 transition-colors duration-micro ease-standard hover:text-foreground hover:underline",
      standalone:
        "touch-target inline-flex items-center gap-inline font-medium text-link underline-offset-4 hover:underline [&_svg]:size-4 [&_svg]:shrink-0",
      plain: "",
    },
  },
  compoundVariants: [{ variant: ["inline", "nav", "muted", "standalone"], class: focusRing }],
  defaultVariants: { variant: "inline" },
})

type LinkProps = Omit<PartProps<"a">, "children"> & {
  children?: ReactNode
  /** `inline` is underlined at rest, `nav` and `muted` on hover; `plain` adds no look, not even the focus ring. */
  variant?: LinkVariant
  /** Adds a trailing icon and `rel="noopener noreferrer"`; opens in the same tab unless `newTab`. */
  external?: boolean
  /** `target="_blank"`, announced to screen readers with `newTabLabel`. */
  newTab?: boolean
  newTabLabel?: string
  /** `true` is `aria-current="page"`; a string is another `aria-current` token. */
  current?: boolean | Exclude<AriaAttributes["aria-current"], boolean | "true" | "false">
  /** Takes over a plain click (modified clicks stay native) and gives agents a `follow` action; without it agents don't see the link. */
  onFollow?: LinkOptions["onFollow"]
  /**
   * Client-side routing without an agent action: a primary mouse press, a plain click or Enter call it; modified
   * clicks stay native. `onFollow` wins over it.
   */
  onNavigate?: (href: string, event: Event) => void
  /** Fires on a 65 ms hover, focus, or a mouse or pen press, to preload; it can fire more than once per visit. */
  onIntent?: (href: string) => void
  /**
   * Follows a same-origin link on mouse press, for navigation only (WCAG 2.5.2: a press can't be cancelled). Off for
   * `external`, and without `onFollow` also with `render` or `onClick`; `data-no-fast-link` on an ancestor turns a
   * region off. @defaultValue true
   */
  fast?: boolean
}

function linkProps({
  variant = "inline",
  external = false,
  newTab = false,
  newTabLabel = "(opens in a new tab)",
  current,
  className,
  children,
  rel,
  target,
  ...props
}: Omit<LinkProps, "onFollow" | "onNavigate" | "onIntent" | "render" | "fast"> & { onNavigate?: undefined }) {
  return {
    "data-slot": "link",
    "data-variant": variant,
    "data-external": external ? "" : undefined,
    "aria-current": current === true ? ("page" as const) : current || undefined,
    rel: external ? ["noopener noreferrer", rel].filter(Boolean).join(" ") : rel,
    target: newTab ? "_blank" : target,
    className: cn(linkVariants({ variant }), className),
    children: (
      <>
        {children}
        {external && (
          <ArrowUpRightIcon
            data-slot="link-external-icon"
            className="ms-px inline-block size-3 shrink-0 align-baseline rtl:-scale-x-100"
          />
        )}
        {newTab && <span className="sr-only"> {newTabLabel}</span>}
      </>
    ),
    ...props,
  }
}

function FollowLink({ onFollow, onIntent, render, fast = true, ...props }: LinkProps) {
  const handle = usePrimitive(link, { href: props.href, onFollow })
  const ref = useFastLink<HTMLAnchorElement>({
    enabled: fast && !props.external,
    onFollow: (_href, { event }) => handle.api.follow(event),
  })
  const intent = useLinkIntent(props.href, onIntent)
  return usePart(
    handle,
    "root",
    {},
    { ...mergeProps(linkProps({ ...props, onNavigate: undefined }), { ref }, intent), render },
    "a",
  )
}

function PlainLink({ render, fast = true, onNavigate, onIntent, ...props }: Omit<LinkProps, "onFollow">) {
  const clickMayRouteOrCancel = Boolean(render) || (onNavigate === undefined && Boolean(props.onClick))
  const ref = useFastLink<HTMLAnchorElement>({
    enabled: fast && !props.external && !clickMayRouteOrCancel,
    onFollow: onNavigate ? (href, { event }) => onNavigate(href, event) : undefined,
  })
  const intent = useLinkIntent(props.href, onIntent)
  const route = onNavigate && {
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      const href = event.currentTarget.getAttribute("href")
      if (event.defaultPrevented || !isPlainClick(event.nativeEvent) || href === null) return
      event.preventDefault()
      onNavigate(href, event.nativeEvent)
    },
  }
  return renderElement("a", mergeProps(linkProps(props), { ref }, intent, route ?? {}), render)
}

function Link({ onFollow, ...props }: LinkProps) {
  if (onFollow) return <FollowLink onFollow={onFollow} {...props} />
  return <PlainLink {...props} />
}

export { Link, linkVariants }
export type { LinkProps, LinkVariant }
