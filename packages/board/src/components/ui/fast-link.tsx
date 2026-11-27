"use client"

import { mergeProps, renderElement, type PartProps } from "@ui-sdk/react/primitive"

import { hashPrefixAttribute, isHashRoute, useFastLink, type FastLinkOptions } from "@/components/ui/use-fast-link"

type FastLinkRegionProps = PartProps<"div"> &
  FastLinkOptions & {
    /**
     * The start of a hash route's `href` (default `"#/"`), for every link inside, `Link`s included: such a link
     * follows on press, while other `#…` hrefs are in-page anchors and stay native. `false` makes every `#…` href
     * an anchor. Sets `data-fast-link-hash-prefix`, which also works on any element, `<body>` for the whole app.
     */
    hashPrefix?: string | false
  }

/** Fast links for plain anchors in prose or rendered HTML; `Link` already has them. */
function FastLinkRegion({ enabled, onFollow, hashPrefix, render, ...props }: FastLinkRegionProps) {
  const ref = useFastLink<HTMLDivElement>({ enabled, onFollow })
  const prefix = hashPrefix === undefined ? undefined : hashPrefix || ""
  return renderElement(
    "div",
    mergeProps({ "data-slot": "fast-link-region", [hashPrefixAttribute]: prefix, ref }, props),
    render,
  )
}

export { FastLinkRegion, hashPrefixAttribute, isHashRoute, useFastLink }
export type { FastLinkOptions, FastLinkRegionProps }
