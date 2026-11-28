import { CheckIcon } from "lucide-react"
import { memo } from "react"

import type { LaneRow } from "@/lib/commit-lanes"
import { cn, cssVars } from "@/lib/utils"

type CommitNodeKind = "commit" | "branch" | "pending"

type CommitGraphCellProps = {
  row: LaneRow
  node: CommitNodeKind
  /** The node just stopped being pending: it grows into its check. */
  finished?: boolean
  /** Lanes that opened because their merge was just expanded draw in. */
  drawIn?: boolean
}

// Workaround: Chrome doesn't repaint a stretched SVG's non-scaling strokes when the row resizes, which left gaps
// between rows, so only curves are SVG (in the default theme's 14 by 30 cell) and straight runs are boxes.
const LANE = 14
const LINE = 30
const x = (lane: number) => (lane + 0.5) * LANE

const MID = LINE / 2

function intoCurve(from: number, node: number) {
  const [a, b] = [String(x(from)), String(x(node))]
  return `M${a} 0C${a} ${String(MID * 0.6)} ${b} ${String(MID * 0.4)} ${b} ${String(MID)}`
}

function outCurve(node: number, to: number) {
  const [a, b] = [String(x(node)), String(x(to))]
  return `M${a} ${String(MID)}C${a} ${String(MID * 1.6)} ${b} ${String(MID * 1.4)} ${b} ${String(LINE)}`
}

type Run = { lane: number; from: "top" | "middle" | "line"; to: "middle" | "bottom"; tag: number }

const runFrom = { top: "top-0", middle: "top-[calc(var(--commit-line)/2)]", line: "top-(--commit-line)" }
const runTo = { middle: "bottom-[calc(100%-var(--commit-line)/2)]", bottom: "bottom-0" }

function runsOf({ lane, into, out, through, tagsTop, tagsBottom }: LaneRow): Run[] {
  const runs: Run[] = through.map((at) => ({ lane: at, from: "top", to: "bottom", tag: tagsTop[at] ?? 0 }))
  if (into.includes(lane)) runs.push({ lane, from: "top", to: "middle", tag: tagsTop[lane] ?? 0 })
  for (const to of out) {
    const tag = tagsBottom[to] ?? 0
    runs.push(to === lane ? { lane, from: "middle", to: "bottom", tag } : { lane: to, from: "line", to: "bottom", tag })
  }
  return runs
}

const laneColors: Record<number, string> = {
  0: "text-link",
  1: "text-chart-1",
  2: "text-chart-2",
  3: "text-chart-3",
  4: "text-chart-4",
  5: "text-chart-5",
  10: "text-muted-foreground",
  11: "text-info",
  12: "text-success",
  13: "text-warning",
  14: "text-destructive",
  15: "text-violet",
}

function laneColor(tag: number) {
  return laneColors[tag] ?? "text-link"
}

const drawInClassName = "transition-opacity duration-panel ease-standard starting:opacity-0"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- a 1.5px stroke matches the lane boxes beside the curves
const curveClassName = "fill-none stroke-current stroke-[1.5]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the graph is as wide as its lanes, each --commit-lane wide
const graphClassName = "w-[calc(var(--commit-lane)*var(--lanes))]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- a 1.5px run centred on its lane, like the curves' stroke
const runClassName = "start-[calc(var(--commit-lane)*(var(--at)+0.5)-0.75px)] w-[1.5px]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the node sits in its lane's cell
const nodeCellClassName = "start-[calc(var(--commit-lane)*var(--lane))]"
// oxlint-disable-next-line shadcn/no-arbitrary-values -- the "+N" of lanes not drawn takes the columns after the last drawn lane
const moreClassName = "start-[calc(var(--commit-lane)*var(--drawn))] w-[calc(var(--commit-lane)*2)]"

const nodeClassNames: Record<CommitNodeKind, string> = {
  commit: "size-3.5 bg-info-soft outline-2 outline-card",
  branch: "size-1.5 bg-current outline-2 outline-card",
  pending:
    "size-3 border-[1.5px] border-current border-e-transparent bg-card animate-spin motion-reduce:animate-none motion-reduce:border-e-current",
}

/** A row's lanes, plus two for "+N" when some aren't drawn. */
function graphColumns(row: LaneRow) {
  return row.width + (row.hidden > 0 || row.nodeHidden ? 2 : 0)
}

/** Lanes past the row's cap show as "+N". Decorative: the row's name says what the graph shows. */
const CommitGraphCell = memo(function CommitGraphCell({ row, node, finished, drawIn }: CommitGraphCellProps) {
  const { lane, width, into, out, tagsTop, tagsBottom, hidden, nodeHidden } = row
  const curvesIn = into.filter((from) => from !== lane)
  const curvesOut = out.filter((to) => to !== lane)
  const more = hidden > 0 || nodeHidden
  const style = cssVars({ "--lanes": graphColumns(row), "--lane": nodeHidden ? width : lane, "--drawn": width })
  return (
    <span
      aria-hidden="true"
      data-slot="commit-graph"
      style={style}
      className={cn("pointer-events-none absolute inset-y-0 start-0", graphClassName)}
    >
      {runsOf(row).map((run) => (
        <span
          key={`${String(run.lane)}${run.from}`}
          data-slot="commit-lane"
          data-tag={run.tag}
          style={cssVars({ "--at": run.lane })}
          className={cn(
            "absolute bg-current",
            laneColor(run.tag),
            runClassName,
            runFrom[run.from],
            runTo[run.to],
            run.from === "line" && drawIn && drawInClassName,
          )}
        />
      ))}
      {(curvesIn.length > 0 || curvesOut.length > 0) && (
        // oxlint-disable-next-line eskais/no-inline-icons -- the commit graph's curves, not an icon
        <svg
          viewBox={`0 0 ${String(graphColumns(row) * LANE)} ${String(LINE)}`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 top-0 h-(--commit-line) w-full overflow-visible rtl:-scale-x-100"
        >
          {curvesIn.map((from) => (
            <path
              key={`i${String(from)}`}
              d={intoCurve(from, lane)}
              className={cn(curveClassName, laneColor(tagsTop[from] ?? 0))}
            />
          ))}
          {curvesOut.map((to) => (
            <path
              key={`o${String(to)}`}
              d={outCurve(lane, to)}
              className={cn(curveClassName, laneColor(tagsBottom[to] ?? 0), drawIn && drawInClassName)}
            />
          ))}
        </svg>
      )}
      {more && (
        <span
          data-slot="commit-graph-more"
          className={cn(
            "absolute top-0 flex h-(--commit-line) items-center justify-end font-mono text-caption text-muted-foreground tabular-nums",
            moreClassName,
          )}
        >
          +{hidden}
        </span>
      )}
      <span
        className={cn(
          "absolute top-0 flex h-(--commit-line) w-(--commit-lane) items-center justify-center",
          nodeCellClassName,
          laneColor(row.tag),
        )}
      >
        <span
          data-slot="commit-node"
          data-node={node}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full",
            nodeClassNames[node],
            finished && "transition duration-panel ease-standard starting:scale-50 starting:opacity-0",
          )}
        >
          {node === "commit" && <CheckIcon className="size-2.5" strokeWidth={3} />}
        </span>
      </span>
    </span>
  )
})

export { CommitGraphCell, graphColumns, laneColor }
export type { CommitGraphCellProps, CommitNodeKind }
