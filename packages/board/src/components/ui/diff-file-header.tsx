"use client"

import { ChevronRightIcon } from "lucide-react"
import { memo, type CSSProperties } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox"
import type { DiffLabels } from "@/components/ui/diff-labels"
import { FileChange } from "@/components/ui/diff-stat"
import type { DiffViewFile, DiffNotice } from "@/components/ui/diff-view-model"
import type { DiffViewApi } from "@/components/ui/diff-view-rows"
import { Label } from "@/components/ui/label"
import type { FileStatus } from "@/lib/diff-types"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

const statusTone: Record<FileStatus, Tone> = {
  added: "success",
  deleted: "destructive",
  modified: "neutral",
  renamed: "info",
  copied: "info",
}

/**
 * A rename as git prints it, the common folders and file name outside the braces: `docs/{a.md → b.md}`, or
 * `{old → new}/index.ts`. Without anything in common it is `old → new`.
 */
function renameLabel(oldPath: string, newPath: string) {
  const before = oldPath.split("/")
  const after = newPath.split("/")
  let head = 0
  while (head < Math.min(before.length, after.length) - 1 && before[head] === after[head]) head++
  let tail = 0
  while (tail < Math.min(before.length, after.length) - head - 1 && before.at(-1 - tail) === after.at(-1 - tail)) {
    tail++
  }
  const prefix = before.slice(0, head).join("/")
  const suffix = tail > 0 ? before.slice(-tail).join("/") : ""
  const middle = `${before.slice(head, before.length - tail).join("/")} → ${after.slice(head, after.length - tail).join("/")}`
  if (!prefix && !suffix) return middle
  return `${prefix ? `${prefix}/` : ""}{${middle}}${suffix ? `/${suffix}` : ""}`
}

function FilePath({ file, labels }: { file: DiffViewFile; labels: DiffLabels }) {
  const { oldPath, newPath, status } = file.diff
  const moved = (status === "renamed" || status === "copied") && oldPath && newPath && oldPath !== newPath
  const shown = file.group === undefined ? file.path : (newPath ?? oldPath ?? file.path)
  const full = moved ? `${oldPath} → ${newPath}` : shown
  return (
    <span
      data-slot="diff-file-path"
      className="min-w-0 truncate font-mono text-body-sm font-medium"
      dir="ltr"
      title={full}
    >
      <span aria-hidden="true">{moved ? renameLabel(oldPath, newPath) : shown}</span>
      <span className="sr-only">
        {moved ? `${newPath}, ${labels.renamedFrom} ${oldPath}` : shown}
        {file.group === undefined ? "" : `, ${file.group}`}
      </span>
    </span>
  )
}

type HeaderProps = {
  api: DiffViewApi
  file: DiffViewFile
  start: number
  size: number
  viewed: boolean
  collapsed: boolean
  labels: DiffLabels
}

// Perf: memoized, since a scroll renders the document again and each header holds several UI SDK parts.
const DiffFileHeader = memo(function DiffFileHeader({
  api,
  file,
  start,
  size,
  viewed,
  collapsed,
  labels,
}: HeaderProps) {
  const { status } = file.diff
  const style: CSSProperties = { top: start, height: size }
  return (
    <div data-slot="diff-file-header" className="absolute inset-x-0 pt-items contain-layout" style={style}>
      {/* oxlint-disable-next-line shadcn/no-arbitrary-values -- the viewport is dir="ltr" for the code; the header follows the page */}
      <div className="sticky start-0 flex h-full w-(--diff-viewport-width,100%) items-center gap-inline border-y border-border bg-card px-inline py-inline font-sans whitespace-nowrap text-card-foreground [direction:var(--diff-page-direction,ltr)]">
        <span className="flex shrink-0">
          <Button
            size="icon"
            variant="ghost"
            aria-label={labels.toggleFile(file.path)}
            aria-expanded={!collapsed}
            onClick={() => api.toggleFile(file.path)}
          >
            <ChevronRightIcon
              className={cn(
                "transition-transform duration-micro rtl:rotate-180",
                !collapsed && "rotate-90 rtl:rotate-90",
              )}
            />
          </Button>
        </span>
        <Badge tone={statusTone[status]}>{labels.status[status]}</Badge>
        {file.group === undefined ? null : (
          <Badge variant="outline" aria-hidden="true" data-slot="diff-file-group">
            {file.group}
          </Badge>
        )}
        <FilePath file={file} labels={labels} />
        <FileChange diff={file.diff} labels={labels} />
        <Label className="ms-auto shrink-0 font-normal text-body-sm">
          <Checkbox
            aria-label={labels.markViewed(file.path)}
            checked={viewed}
            onCheckedChange={(checked, details) => api.markViewed(file.path, checked === true, details.event)}
          >
            <CheckboxIndicator />
          </Checkbox>
          {labels.viewed}
        </Label>
      </div>
    </div>
  )
})

const noticeText = (labels: DiffLabels, notice: DiffNotice) =>
  notice === "binary" ? labels.binary : notice === "too-large" ? labels.tooLarge : labels.unchangedFile

const DiffNoticeRow = memo(function DiffNoticeRow({
  start,
  size,
  notice,
  labels,
}: {
  start: number
  size: number
  notice: DiffNotice
  labels: DiffLabels
}) {
  const style: CSSProperties = { top: start, height: size }
  return (
    <div
      data-slot="diff-notice"
      className="absolute inset-x-0 flex items-center px-inset-item font-sans text-body-sm text-muted-foreground contain-strict"
      style={style}
    >
      {noticeText(labels, notice)}
    </div>
  )
})

export { DiffFileHeader, DiffNoticeRow, renameLabel }
