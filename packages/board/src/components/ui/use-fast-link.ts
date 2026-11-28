"use client"

import { createFastLink, type FastLinkIntent } from "@fast-link/core"
import { useEffect, useEffectEvent, useState, type RefCallback } from "react"

type FastLinkOptions = {
  /** `false` leaves every press native. */
  enabled?: boolean
  /** Navigates instead of `location.assign`, for a client-side router. Receives the authored `href`. */
  onFollow?: (href: string, details: { url: URL; anchor: HTMLAnchorElement; event: PointerEvent }) => void
  /**
   * Follows the anchor this ref is on although it has this role, like a command rendered as an anchor (`option`).
   * An anchor with any other role acts as a control and stays native.
   */
  anchorRole?: string
}

const optOut = "[data-no-fast-link]"
const hashPrefixAttribute = "data-fast-link-hash-prefix"
const defaultHashPrefix = "#/"
const nestedControls = "button, input, label, select, summary, textarea, [role~='button' i]"

// Workaround: @fast-link/core 0.0.2 leaves every `#…` href native, hash routes (`#/inbox`) included, so these
// presses are resolved here with core's eligibility rules.
const anchorRoots = new WeakMap<Element, number>()
const handledPresses = new WeakSet<Event>()

/**
 * Whether `href` is a hash route rather than an in-page anchor: it starts with the prefix that the closest
 * `data-fast-link-hash-prefix` gives (`"#/"` without one; an empty value means none).
 */
function isHashRoute(anchor: Element, href: string) {
  if (!href.startsWith("#")) return false
  const prefix = anchor.closest(`[${hashPrefixAttribute}]`)?.getAttribute(hashPrefixAttribute) ?? defaultHashPrefix
  return prefix !== "" && href.startsWith(prefix)
}

type PressIntent = FastLinkIntent & { hashRoute: boolean }

// Workaround: core follows only anchors without a role (or `link`), so an `anchorRole` root is resolved here.
function pressIntent(event: PointerEvent, root: HTMLElement, anchorRole: string | undefined): PressIntent | null {
  if (event.defaultPrevented || event.button !== 0 || event.pointerType !== "mouse") return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || handledPresses.has(event)) return null
  const target = event.target instanceof Element ? event.target : null
  const anchor = target?.closest("a")
  if (!target || !anchor || !root.contains(anchor) || (anchor !== root && anchorRoots.has(anchor))) return null
  const role = anchor.getAttribute("role")
  const ownRole = anchor === root && anchorRole !== undefined && role === anchorRole
  const linkTarget = anchor.getAttribute("target")
  if ((role && !ownRole && !/^\s*(?:link)?\s*$/i.test(role)) || (linkTarget && linkTarget !== "_self")) return null
  const control = target.closest(nestedControls)
  if (anchor.hasAttribute("download") || (control && anchor.contains(control))) return null
  const href = anchor.getAttribute("href")
  const view = anchor.ownerDocument.defaultView
  if (!href || !view) return null
  const url = new URL(href, anchor.ownerDocument.baseURI)
  const hashRoute = isHashRoute(anchor, href)
  if (hashRoute) {
    // Spec: a `<base>` elsewhere makes `#/x` another document's URL, which the browser loads natively.
    if (url.href.slice(0, url.href.length - url.hash.length) !== view.location.href.split("#")[0]) return null
  } else if (!ownRole || href.startsWith("#") || url.origin !== view.location.origin) return null
  handledPresses.add(event)
  return { anchor, href, url, hashRoute }
}

// Workaround: core reads `data-no-fast-link` only between the pressed element and its anchor; a capture listener
// added before core's lets an ancestor (a region, `<body>`) opt out too.
function attachFastLink(root: HTMLElement, options: () => FastLinkOptions) {
  let press: PointerEvent | undefined
  let pendingPress: HTMLAnchorElement | undefined
  const follow = (intent: FastLinkIntent, hashRoute: boolean) => {
    const { onFollow } = options()
    const view = intent.anchor.ownerDocument.defaultView
    if (onFollow && press) onFollow(intent.href, { url: intent.url, anchor: intent.anchor, event: press })
    else if (hashRoute && view) view.location.hash = intent.url.hash
    else view?.location.assign(intent.url.href)
  }
  const navigate = (intent: FastLinkIntent) => follow(intent, false)
  const onPointerDown = (event: PointerEvent) => {
    press = event
    pendingPress = undefined
    const target = event.target instanceof Element ? event.target : null
    const enabled = options().enabled !== false && !target?.closest(optOut)
    controller.update({ enabled, navigate })
    const intent = enabled ? pressIntent(event, root, options().anchorRole) : null
    if (!intent) return
    pendingPress = intent.anchor
    follow(intent, intent.hashRoute)
  }
  const onClick = (event: MouseEvent) => {
    const anchor = pendingPress
    if (!anchor || event.detail === 0 || !(event.target instanceof Node) || !anchor.contains(event.target)) return
    pendingPress = undefined
    event.preventDefault()
  }
  if (root instanceof HTMLAnchorElement) anchorRoots.set(root, (anchorRoots.get(root) ?? 0) + 1)
  root.addEventListener("pointerdown", onPointerDown, { capture: true })
  root.addEventListener("click", onClick, { capture: true })
  const controller = createFastLink(root, { enabled: options().enabled !== false, navigate })
  return () => {
    root.removeEventListener("pointerdown", onPointerDown, { capture: true })
    root.removeEventListener("click", onClick, { capture: true })
    const owners = (anchorRoots.get(root) ?? 1) - 1
    if (owners > 0) anchorRoots.set(root, owners)
    else anchorRoots.delete(root)
    controller.destroy()
  }
}

/**
 * A ref that follows same-origin links on a primary mouse press instead of on release, on the element itself (an
 * anchor) or on the anchors inside it. Keyboard, touch, pen and modified or non-primary presses stay native. A hash
 * route (`#/inbox`) follows too, through `onFollow` or `location.hash`; an in-page anchor (`#section`) stays native.
 */
function useFastLink<T extends HTMLElement>(options: FastLinkOptions = {}): RefCallback<T> {
  const [element, setElement] = useState<T | null>(null)
  const readOptions = useEffectEvent(() => options)
  useEffect(() => (element ? attachFastLink(element, () => readOptions()) : undefined), [element])
  return setElement
}

export { hashPrefixAttribute, isHashRoute, useFastLink }
export type { FastLinkOptions }
