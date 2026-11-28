"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import { Button } from "@ui-sdk/react/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog"
import { usePart, usePrimitive } from "@ui-sdk/react/primitive"
import { useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react"
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, XIcon, ZoomInIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { DialogBackdrop, dialogContentVariants } from "@/components/ui/dialog"
import { useVisualViewportBox } from "@/components/ui/use-dialog-viewport"
import { Link } from "@/components/ui/link"
import { lightbox, type LightboxIndexChangeReason } from "@/components/ui/lightbox-primitive"
import { ScrollArea, ScrollAreaCorner, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { ThemedImage, type ThemedImageProps } from "@/components/ui/themed-image"
import { ControlTooltip } from "@/components/ui/tooltip"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

type LightboxItem = {
  id: string
  src: string
  srcDark?: string
  alt: string
  /** The caption's title; `alt` when absent. */
  name?: string
  /** The original to open in a new tab; `src` when absent. */
  href?: string
}

type LightboxLabels = {
  viewer: string
  previous: string
  next: string
  close: string
  actualSize: string
  openOriginal: string
  counter: (position: number, count: number) => string
}

const lightboxLabels: LightboxLabels = {
  viewer: "Image viewer",
  previous: "Previous image",
  next: "Next image",
  close: "Close viewer",
  actualSize: "Actual size",
  openOriginal: "Open original",
  counter: (position, count) => `${position} / ${count}`,
}

type IndexChange = (index: number, details: ChangeDetails<LightboxIndexChangeReason>) => void
type DialogProps = ComponentProps<typeof Dialog>

type LightboxProps = {
  items: readonly LightboxItem[]
  index?: number
  defaultIndex?: number
  onIndexChange?: IndexChange
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: DialogProps["onOpenChange"]
  controller?: DialogProps["controller"]
  /** Where focus goes on close; by default the trigger, or what was focused before it opened. */
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
  labels?: Partial<LightboxLabels>
  className?: string
  /** Rendered inside the dialog root, like a `DialogTrigger`. */
  children?: ReactNode
}

// oxlint-disable-next-line shadcn/require-static-classes -- the Button look, from buttonVariants, on a link
const iconButtonClassName = cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0")
const stepClassName = cn(
  buttonVariants({ variant: "outline", size: "icon" }),
  "absolute inset-y-0 z-10 my-auto rounded-full bg-popover/(--glass-opacity) shadow-floating data-disabled:hidden",
)

type ViewProps = {
  items: readonly LightboxItem[]
  index: number
  onIndexChange: IndexChange
  labels: LightboxLabels
}

function LightboxView({ items, index, onIndexChange, labels }: ViewProps) {
  const count = items.length
  const item = items[index]!
  const entries = useMemo(
    () => items.map((entry, position) => ({ value: String(position), label: entry.name ?? entry.alt })),
    [items],
  )
  const handle = usePrimitive(lightbox, { index, count, entries, onIndexChange })
  const [zoom, setZoom] = useState<{ id: string; actual: boolean }>()
  const actual = zoom?.id === item.id && zoom.actual

  const children = (
    <>
      <div
        data-slot="lightbox-header"
        className="flex min-w-0 items-center gap-items border-b px-inset-item py-inset-item"
      >
        <DialogTitle className="min-w-0 flex-1 truncate text-title-sm">{item.name ?? item.alt}</DialogTitle>
        {count > 1 && (
          <span
            data-slot="lightbox-counter"
            aria-live="polite"
            className="shrink-0 text-caption text-muted-foreground tabular-nums"
          >
            {labels.counter(index + 1, count)}
          </span>
        )}
        <Toggle
          size="icon"
          aria-label={labels.actualSize}
          pressed={actual}
          onPressedChange={(pressed) => setZoom({ id: item.id, actual: pressed })}
        >
          <ZoomInIcon />
        </Toggle>
        <ControlTooltip label={labels.openOriginal}>
          <Link
            data-slot="lightbox-original"
            variant="plain"
            href={item.href ?? item.src}
            target="_blank"
            rel="noreferrer"
            aria-label={labels.openOriginal}
            className={iconButtonClassName}
          >
            <ExternalLinkIcon />
          </Link>
        </ControlTooltip>
        <ControlTooltip label={labels.close}>
          <DialogClose aria-label={labels.close} className={iconButtonClassName}>
            <XIcon />
          </DialogClose>
        </ControlTooltip>
      </div>
      <div data-slot="lightbox-stage" className="relative min-h-0 flex-1 bg-muted/(--glass-opacity)">
        <ScrollArea className="absolute! inset-0">
          <ScrollAreaViewport
            data-zoom={actual ? "actual" : "fit"}
            className="grid place-items-center-safe p-group"
            render={(part) => <div {...part} data-slot="lightbox-viewport" />}
          >
            <ThemedImage
              key={item.id}
              src={item.src}
              srcDark={item.srcDark}
              alt={item.alt}
              decoding="async"
              className={cn("rounded-control", actual ? "max-w-none" : "max-h-full max-w-full object-contain")}
            />
          </ScrollAreaViewport>
          <ScrollAreaScrollbar data-agent-hidden="" />
          <ScrollAreaScrollbar orientation="horizontal" data-agent-hidden="" />
          <ScrollAreaCorner />
        </ScrollArea>
        {count > 1 && (
          <>
            <ControlTooltip label={labels.previous}>
              <Button
                aria-label={labels.previous}
                disabled={index === 0}
                focusableWhenDisabled
                onClick={(event) => handle.api.previous({ reason: "item-press", event: event.nativeEvent })}
                className={cn(stepClassName, "start-group")}
              >
                <ChevronLeftIcon className="rtl:rotate-180" />
              </Button>
            </ControlTooltip>
            <ControlTooltip label={labels.next}>
              <Button
                aria-label={labels.next}
                disabled={index === count - 1}
                focusableWhenDisabled
                onClick={(event) => handle.api.next({ reason: "item-press", event: event.nativeEvent })}
                className={cn(stepClassName, "end-group")}
              >
                <ChevronRightIcon className="rtl:rotate-180" />
              </Button>
            </ControlTooltip>
          </>
        )}
      </div>
      {item.name && item.alt !== item.name && (
        <p
          data-slot="lightbox-caption"
          className="border-t px-inset-item py-inset-item text-body-sm text-muted-foreground"
        >
          {item.alt}
        </p>
      )}
    </>
  )

  return usePart(
    handle,
    "root",
    {},
    { "aria-label": labels.viewer, className: "flex min-h-0 flex-1 flex-col", children },
    "div",
  )
}

function KeepContentInVisualViewport({ contentRef }: { contentRef: RefObject<HTMLElement | null> }) {
  useVisualViewportBox(contentRef)
  return null
}

function Lightbox({
  items,
  index: indexProp,
  defaultIndex = 0,
  onIndexChange,
  open,
  defaultOpen,
  onOpenChange,
  controller,
  finalFocus,
  labels,
  className,
  children,
}: LightboxProps) {
  const [ownIndex, setOwnIndex] = useState(defaultIndex)
  const index = Math.min(Math.max(indexProp ?? ownIndex, 0), Math.max(items.length - 1, 0))
  const contentRef = useRef<HTMLDivElement | null>(null)

  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} controller={controller}>
      {children}
      <DialogBackdrop />
      <DialogContent
        ref={contentRef}
        finalFocus={finalFocus}
        render={<div data-slot="lightbox" />}
        className={cn(
          dialogContentVariants({ size: "full", sheet: false }),
          "max-w-6xl gap-0 overflow-hidden p-0",
          className,
        )}
      >
        {items.length > 0 && (
          <LightboxView
            items={items}
            index={index}
            labels={{ ...lightboxLabels, ...labels }}
            onIndexChange={(next, details) => {
              onIndexChange?.(next, details)
              if (!details.canceled) setOwnIndex(next)
            }}
          />
        )}
        <KeepContentInVisualViewport contentRef={contentRef} />
      </DialogContent>
    </Dialog>
  )
}

export { Lightbox, lightboxLabels }
export { ThemedImage }
export type { LightboxItem, LightboxLabels, LightboxProps }
export type { ThemedImageProps }
