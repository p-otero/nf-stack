"use client"

import { usePart, usePrimitive, type PartProps } from "@ui-sdk/react/primitive"
import {
  Tree,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  treeFromPaths,
  visibleTreeRows,
  type TreeItemData,
} from "@ui-sdk/react/tree"
import {
  ChevronRightIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileJsonIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react"
import { memo, useCallback, useMemo, type CSSProperties, type FocusEvent } from "react"

import { gitTree, type GitTreeOptions } from "@/components/ui/git-tree-primitive"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { useInstanceState } from "@/components/ui/use-instance-state"
import { useTrailRows } from "@/components/ui/use-trail-rows"
import { gitStatusTones, indexGitFiles, type GitFileStatus, type GitTreeFile } from "@/lib/git-status"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

type GitTreeLabels = {
  /** Read after a changed file's name: "Modified". */
  status: Record<GitFileStatus, string>
  /** The one-letter mark shown beside a changed file. */
  mark: Record<GitFileStatus, string>
  /** Read after a folder that holds changes. */
  changedFolder: string
  /** Read after a renamed file: "from src/old.ts". */
  renamedFrom: (path: string) => string
}

const gitTreeLabels: GitTreeLabels = {
  status: { added: "Added", modified: "Modified", deleted: "Deleted", renamed: "Renamed" },
  mark: { added: "A", modified: "M", deleted: "D", renamed: "R" },
  changedFolder: "Has changes",
  renamedFrom: (path) => `from ${path}`,
}

type GitTreeProps = Omit<PartProps<"div">, "children" | "onSelect" | "defaultValue"> & {
  /** Names the tree, for screen readers and agents. */
  "aria-label": string
  /** Every path at the commit, as strings or with a status; a path ending in `/` is an empty folder. */
  files: readonly (string | GitTreeFile)[]
  /** Open folders. By default the folders that hold a change start open. */
  expanded?: readonly string[]
  defaultExpanded?: readonly string[]
  onExpandedChange?: GitTreeOptions["onExpandedChange"]
  /** The file shown elsewhere, like the one a diff is open on. */
  current?: string | null
  /** Click or Enter on a file. */
  onOpenFile?: GitTreeOptions["onOpenFile"]
  labels?: Partial<GitTreeLabels>
  /** A row's estimated height in px before it is measured. Default 32. */
  estimateSize?: number
  /**
   * Find in page reaches files and folders scrolled out of view, by name, through UI SDK's virtualizer and its
   * findable layers, built once the page is idle after its first paint. Off by default: on 100,000 files it costs
   * up to a frame on some held-arrow presses (p95 about 16 ms against 10 ms).
   */
  findable?: boolean
}

const markClassNames: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  violet: "text-violet",
}

type FileKind = "code" | "data" | "image" | "text" | "other"

const fileKinds: [RegExp, FileKind][] = [
  [/\.(?:[cm]?[jt]sx?|css|html|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cpp|sh)$/i, "code"],
  [/\.(?:json|ya?ml|toml|lock)$/i, "data"],
  [/\.(?:png|jpe?g|gif|svg|webp|avif|ico)$/i, "image"],
  [/\.(?:md|mdx|txt|rst)$|(?:^|\/)(?:README|LICENSE|CHANGELOG)[^/]*$/i, "text"],
]

function NodeIcon({ folder, expanded, path }: { folder: boolean; expanded: boolean; path: string }) {
  if (folder) return expanded ? <FolderOpenIcon /> : <FolderIcon />
  switch (fileKinds.find(([pattern]) => pattern.test(path))?.[1]) {
    case "code":
      return <FileCodeIcon />
    case "data":
      return <FileJsonIcon />
    case "image":
      return <FileImageIcon />
    case "text":
      return <FileTextIcon />
    default:
      return <FileIcon />
  }
}

const rowClassName =
  "relative flex h-control-sm min-w-0 items-center gap-inline rounded-control pe-(--item-padding-x) text-body-sm transition-colors duration-micro ease-standard [:focus-visible>&]:bg-accent [:focus-visible>&]:ring-2 [:focus-visible>&]:ring-ring hover:bg-accent data-current:bg-accent data-current:font-medium data-current:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- each level indents by a chevron plus the inline gap, from the item inset
