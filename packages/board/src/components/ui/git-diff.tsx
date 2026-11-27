"use client"

import { Columns2Icon, PanelLeftIcon, RowsIcon, WrapTextIcon } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { diffLabels } from "@/components/ui/diff-labels"
import { DiffStat } from "@/components/ui/diff-stat"
import { DiffView, type DiffViewProps } from "@/components/ui/diff-view"
import { toViewFiles, type DiffLayout } from "@/components/ui/diff-view-model"
import { createDiffViewController, type DiffViewController } from "@/components/ui/diff-view-primitive"
import { GitDiffTree } from "@/components/ui/git-diff-tree"
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@/components/ui/segmented-control"
import { Toggle } from "@/components/ui/toggle"
import { parsePatch } from "@/lib/diff-patch"
import type { FileDiff } from "@/lib/diff-types"
import { useOpenCurrentFile } from "@/components/ui/use-git-diff"
import { cn } from "@/lib/utils"

type GitDiffProps = Omit<DiffViewProps, "files" | "headers"> & {
  /** A unified diff as git prints it (`git diff`, `git show`, a `.patch`), with any number of files. */
  patch?: string
  /** File diffs you parsed or computed; give `oldText`/`newText` to make unchanged regions expandable. */
  files?: readonly FileDiff[]
  /**
   * The changed-files tree beside the diff, `--diff-tree-width` wide (13rem). `"collapsible"` adds a toggle
   * at the start of the toolbar to hide and show it. @defaultValue true
   */
  fileTree?: boolean | "collapsible"
  /** Whether a collapsible tree shows. */
  fileTreeOpen?: boolean
  defaultFileTreeOpen?: boolean
  onFileTreeOpenChange?: (open: boolean) => void
  /**
   * The files in sections, like the working tree's "Staged" and "Unstaged": each a `label` and its `files` or
   * `patch`, in order. The tree shows one section per group; the diff lists the groups one after another.
   */
  groups?: readonly GitDiffGroup[]
  /** The layout and wrap controls and the totals above the diff. @defaultValue true */
  toolbar?: boolean
  /**
   * `fill` (default) fills the height GitDiff is given, beside its file tree. `auto` grows to the whole diff, for a
   * diff inside a scrolling dialog body: the body is its one scroller, which the virtualizer follows, and the tree
   * beside it stays in view up to 40rem tall. A `--diff-max-height` caps both, and the diff scrolls inside past it.
   */
  height?: DiffViewProps["height"]
  /**
   * The file in view, for a file list or tree outside GitDiff: setting it scrolls the diff to that file, and
   * `onCurrentFileChange` reports the file at the top as the diff scrolls. The built-in tree follows it too.
   */
  currentFile?: string | null
  defaultCurrentFile?: string | null
}

/** A section of a GitDiff: its title in the file tree, and its files. */
type GitDiffGroup = { label: string; files?: readonly FileDiff[]; patch?: string }

const noGroups: readonly GitDiffGroup[] = []

// oxlint-disable-next-line shadcn/no-arbitrary-values -- a variable a page sets, with its default
const treeWidth = "w-[var(--diff-tree-width,13rem)]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the diff's cap when a page sets one, so the tree never outgrows it
const treeCap = "max-h-[var(--diff-max-height,40rem)]"

function useControlled<T>(value: T | undefined, initial: T, onChange?: (next: T) => void) {
  const [own, setOwn] = useState(initial)
  const current = value ?? own
  const set = (next: T) => {
    if (value === undefined) setOwn(next)
    onChange?.(next)
  }
  return [current, set] as const
}

/**
 * A patch or a list of file diffs, rendered for review: a header per file (rename, status, counts, collapse,
 * viewed), a tree of changed files to jump between them, unified or split layout and word wrap, all files and
 * lines in one virtualized scroller, j/k between hunks and n/p between files, line selection for comments, and
 * agent actions (openFile, nextHunk, previousHunk, markViewed, getHunk).
 */
