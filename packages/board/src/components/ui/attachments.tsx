"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import { Button } from "@ui-sdk/react/button"
import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive"
import { useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import {
  AttachmentThumb,
  type AttachmentSize,
  formatFileSize,
  type AttachmentThumbProps,
} from "@/components/ui/attachment-thumb"
import {
  attachments as attachmentsPrimitive,
  type Attachment,
  type AttachmentOpenReason,
} from "@/components/ui/attachments-primitive"
import { Lightbox, type LightboxItem, type LightboxLabels } from "@/components/ui/lightbox"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type AttachmentLabels = {
  /** The accessible name of an image's button. */
  open: (name: string) => string
  /** The accessible name of the "+N" button that shows the rest. */
  more: (count: number) => string
  lightbox?: Partial<LightboxLabels>
}

const attachmentLabels: AttachmentLabels = {
  open: (name) => `Open ${name}`,
  more: (count) => `Show ${count} more attachments`,
}

type AttachmentStripProps = Omit<PartProps<"div">, "children" | "onSelect"> & {
  attachments: readonly Attachment[]
  /** Runs before an attachment opens, for a person or an agent; `details.cancel()` keeps it closed. */
  onOpen?: (attachment: Attachment, details: ChangeDetails<AttachmentOpenReason>) => void
  /** Shows this many, then a "+N" button for the rest. */
  max?: number
  size?: AttachmentSize
  labels?: Partial<AttachmentLabels>
  locale?: string
  "aria-label": string
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

function untypedRootDataAttributes(size: AttachmentSize) {
  return { "data-slot": "attachment-strip", "data-size": size }
}

function AttachmentStrip({
  attachments,
  onOpen,
  max,
  size = "md",
  labels: labelOverrides,
  locale,
  className,
  ...props
}: AttachmentStripProps) {
  const labels = { ...attachmentLabels, ...labelOverrides }
  const listViewport = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [viewer, setViewer] = useState({ open: false, index: 0, id: "" })
  const images = useMemo<LightboxItem[]>(
    () =>
      attachments
        .filter((attachment) => attachment.kind === "image")
        .map(({ id, src, srcDark, alt, name, href }) => ({ id, src, srcDark, alt, name, href })),
    [attachments],
  )

  const handle = usePrimitive(attachmentsPrimitive, {
    attachments,
    onOpen,
    open: (attachment, event) => {
      if (attachment.kind === "image") {
        setViewer({ open: true, index: images.findIndex((image) => image.id === attachment.id), id: attachment.id })
      } else if (!event && attachment.href) {
        globalThis.open(attachment.href, "_blank", "noopener,noreferrer")
      }
    },
  })

  const hidden = max !== undefined && !expanded ? Math.max(attachments.length - max, 0) : 0
  const shown = hidden > 0 ? attachments.slice(0, max) : attachments

  const children = (
    <>
      <ScrollArea className="-m-inline min-w-0">
        <ScrollAreaViewport
          ref={listViewport}
          className="flex h-auto items-center gap-items overscroll-x-contain p-inline"
          render={(part) => <ul {...part} data-slot="attachment-list" />}
        >
          {shown.map((attachment) => (
            <li key={attachment.id} className="flex shrink-0">
              <AttachmentThumb
                attachment={attachment}
                size={size}
                locale={locale}
                openLabel={labels.open}
                onOpen={(_, event) => {
                  const opened = handle.api.openAttachment(attachment.id, {
                    reason: "item-press",
                    event: event.nativeEvent,
                  })
                  if (!opened) event.preventDefault()
                }}
              />
            </li>
          ))}
          {hidden > 0 && (
            <li className="flex shrink-0">
              <Button
                render={(part) => <button {...part} data-slot="attachment-more" />}
                aria-label={labels.more(hidden)}
                onClick={() => {
                  flushSync(() => setExpanded(true))
                  const first = attachments[max ?? 0]
                  listViewport.current
                    ?.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(first?.id ?? "")}"]`)
                    ?.focus()
                }}
                className={cn(
                  "touch-target flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-muted/(--glass-opacity) px-inset-item text-body-sm font-medium text-muted-foreground tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground",
                  size === "sm" ? "h-12 min-w-12" : "h-20 min-w-20",
                  focusRing,
                )}
              >
                +{hidden}
              </Button>
            </li>
          )}
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="horizontal" data-agent-hidden="" />
      </ScrollArea>
      {images.length > 0 && (
        <Lightbox
          items={images}
          index={viewer.index}
          onIndexChange={(index) => setViewer((current) => ({ ...current, index }))}
          open={viewer.open}
          onOpenChange={(open) => setViewer((current) => ({ ...current, open }))}
          finalFocus={() =>
            listViewport.current?.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(viewer.id)}"]`) ??
            undefined
          }
          labels={labels.lightbox}
        />
      )}
    </>
  )

  return usePart(
    handle,
    "root",
    {},
    { ...props, ...untypedRootDataAttributes(size), className: cn("flex min-w-0", className), children },
    "div",
  )
}

export { AttachmentStrip, attachmentLabels }
export { AttachmentThumb, formatFileSize }
export type { AttachmentLabels, AttachmentStripProps }
export type { AttachmentSize, AttachmentThumbProps }
export type { Attachment, AttachmentOpenReason }
