import type { FileStatus } from "@/lib/diff-types"

type DiffLabels = {
  /** The whole diff, for agents and screen readers. */
  diff: string
  /** The grid of one file's lines. */
  changes: (path: string) => string
  added: (line: number) => string
  removed: (line: number) => string
  unchanged: (line: number) => string
  noNewline: string
  /** The button that shows the unchanged lines a gap hides. */
  expand: (count: number) => string
  /** The disclosure button of a file's header; its state is aria-expanded. */
  toggleFile: (path: string) => string
  viewed: string
  /** The viewed checkbox's accessible name. */
  markViewed: (path: string) => string
  status: Record<FileStatus, string>
  counts: (additions: number, deletions: number) => string
  renamedFrom: string
  /** Read by screen readers for a mode change. */
  modeChanged: (from: string, to: string) => string
  /** The short visible form of a mode change, in a header or the file tree. */
  modeChange: (from: string, to: string) => string
  /** In place of the counts, for a binary file. */
  binaryFile: string
  binary: string
  tooLarge: string
  unchangedFile: string
  identical: string
  loading: string
  layout: string
  unified: string
  split: string
  wrap: string
  files: string
  /** A group's count in the file tree, like "2 files" beside "Staged". */
  fileCount: (count: number) => string
  before: string
  after: string
}

const plural = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`

const diffLabels: DiffLabels = {
  diff: "Diff",
  changes: (path) => `Changes in ${path}`,
  added: (line) => `Added, line ${String(line)}`,
  removed: (line) => `Removed, line ${String(line)}`,
  unchanged: (line) => `Line ${String(line)}`,
  noNewline: "No newline at end of file",
  expand: (count) => `Expand ${plural(count, "line", "lines")}`,
  toggleFile: (path) => `Show changes in ${path}`,
  viewed: "Viewed",
  markViewed: (path) => `Viewed ${path}`,
  status: { added: "Added", deleted: "Deleted", modified: "Modified", renamed: "Renamed", copied: "Copied" },
  counts: (additions, deletions) =>
    `${plural(additions, "addition", "additions")}, ${plural(deletions, "deletion", "deletions")}`,
  renamedFrom: "renamed from",
  modeChanged: (from, to) => `Mode changed from ${from} to ${to}`,
  modeChange: (from, to) => `Mode ${from} → ${to}`,
  binaryFile: "Binary",
  binary: "Binary file not shown",
  tooLarge: "This diff is too large to show",
  unchangedFile: "No content changes",
  identical: "No changes",
  loading: "Comparing…",
  layout: "Layout",
  unified: "Unified",
  split: "Split",
  wrap: "Wrap lines",
  files: "Changed files",
  fileCount: (count) => plural(count, "file", "files"),
  before: "Before",
  after: "After",
}

const diffLabelsEs: DiffLabels = {
  diff: "Diferencias",
  changes: (path) => `Cambios en ${path}`,
  added: (line) => `Añadida, línea ${String(line)}`,
  removed: (line) => `Eliminada, línea ${String(line)}`,
  unchanged: (line) => `Línea ${String(line)}`,
  noNewline: "Sin salto de línea al final del archivo",
  expand: (count) => `Mostrar ${plural(count, "línea", "líneas")}`,
  toggleFile: (path) => `Mostrar cambios en ${path}`,
  viewed: "Revisado",
  markViewed: (path) => `Revisado ${path}`,
  status: { added: "Nuevo", deleted: "Eliminado", modified: "Modificado", renamed: "Renombrado", copied: "Copiado" },
  counts: (additions, deletions) =>
    `${plural(additions, "adición", "adiciones")}, ${plural(deletions, "eliminación", "eliminaciones")}`,
  renamedFrom: "renombrado desde",
  modeChanged: (from, to) => `Modo cambiado de ${from} a ${to}`,
  modeChange: (from, to) => `Modo ${from} → ${to}`,
  binaryFile: "Binario",
  binary: "Archivo binario no mostrado",
  tooLarge: "Estas diferencias son demasiado grandes para mostrarlas",
  unchangedFile: "Sin cambios de contenido",
  identical: "Sin cambios",
  loading: "Comparando…",
  layout: "Disposición",
  unified: "Unificada",
  split: "Dividida",
  wrap: "Ajustar líneas",
  files: "Archivos cambiados",
  fileCount: (count) => `${String(count)} ${count === 1 ? "archivo" : "archivos"}`,
  before: "Antes",
  after: "Después",
}

export { diffLabels, diffLabelsEs }
export type { DiffLabels }
