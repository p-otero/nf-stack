"use client"

import type { VirtualItem } from "@ui-sdk/core"
import { usePart, usePrimitive } from "@ui-sdk/react/primitive"
import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react"

import { DiffFileHeader, DiffNoticeRow } from "@/components/ui/diff-file-header"
import { diffLabels, type DiffLabels } from "@/components/ui/diff-labels"
import type { DiffSnapshot } from "@/components/ui/diff-view-document"
import { diffView, type DiffViewOptions } from "@/components/ui/diff-view-primitive"
import { DiffViewRow, loneSide, type DiffViewApi } from "@/components/ui/diff-view-rows"
import { ScrollArea, ScrollAreaCorner, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type DiffViewProps = DiffViewOptions & {
  /** Overridable accessible names and the few visible words; pass a stable object (a constant). */
  labels?: DiffLabels
  className?: string
  "aria-label"?: string
  /** While a newer diff is computed: the current one stays on screen. */
  "aria-busy"?: boolean
  /** Shown when no file has a change. */
  empty?: ReactNode
  /**
   * `auto` (default) grows to the diff and scrolls with the nearest scrolling ancestor, or the page, which the
   * virtualizer follows; a `--diff-max-height` set on it or an ancestor caps it and it scrolls inside past that.
   * `fill` takes the height its parent gives it, for a diff that fills a pane.
   */
  height?: DiffHeight
}

type DiffHeight = "auto" | "fill"

type FileGroupProps = {
  api: DiffViewApi
  snapshot: DiffSnapshot
  fileIndex: number
  items: VirtualItem[]
  labels: DiffLabels
  findable: boolean
}

function firstLineRow(doc: DiffSnapshot["doc"], start: number, end: number) {
  let row = start
  while (row < end && (doc.rows[row]!.kind === "file" || doc.rows[row]!.kind === "notice")) row++
  return row
}

function FileGroup({ api, snapshot, fileIndex, items, labels, findable }: FileGroupProps) {
  const { doc, files, layout } = snapshot
  const file = files[fileIndex]!
  const start = doc.fileStart[fileIndex]!
  const end = doc.fileStart[fileIndex + 1] ?? doc.rows.length
  const firstGridRow = firstLineRow(doc, start, end)
  const split = layout === "split"
  return usePart(
    diffView,
    "file",
    { path: file.path },
    {
      children: (state) => {
        const headers: ReactNode[] = []
        const rows: ReactNode[] = []
        for (const item of items) {
          const row = doc.rows[item.index]!
          if (row.kind === "file") {
            headers.push(
              <DiffFileHeader
                key={row.key}
                api={api}
                file={file}
                start={item.start}
                size={item.size}
                viewed={state.viewed}
                collapsed={state.collapsed}
                labels={labels}
              />,
            )
          } else if (row.kind === "notice") {
            headers.push(
              <DiffNoticeRow key={row.key} start={item.start} size={item.size} notice={row.notice} labels={labels} />,
            )
          } else {
            rows.push(
              <DiffViewRow
                key={row.key}
                api={api}
                row={row}
                index={item.index}
                start={item.start}
                size={item.size}
                wrap={snapshot.wrap}
                position={item.index - firstGridRow + 1}
                file={file}
                labels={labels}
                findable={findable}
                split={split}
                syntax={api.document.syntax.version(file)}
              />,
            )
          }
        }
        return (
          <>
            {headers}
            {rows.length > 0 ? (
              <DiffGrid
                path={file.path}
                label={file.path ? labels.changes(file.path) : labels.diff}
                count={end - firstGridRow}
                cols={split && loneSide(file) === null ? 2 : 1}
              >
                {rows}
              </DiffGrid>
            ) : null}
          </>
        )
      },
    },
  )
}

function DiffGrid({
  path,
  label,
  count,
  cols,
  children,
}: {
  path: string
  label: string
  count: number
  cols: number
  children: ReactNode
}) {
  return usePart(
    diffView,
    "grid",
    { path },
    { "aria-label": label, "aria-rowcount": count, "aria-colcount": cols, children },
  )
}

function groupByFile(snapshot: DiffSnapshot) {
  const groups: { file: number; items: VirtualItem[] }[] = []
  for (const item of snapshot.items) {
    const row = snapshot.doc.rows[item.index]
    if (!row) continue
    const last = groups.at(-1)
    if (last?.file === row.file) last.items.push(item)
    else groups.push({ file: row.file, items: [item] })
  }
  return groups
}

function canvasStyle(snapshot: DiffSnapshot): CSSProperties {
  const { doc, size, wrap, layout } = snapshot
  const number = `calc(${String(String(doc.maxLine).length)}ch + 2 * var(--gap-inline))`
  const code = `calc(var(--diff-number) + 2ch + ${String(doc.longest)}ch + 2 * var(--gap-inline))`
  const width = layout === "split" ? `calc(2 * (${code}))` : `calc(var(--diff-number) + ${code})`
  return { height: size, "--diff-number": number, minWidth: wrap ? undefined : width } as CSSProperties
}

function Viewport({
  api,
  labels,
  findable,
  empty,
  height,
}: {
  api: DiffViewApi
  labels: DiffLabels
  findable: boolean
  empty?: ReactNode
  height: DiffHeight
}) {
  const snapshot = useSyncExternalStore(api.subscribe, api.snapshot, api.snapshot)
  const isEmpty = snapshot.doc.rows.length === 0
  const viewport = usePart(
    diffView,
    "viewport",
    {},
    {
      dir: "ltr",
      render: (
        <ScrollAreaViewport render={(part) => <div {...part} data-slot="diff-view-viewport" data-height={height} />} />
      ),
      className: cn(
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- a tab is four columns, as the unwrapped width counts it
        "relative h-auto min-h-0 flex-1 font-mono text-body-sm [tab-size:4]",
        // Perf: size containment keeps a filled pane's layout to itself; a content-sized one has to measure its rows.
        height === "fill" ? "contain-strict" : "contain-content",
        snapshot.wrap ? "whitespace-pre-wrap wrap-anywhere" : "whitespace-pre",
      ),
      children: isEmpty ? (
        <div data-slot="diff-view-empty" className="p-inset-surface font-sans text-muted-foreground">
          {empty ?? labels.identical}
        </div>
      ) : (
        <div data-slot="diff-view-canvas" className="relative contain-layout" style={canvasStyle(snapshot)}>
          {groupByFile(snapshot).map((group) => (
            <FileGroup
              key={snapshot.files[group.file]!.path}
              api={api}
              snapshot={snapshot}
              fileIndex={group.file}
              items={group.items}
              labels={labels}
              findable={findable}
            />
          ))}
        </div>
      ),
    },
  )
  return (
    <ScrollArea className={cn("flex min-h-0 flex-col", height === "fill" && "flex-1")}>
      {viewport}
      <ScrollAreaScrollbar data-agent-hidden="" />
      <ScrollAreaScrollbar orientation="horizontal" data-agent-hidden="" />
      <ScrollAreaCorner />
    </ScrollArea>
  )
}

/** `TextDiff` and `GitDiff` render it; use it directly for files you diffed yourself. */
function DiffView({
  labels = diffLabels,
  className,
  "aria-label": label,
  "aria-busy": busy,
  empty,
  height = "auto",
  ...options
}: DiffViewProps) {
  const handle = usePrimitive(diffView, options)
  return usePart(
    handle,
    "root",
    {},
    {
      "aria-label": label ?? labels.diff,
      "aria-busy": busy,
      className: cn(
        "flex min-h-0 flex-col overflow-hidden rounded-surface border border-border bg-background text-foreground",
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- an optional cap a page sets; without it the diff grows
        height === "auto" && "max-h-[var(--diff-max-height,none)]",
        className,
      ),
      children: (
        <Viewport
          api={handle.api}
          labels={labels}
          findable={options.findable !== false}
          empty={empty}
          height={height}
        />
      ),
    },
  )
}

export { DiffView }
export type { DiffHeight, DiffViewProps }
