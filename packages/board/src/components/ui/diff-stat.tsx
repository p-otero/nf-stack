import type { DiffLabels } from "@/components/ui/diff-labels"
import type { FileDiff } from "@/lib/diff-types"
import { cn } from "@/lib/utils"

const BLOCKS = 5

/** How many of the five blocks are added and removed: one per line under five lines, else in proportion. */
function blocks(additions: number, deletions: number) {
  const total = additions + deletions
  if (total <= BLOCKS) return { added: additions, removed: deletions }
  let added = Math.round((additions / total) * BLOCKS)
  if (additions > 0) added = Math.max(1, added)
  if (deletions > 0) added = Math.min(BLOCKS - 1, added)
  return { added, removed: BLOCKS - added }
}

/**
 * `+12 −3` and a five-block bar of the lines added and removed. Screen readers hear the counts in words
 * (`labels.counts`); the signs and the bar are hidden from them, and the numbers stay visible beside the bar.
 */
function DiffStat({
  additions,
  deletions,
  labels,
  bar = true,
  className,
}: {
  additions: number
  deletions: number
  labels: DiffLabels
  bar?: boolean
  className?: string
}) {
  const { added, removed } = blocks(additions, deletions)
  return (
    <span
      data-slot="diff-stat"
      className={cn("inline-flex shrink-0 items-center gap-inline font-mono text-caption", className)}
    >
      <span className="sr-only">{labels.counts(additions, deletions)}</span>
      <span aria-hidden="true" className="text-diff-added-foreground">
        +{additions}
      </span>
      <span aria-hidden="true" className="text-diff-removed-foreground">
        −{deletions}
      </span>
      {bar ? (
        <span aria-hidden="true" data-slot="diff-stat-bar" className="inline-flex gap-px">
          {Array.from({ length: BLOCKS }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-2 rounded-xs",
                index < added
                  ? "bg-diff-added-foreground"
                  : index < added + removed
                    ? "bg-diff-removed-foreground"
                    : "bg-border",
              )}
            />
          ))}
        </span>
      ) : null}
    </span>
  )
}

function modeChange(diff: FileDiff) {
  const { oldMode, newMode } = diff
  return oldMode && newMode && oldMode !== newMode ? { from: oldMode, to: newMode } : null
}

function ModeLabel({ from, to, labels }: { from: string; to: string; labels: DiffLabels }) {
  return (
    <span data-slot="diff-mode" className="shrink-0 font-mono text-caption text-muted-foreground">
      <span aria-hidden="true">{labels.modeChange(from, to)}</span>
      <span className="sr-only">{labels.modeChanged(from, to)}</span>
    </span>
  )
}

/**
 * What changed in a file, in the space its counts take: "Binary" for a binary file, the mode change for one that
 * only changed mode, nothing for a rename without changes, and otherwise the counts (and a mode change beside them).
 * `+0 −0` would read as "nothing changed" for a file that did change.
 */
function FileChange({ diff, labels, bar = true }: { diff: FileDiff; labels: DiffLabels; bar?: boolean }) {
  const mode = modeChange(diff)
  if (diff.binary) {
    return (
      <span data-slot="diff-binary" className="shrink-0 text-caption text-muted-foreground">
        {labels.binaryFile}
      </span>
    )
  }
  if (diff.hunks.length === 0 && !diff.tooLarge) {
    return mode ? <ModeLabel from={mode.from} to={mode.to} labels={labels} /> : null
  }
  return (
    <>
      {mode ? <ModeLabel from={mode.from} to={mode.to} labels={labels} /> : null}
      <DiffStat additions={diff.additions} deletions={diff.deletions} labels={labels} bar={bar} />
    </>
  )
}

export { DiffStat, FileChange }