const levelIndent = "ps-[calc((var(--tree-level)-1)*var(--git-tree-indent)+var(--item-padding-x))]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- one level of nesting (a chevron plus the inline gap), and the scroller's cap with `findable` (UI SDK's virtualizer needs it bounded)
const indentSize = "[--git-tree-indent:calc(0.875rem+var(--gap-inline))] [--git-tree-height:40rem]"

type RowContext = {
  status: ReadonlyMap<string, GitTreeFile>
  changedFolders: ReadonlySet<string>
  labels: GitTreeLabels
}

type GitTreeRowProps = {
  item: TreeItemData
  level: number
  index: number
  expanded: boolean
  context: RowContext
  /** Where the row sits in the tree's box while it's virtualized, in px. */
  top?: number
  measure?: (index: number, el: HTMLElement | null) => () => void
  /** Fills the name, so find in page finds the row while it isn't rendered (`findableText`). */
  textSlot?: (index: number, el: HTMLElement | null) => () => void
}

const GitTreeRow = memo(function GitTreeRow({
  item,
  level,
  index,
  expanded,
  context,
  top,
  measure,
  textSlot,
}: GitTreeRowProps) {
  const folder = item.children !== undefined
  const file = context.status.get(item.value)
  const changedFolder = folder && context.changedFolders.has(item.value)
  const { labels } = context
  return (
    <TreeItem
      value={item.value}
      ref={measure ? (el: HTMLElement | null) => measure(index, el) : undefined}
      data-index={index}
      data-status={file?.status}
      style={{ "--tree-level": level, top } as CSSProperties}
      className={cn("outline-none", top !== undefined && "absolute inset-x-0")}
    >
      <TreeItemLabel className={cn(rowClassName, levelIndent)}>
        {folder ? (
          <TreeItemIndicator className="inline-flex shrink-0 text-muted-foreground transition-transform duration-micro ease-standard data-expanded:rotate-90 rtl:-scale-x-100 [&_svg]:size-3.5">
            <ChevronRightIcon />
          </TreeItemIndicator>
        ) : (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span
          className={cn(
            "inline-flex shrink-0 text-muted-foreground [&_svg]:size-4",
            file?.status && markClassNames[gitStatusTones[file.status]],
          )}
        >
          <NodeIcon folder={folder} expanded={expanded} path={item.value} />
        </span>
        <span
          className={cn("min-w-0 truncate", file?.status === "deleted" && "line-through decoration-destructive")}
          title={file?.from ? `${file.from} → ${item.value}` : undefined}
          ref={textSlot ? (el: HTMLElement | null) => textSlot(index, el) : undefined}
        >
          {textSlot ? null : item.label}
        </span>
        {file?.status && (
          <span className="sr-only">
            , {labels.status[file.status]}
            {file.from ? `, ${labels.renamedFrom(file.from)}` : ""}
          </span>
        )}
        {changedFolder && <span className="sr-only">, {labels.changedFolder}</span>}
        <span aria-hidden="true" className="ms-auto flex shrink-0 items-center">
          {file?.status ? (
            <span
              data-slot="git-tree-status"
              className={cn("font-mono text-caption font-medium", markClassNames[gitStatusTones[file.status]])}
            >
              {labels.mark[file.status]}
            </span>
          ) : changedFolder ? (
            <span data-slot="git-tree-changed" className="size-1.5 rounded-full bg-warning" />
          ) : null}
        </span>
      </TreeItemLabel>
    </TreeItem>
  )
})

function nameOf(path: string, file: GitTreeFile | undefined, labels: GitTreeLabels) {
  return file?.status ? `${path}, ${labels.status[file.status]}` : path
}

/**
 * A repository's files at a commit, folders first, with changed files marked by status (added, modified, deleted,
 * renamed) and folders that hold a change marked too. UI SDK's Tree underneath: arrows, typeahead, Left/Right to
 * close and open folders. Rows virtualize, so 100,000 files render only what's in view.
 */
function GitTree({
  "aria-label": label,
  files,
  expanded,
  defaultExpanded,
  onExpandedChange,
  current,
  onOpenFile,
  labels: labelOverrides,
  estimateSize = 32,
  findable = false,
  className,
  onFocus,
  ...props
}: GitTreeProps) {
  const labels = useMemo(() => ({ ...gitTreeLabels, ...labelOverrides }), [labelOverrides])
  const index = useMemo(() => indexGitFiles(files), [files])
  const items = useMemo(() => treeFromPaths(index.paths), [index])
  const folders = useMemo(() => {
    const set = new Set<string>()
    const walk = (list: readonly TreeItemData[]) => {
      for (const item of list) {
        if (!item.children) continue
        set.add(item.value)
        walk(item.children)
      }
    }
    walk(items)
    return set
  }, [items])

  const fileSet = useMemo(() => new Set(index.paths), [index])
  const lookup = useMemo(
    () => ({
      kind: (path: string) =>
        folders.has(path) ? ("folder" as const) : fileSet.has(path) ? ("file" as const) : undefined,
      entries: () => index.paths.map((path) => ({ value: path, label: nameOf(path, index.status.get(path), labels) })),
    }),
    [folders, fileSet, index, labels],
  )
  const handle = usePrimitive(gitTree, {
    lookup,
    expanded,
    defaultExpanded: defaultExpanded ?? [...index.changedFolders],
    onExpandedChange,
    onOpenFile,
  })
  const state = useInstanceState<typeof handle.state>(handle.instance)
  const rows = useMemo(() => visibleTreeRows(items, state.expanded), [items, state.expanded])
  const open = useMemo(() => new Set(state.expanded), [state.expanded])

  const keyAt = useCallback((at: number) => rows[at]?.item.value ?? String(at), [rows])
  const nameAt = useCallback((at: number) => rows[at]?.item.label ?? "", [rows])
  const { setScroller, anchor, ...virtual } = useTrailRows({
    count: rows.length,
    estimate: estimateSize,
    getKey: keyAt,
    text: nameAt,
    findable,
  })
  const context = useMemo<RowContext>(
    () => ({ status: index.status, changedFolders: index.changedFolders, labels }),
    [index, labels],
  )
  return usePart(
    handle,
    "root",
    {},
    {
      ...props,
      "aria-label": label,
      className: cn("flex min-h-0 min-w-0 flex-col", indentSize, className),
      onFocus: (event: FocusEvent<HTMLDivElement>) => {
        onFocus?.(event)
        if (!virtual.virtual || !(event.target instanceof Element)) return
        const at = Number(event.target.closest<HTMLElement>("[data-index]")?.dataset.index ?? Number.NaN)
        if (!Number.isNaN(at)) virtual.pin(at)
      },
      children: (
        <ScrollArea className={cn("flex min-h-0 flex-1 flex-col", findable && "max-h-(--git-tree-height)")}>
          <ScrollAreaViewport ref={setScroller} className="h-auto min-h-0 flex-1">
            <div ref={anchor} className="min-w-0">
              <Tree
                aria-label={label}
                // The tree's own expand and collapse would list every path a second time beside open, expand and collapse.
                data-agent-hidden=""
                items={items}
                mode="none"
                current={current ?? null}
                expanded={state.expanded as string[]}
                onExpandedChange={(next, change) =>
                  handle.api.setExpanded(next, { reason: change.reason, event: change.event })
                }
                onAction={(path, { event }) => {
                  if (!folders.has(path) && onOpenFile) handle.api.open(path, { reason: "item-press", event })
                }}
                onHighlight={(_path, { index: at }) => {
                  if (virtual.virtual && at >= 0) virtual.scrollToIndex(at)
                }}
                style={virtual.absolute ? { height: virtual.height } : undefined}
                className={cn("flex min-w-0 flex-col outline-none", virtual.virtual && "relative")}
              >
                {virtual.segments.map((segment) => {
                  if (segment.type === "gap") {
                    return (
                      <div
                        key={segment.key}
                        aria-hidden="true"
                        data-slot="git-tree-gap"
                        style={{ height: segment.size }}
                      />
                    )
                  }
                  const { index: at, top } = segment
                  const row = rows[at]
                  if (!row) return null
                  return (
                    <GitTreeRow
                      key={row.item.value}
                      item={row.item}
                      level={row.level}
                      index={at}
                      top={top}
                      expanded={open.has(row.item.value)}
                      context={context}
                      measure={virtual.measure}
                      textSlot={virtual.textSlot}
                    />
                  )
                })}
              </Tree>
            </div>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar data-agent-hidden="" />
        </ScrollArea>
      ),
    },
  )
}

export { GitTree, gitTreeLabels }
export type { GitTreeLabels, GitTreeProps }
