import type { ImgHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

const lightOnlyClassName =
  "[:where(.dark)_&]:hidden [@media(prefers-color-scheme:dark)]:[:root:not(.light,[data-color-scheme=light])_&]:hidden"
const darkOnlyClassName =
  "hidden [:where(.dark)_&]:block [@media(prefers-color-scheme:dark)]:[:root:not(.light,[data-color-scheme=light])_&]:block"

/**
 * Pass `width` and `height` (the image's own size, in pixels): with the theme's `height: auto` the box is reserved at
 * that ratio before the image loads, so nothing below it moves when it arrives.
 */
type ThemedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string
  /** Shown instead of `src` while the page is dark. Both are rendered and CSS picks one, so nothing flashes. */
  srcDark?: string
}

function ThemedImage({ src, srcDark, className, alt = "", ...props }: ThemedImageProps) {
  if (!srcDark || srcDark === src) {
    return <img data-slot="themed-image" src={src} alt={alt} className={className} {...props} />
  }
  return (
    <>
      <img
        data-slot="themed-image"
        data-scheme="light"
        src={src}
        alt={alt}
        className={cn("block", className, lightOnlyClassName)}
        {...props}
      />
      <img
        data-slot="themed-image"
        data-scheme="dark"
        src={srcDark}
        alt={alt}
        className={cn(className, darkOnlyClassName)}
        {...props}
      />
    </>
  )
}

export { ThemedImage }
export type { ThemedImageProps }
