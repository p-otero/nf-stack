"use client"

import { Button } from "@ui-sdk/react/button"
import type { ComponentProps, MouseEvent } from "react"
import { FileIcon } from "lucide-react"

import type { Attachment } from "@/components/ui/attachments-primitive"
import { Link } from "@/components/ui/link"
import { ThemedImage } from "@/components/ui/themed-image"
import { useLocale } from "@/lib/locale"
import { cn } from "@/lib/utils"

function buttonWithOwnSlot(props: ComponentProps<"button">) {
  return <button {...props} data-slot="attachment-thumb" />
}

type AttachmentSize = "sm" | "md"

const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const

/** A byte count in the locale's words for the largest fitting unit, like "2.4 MB". */
function formatFileSize(bytes: number, locale?: string) {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)
}

function fileType(attachment: Attachment) {
  const extension = /\.([a-z0-9]{1,5})$/iu.exec(attachment.name)?.[1]
  return (extension ?? attachment.mimeType?.split("/")[1] ?? "").toUpperCase()
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

const sizeClassNames = { sm: "h-12", md: "h-20" } satisfies Record<AttachmentSize, string>

type AttachmentThumbProps = {
  attachment: Attachment
  size?: AttachmentSize
  /** Runs on a press; `event.preventDefault()` stops a file's link from opening. Without it, an image is static. */
  onOpen?: (attachment: Attachment, event: MouseEvent<HTMLElement>) => void
  /** The accessible name of an image's button. */
  openLabel?: (name: string) => string
  locale?: string
  className?: string
}

function FileTile({ size }: { size: AttachmentSize }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground",
        size === "sm" ? "size-8 [&_svg]:size-4" : "size-12 [&_svg]:size-5",
      )}
    >
      <FileIcon />
    </span>
  )
}

const defaultOpenLabel = (name: string) => `Open ${name}`

function AttachmentThumb({
  attachment,
  size = "md",
  onOpen,
  openLabel = defaultOpenLabel,
  locale: localeProp,
  className,
}: AttachmentThumbProps) {
  const locale = useLocale(localeProp)
  const shared = {
    "data-slot": "attachment-thumb",
    "data-kind": attachment.kind,
    "data-size": size,
    "data-attachment-id": attachment.id,
  }

  if (attachment.kind === "image") {
    const image = (
      <ThemedImage
        src={attachment.thumbnail ?? attachment.src}
        srcDark={attachment.thumbnailDark ?? attachment.srcDark}
        alt={onOpen ? "" : attachment.alt}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    )
    const box = cn(
      "relative shrink-0 overflow-hidden rounded-lg border bg-muted",
      size === "sm" ? "size-12" : "aspect-4/3 h-20",
      className,
    )
    if (!onOpen) {
      return (
        <span {...shared} className={box}>
          {image}
        </span>
      )
    }
    return (
      <Button
        {...shared}
        render={buttonWithOwnSlot}
        aria-label={openLabel(attachment.name)}
        title={attachment.name}
        onClick={(event) => onOpen(attachment, event)}
        className={cn(box, "touch-target cursor-pointer transition-colors hover:border-ring", focusRing)}
      >
        {image}
      </Button>
    )
  }

  const meta = [fileType(attachment), attachment.size === undefined ? "" : formatFileSize(attachment.size, locale)]
    .filter(Boolean)
    .join(" · ")
  const chip = cn(
    "flex max-w-64 shrink-0 items-center gap-inline rounded-lg border bg-card/(--glass-opacity) px-inset-item text-start text-card-foreground",
    // oxlint-disable-next-line shadcn/require-static-classes -- one of two static heights, picked by size
    sizeClassNames[size],
    className,
  )
  const content = (
    <>
      <FileTile size={size} />
      <span className="flex min-w-0 flex-col">
        <span data-slot="attachment-name" className="truncate text-body-sm font-medium">
          {attachment.name}
        </span>
        {meta && <span className="truncate text-caption text-muted-foreground">{meta}</span>}
      </span>
    </>
  )
  const pressable = cn(
    chip,
    "touch-target cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground",
    focusRing,
  )

  if (attachment.href) {
    return (
      <Link
        {...shared}
        variant="plain"
        href={attachment.href}
        target="_blank"
        rel="noreferrer"
        title={attachment.name}
        onClick={onOpen && ((event) => onOpen(attachment, event))}
        className={pressable}
      >
        {content}
      </Link>
    )
  }
  if (onOpen) {
    return (
      <Button
        {...shared}
        render={buttonWithOwnSlot}
        title={attachment.name}
        onClick={(event) => onOpen(attachment, event)}
        className={pressable}
      >
        {content}
      </Button>
    )
  }
  return (
    <span {...shared} className={chip}>
      {content}
    </span>
  )
}

export { AttachmentThumb, formatFileSize }
export type { AttachmentSize, AttachmentThumbProps }