function GitDiff({
  patch,
  files: given,
  groups,
  fileTree = true,
  fileTreeOpen,
  defaultFileTreeOpen = true,
  onFileTreeOpenChange,
  toolbar = true,
  labels = diffLabels,
  layout: layoutProp,
  defaultLayout = "unified",
  onLayoutChange,
  wrap: wrapProp,
  defaultWrap = false,
  onWrapChange,
  controller: controllerProp,
  height = "fill",
  currentFile: currentFileProp,
  defaultCurrentFile,
  onCurrentFileChange,
  className,
  ...props
}: GitDiffProps) {
  const sections = useMemo(
    () => (groups ?? noGroups).map((group) => group.files ?? (group.patch ? parsePatch(group.patch) : [])),
    [groups],
  )
  const diffs = useMemo(
    () => (groups ? sections.flat() : (given ?? (patch ? parsePatch(patch) : []))),
    [groups, sections, given, patch],
  )
  const files = useMemo(() => {
    const view = toViewFiles(diffs)
    if (!groups) return view
    const labelOf = sections.flatMap((list, index) => list.map(() => groups[index]?.label))
    return view.map((file, index) => ({ ...file, group: labelOf[index] }))
  }, [diffs, groups, sections])
  const treeGroups = useMemo(() => {
    if (!groups) return undefined
    const starts = sections.map((_, index) => sections.slice(0, index).reduce((sum, list) => sum + list.length, 0))
    return groups.map((group, index) => ({
      label: group.label,
      paths: files.slice(starts[index], (starts[index] ?? 0) + (sections[index]?.length ?? 0)).map((file) => file.path),
    }))
  }, [groups, sections, files])
  const [treeOpen, setTreeOpen] = useControlled(fileTreeOpen, defaultFileTreeOpen, onFileTreeOpenChange)
  const collapsible = fileTree === "collapsible" && toolbar
  const showTree = fileTree !== false && (files.length > 1 || groups !== undefined) && (!collapsible || treeOpen)
  const [own] = useState(createDiffViewController)
  const controller = controllerProp ?? own
  const [layout, setLayout] = useControlled<DiffLayout>(layoutProp, defaultLayout)
  const [wrap, setWrap] = useControlled(wrapProp, defaultWrap)
  const [ownCurrent, setOwnCurrent] = useState<string | null>(defaultCurrentFile ?? null)
  const current = currentFileProp === undefined ? ownCurrent : currentFileProp
  const known = useCallback((path: string) => files.some((file) => file.path === path), [files])
  const reported = useOpenCurrentFile(controller, current, known)
  const totals = useMemo(
    () =>
      diffs.reduce(
        (sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
        { additions: 0, deletions: 0 },
      ),
    [diffs],
  )
  return (
    <div
      data-slot="git-diff"
      data-height={height}
      className={cn("flex flex-col gap-items", height === "auto" ? "shrink-0" : "min-h-0", className)}
    >
      {toolbar ? (
        <div data-slot="git-diff-toolbar" className="flex flex-wrap items-center gap-items">
          {collapsible ? (
            <Toggle
              variant="outline"
              size="icon"
              aria-label={labels.files}
              pressed={treeOpen}
              onPressedChange={setTreeOpen}
              className="narrow:hidden"
            >
              <PanelLeftIcon aria-hidden="true" />
            </Toggle>
          ) : null}
          <DiffStat additions={totals.additions} deletions={totals.deletions} labels={labels} />
          <div className="ms-auto flex items-center gap-items">
            <SegmentedControl<DiffLayout>
              aria-label={labels.layout}
              value={layout}
              onValueChange={(next, details) => {
                if (next) controller.setLayout(next, details.event)
              }}
            >
              <SegmentedControlIndicator />
              <SegmentedControlItem value="unified">
                <RowsIcon aria-hidden="true" />
                {labels.unified}
              </SegmentedControlItem>
              <SegmentedControlItem value="split">
                <Columns2Icon aria-hidden="true" />
                {labels.split}
              </SegmentedControlItem>
            </SegmentedControl>
            <Toggle
              variant="outline"
              pressed={wrap}
              onPressedChange={(next, details) => controller.setWrap(next, details.event)}
            >
              <WrapTextIcon aria-hidden="true" />
              {labels.wrap}
            </Toggle>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-group">
        {showTree ? (
          <GitDiffTree
            files={files}
            groups={treeGroups}
            value={current}
            labels={labels}
            onOpen={(path) => controller.openFile(path)}
            className={cn(
              treeWidth,
              "shrink-0 narrow:hidden",
              height === "auto" && cn("sticky top-0 self-start", treeCap),
            )}
          />
        ) : null}
        <DiffView
          {...props}
          height={height}
          headers
          files={files}
          labels={labels}
          controller={controller}
          onCurrentFileChange={(path, details) => {
            reported(path)
            setOwnCurrent(path)
            onCurrentFileChange?.(path, details)
          }}
          layout={layout}
          onLayoutChange={(next, details) => {
            onLayoutChange?.(next, details)
            if (!details.canceled) setLayout(next)
          }}
          wrap={wrap}
          onWrapChange={(next, details) => {
            onWrapChange?.(next, details)
            if (!details.canceled) setWrap(next)
          }}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  )
}

export { createDiffViewController, GitDiff }
export type { DiffViewController, GitDiffGroup, GitDiffProps }
