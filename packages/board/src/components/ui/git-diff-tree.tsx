"use client"

import {
  Tree,
  TreeGroup,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  treeFromPaths,
  type TreeItemData,
} from "@ui-sdk/react/tree"
import { ChevronRightIcon, FileDiffIcon, FileMinusIcon, FilePlusIcon, FileSymlinkIcon, FolderIcon } from "lucide-react"
import { useMemo } from "react"

import type { DiffLabels } from "@/components/ui/diff-labels"
import { FileChange } from "@/components/ui/diff-stat"
import type { DiffViewFile } from "@/components/ui/diff-view-model"
import { ScrollArea, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import type { FileStatus } from "@/lib/diff-types"
import { cn } from "@/lib/utils"

const statusIcon: Record<FileStatus, typeof FileDiffIcon> = {
  added: FilePlusIcon,
  deleted: FileMinusIcon,
  modified: FileDiffIcon,
  renamed: FileSymlinkIcon,
  copied: FileSymlinkIcon,
}

const statusColour: Record<FileStatus, string> = {
  added: "text-diff-added-foreground",
  deleted: "text-diff-removed-foreground",
  modified: "text-muted-foreground",
  renamed: "text-muted-foreground",
  copied: "text-muted-foreground",
}

type Section = TreeItemData & { count?: number }

function Items({
  items,
  files,
  labels,
}: {
  items: Section[]
  files: ReadonlyMap<string, DiffViewFile>
  labels: DiffLabels
}) {
  return items.map((item) => {
    if (item.count !== undefined) {
      return (
        <TreeItem key={item.value} value={item.value} className="outline-none">
          <TreeItemLabel
            data-group=""
            className="flex cursor-pointer items-center gap-inline rounded-control px-inline py-inset-item text-body-sm font-medium hover:bg-accent hover:text-accent-foreground [:focus-visible>&]:outline-2 [:focus-visible>&]:outline-ring"
          >
            <TreeItemIndicator className="inline-flex data-expanded:rotate-90 rtl:rotate-180 rtl:data-expanded:rotate-90">
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </TreeItemIndicator>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="text-caption font-normal text-muted-foreground tabular-nums">
              {labels.fileCount(item.count)}
            </span>
          </TreeItemLabel>
          <TreeGroup>
            <Items items={item.children ?? []} files={files} labels={labels} />
          </TreeGroup>
        </TreeItem>
      )
    }
    const file = files.get(item.value)
    const Icon = file ? statusIcon[file.diff.status] : FolderIcon
    return (
      <TreeItem key={item.value} value={item.value} className="outline-none">
        <TreeItemLabel
          className={cn(
            // oxlint-disable-next-line shadcn/no-arbitrary-values -- indents each level by a group gap, from the tree's --tree-level
            "flex cursor-pointer items-center gap-inline rounded-control py-inset-item pe-inline ps-[calc(var(--tree-level)*var(--gap-group)-var(--gap-inline))] text-body-sm",
            "hover:bg-accent hover:text-accent-foreground [:focus-visible>&]:outline-2 [:focus-visible>&]:outline-ring data-selected:bg-accent data-selected:text-accent-foreground",
          )}
        >
          {item.children ? (
            <TreeItemIndicator className="inline-flex data-expanded:rotate-90 rtl:rotate-180 rtl:data-expanded:rotate-90">
              <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            </TreeItemIndicator>
          ) : null}
          <span className={cn("inline-flex shrink-0", file ? statusColour[file.diff.status] : "text-muted-foreground")}>
            <Icon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {file ? (
            <>
              <span className="sr-only">{labels.status[file.diff.status]}</span>
              <FileChange diff={file.diff} labels={labels} bar={false} />
            </>
          ) : null}
        </TreeItemLabel>
        {item.children ? (
          <TreeGroup>
            <Items items={item.children} files={files} labels={labels} />
          </TreeGroup>
        ) : null}
      </TreeItem>
    )
  })
}

function scopeFoldersToSection(
  items: readonly TreeItemData[],
  scope: string,
  files: ReadonlyMap<string, DiffViewFile>,
): TreeItemData[] {
  return items.map((item) => {
    if (item.children) {
      return { ...item, value: `${scope}${item.value}`, children: scopeFoldersToSection(item.children, scope, files) }
    }
    const diff = files.get(item.value)?.diff
    const unsuffixedPath = diff?.newPath ?? diff?.oldPath
    return unsuffixedPath ? { ...item, label: unsuffixedPath.slice(unsuffixedPath.lastIndexOf("/") + 1) } : item
  })
}

function itemsOf(files: readonly DiffViewFile[], groups: readonly GitDiffTreeGroup[] | undefined): Section[] {
  if (!groups) return treeFromPaths(files.map((file) => file.path))
  const byPath = new Map(files.map((file) => [file.path, file]))
  return groups.map((group, index) => ({
    value: `\u0000group:${String(index)}`,
    label: group.label,
    count: group.paths.length,
    children: scopeFoldersToSection(treeFromPaths(group.paths), `\u0000${String(index)}:`, byPath),
  }))
}

function folders(items: readonly TreeItemData[], out: string[] = []) {
  for (const item of items) {
    if (item.children) {
      out.push(item.value)
      folders(item.children, out)
    }
  }
  return out
}

type GitDiffTreeGroup = {
  label: string
  /** The `path` of each of its `files`. */
  paths: readonly string[]
}

type GitDiffTreeProps = {
  files: readonly DiffViewFile[]
  /** Without it, one tree of every file. */
  groups?: readonly GitDiffTreeGroup[]
  /** The `path` of the file shown, highlighted in the tree. */
  value?: string | null
  onOpen: (path: string) => void
  labels: DiffLabels
  className?: string
}

function GitDiffTree({ files, groups, value, onOpen, labels, className }: GitDiffTreeProps) {
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])
  const items = useMemo(() => itemsOf(files, groups), [files, groups])
  const open = useMemo(() => folders(items), [items])
  return (
    <ScrollArea className={cn("flex flex-col", className)}>
      <ScrollAreaViewport className="h-auto min-h-0 flex-1">
        <Tree
          aria-label={labels.files}
          items={items}
          defaultExpanded={open}
          value={value ?? null}
          onValueChange={(next) => {
            if (typeof next === "string" && byPath.has(next)) onOpen(next)
          }}
          className="flex flex-col"
        >
          <Items items={items} files={byPath} labels={labels} />
        </Tree>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar data-agent-hidden="" />
      <ScrollAreaScrollbar orientation="horizontal" data-agent-hidden="" />
    </ScrollArea>
  )
}

export { GitDiffTree }
export type { GitDiffTreeGroup, GitDiffTreeProps }
