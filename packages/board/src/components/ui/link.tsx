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

// `plain` adds nothing, not even the focus ring, so a row or card styled through className keeps its own.
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
  /**
   * `inline` sits in running text (underlined at rest), `nav` and `muted` list links (underlined on hover),
   * `standalone` is a call to action on its own line, `plain` leaves the look to `className` (a card, a row).
   */
  variant?: LinkVariant
  /** Another site: a trailing icon and `rel="noopener noreferrer"`. Opens in the same tab unless `newTab`. */
  external?: boolean
  /** Opens in a new tab (`target="_blank"`) and says so to screen readers with `newTabLabel`. */
  newTab?: boolean
  newTabLabel?: string
  /** Marks the link to the current page (`aria-current="page"`), or pass another `aria-current` token. */
  current?: boolean | Exclude<AriaAttributes["aria-current"], boolean | "true" | "false">
  /**
   * Takes over a plain click (modified clicks keep the browser's behaviour), for client-side routing. It also
   * offers agents a `follow` action that calls it; links without it are invisible to agents.
   */
  onFollow?: LinkOptions["onFollow"]
  /**
   * Routes on the client, for a router's links that agents don't need as actions of their own (a sidebar, a pager):
   * a primary mouse press follows at once, like a fast link, and a plain click or Enter follows too, without a page
   * load. Modified clicks keep the browser's behaviour. With `onFollow` too, `onFollow` wins.
   */
  onNavigate?: (href: string, event: Event) => void
  /**
   * Runs when someone is about to follow the link (a 65 ms hover, focus, a mouse or pen press), to preload the
   * route. It can run more than once for one visit; keep it idempotent.
   */
  onIntent?: (href: string) => void
  /**
   * Follows a same-origin link on mouse press, not release (default `true`): navigation only, as moving away can't
   * cancel it (WCAG 2.5.2). Without `onFollow` it uses `location.assign`, so it is off with `render` or `onClick`,
   * which act on the click. Off for `external`; `data-no-fast-link` on an ancestor turns a region off.
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

// Without `onFollow` or `onNavigate`, a router element or an `onClick` may route or cancel on the click, so a press
// must not navigate first.
function PlainLink({ render, fast = true, onNavigate, onIntent, ...props }: Omit<LinkProps, "onFollow">) {
  const ref = useFastLink<HTMLAnchorElement>({
    enabled: fast && !props.external && !render && (onNavigate !== undefined || !props.onClick),
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
