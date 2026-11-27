import type { DiffRow } from "@/components/ui/diff-view-model"

/** Row heights in px. Rows aren't measured while lines don't wrap: each measurement lays the page out. */
type DiffMetrics = { line: number; gap: number; header: number; notice: number }

const defaultMetrics: DiffMetrics = { line: 20, gap: 36, header: 58, notice: 36 }

// Row heights the theme gives, read once per viewport: a file header holds an icon button between two inline gaps and
// two borders, after a gap from the file above; gap and notice rows fit a small button.
const heights = {
  header: "calc(var(--control-height) + 2 * var(--gap-inline) + 2px + var(--gap-items))",
  gap: "calc(max(var(--control-height-sm), 1lh) + 4px)",
}

function probe(el: HTMLElement, height: string) {
  const node = el.ownerDocument.createElement("div")
  node.style.cssText = `position:absolute;visibility:hidden;height:${height}`
  el.append(node)
  const value = node.getBoundingClientRect().height
  node.remove()
  return value
}

function readMetrics(el: HTMLElement): DiffMetrics {
  const line = Number.parseFloat(getComputedStyle(el).lineHeight)
  const gap = probe(el, heights.gap)
  const header = probe(el, heights.header)
  return {
    line: line > 0 ? line : defaultMetrics.line,
    gap: gap > 0 ? gap : defaultMetrics.gap,
    header: header > 0 ? header : defaultMetrics.header,
    notice: gap > 0 ? gap : defaultMetrics.notice,
  }
}

function sameMetrics(a: DiffMetrics, b: DiffMetrics) {
  return a.line === b.line && a.gap === b.gap && a.header === b.header && a.notice === b.notice
}

function rowHeight(metrics: DiffMetrics, row: DiffRow | undefined) {
  if (row?.kind === "file") return metrics.header
  if (row?.kind === "gap") return metrics.gap
  if (row?.kind === "notice") return metrics.notice
  return metrics.line
}

export { defaultMetrics, readMetrics, rowHeight, sameMetrics }
export type { DiffMetrics }
