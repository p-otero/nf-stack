type DiffLineKind = "context" | "added" | "removed"

/** One line of a diff. `oldLine` and `newLine` count from 1; a removed line has no `newLine`, an added one no `oldLine`. */
type DiffLine = {
  kind: DiffLineKind
  text: string
  oldLine?: number
  newLine?: number
  /** The line is the last of its side and that side doesn't end with a newline. */
  noNewline?: true
}

type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** The text after the second `@@`, usually the enclosing function. */
  heading?: string
  lines: DiffLine[]
}

/**
 * - `histogram` (default): anchors on lines that are rare in both sides, so moved blocks and braces don't pair up
 *   by accident; the most readable for code. Falls back to Myers where nothing is rare.
 * - `myers`: the shortest edit script, as `diff` and `git diff --minimal` give.
 */
type DiffAlgorithm = "histogram" | "myers"

/** `all` ignores every space and tab, `change` treats runs of whitespace as one, `trailing` ignores it at line ends. */
type IgnoreWhitespace = "none" | "all" | "change" | "trailing"

type DiffOptions = {
  algorithm?: DiffAlgorithm
  /** Unchanged lines kept around each change. @defaultValue 3 */
  context?: number
  ignoreWhitespace?: IgnoreWhitespace
  /** Past this many lines on either side the diff isn't computed (`status: "too-large"`). @defaultValue 200000 */
  maxLines?: number
  /** Past this many characters on either side the diff isn't computed. @defaultValue 20000000 */
  maxChars?: number
  /**
   * How many edit steps Myers searches before it settles for a good split instead of the best one, so two
   * unrelated files can't take quadratic time. @defaultValue 1024 or more for long inputs
   */
  maxCost?: number
}

type DiffStatus = "ok" | "binary" | "too-large"

type TextDiff = {
  status: DiffStatus
  hunks: DiffHunk[]
  additions: number
  deletions: number
  oldLineCount: number
  newLineCount: number
}

type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied"

type FileDiff = {
  /** `null` for a new file. */
  oldPath: string | null
  /** `null` for a deleted file. */
  newPath: string | null
  status: FileStatus
  binary: boolean
  /** The diff was too large to compute or was left out of the patch. */
  tooLarge?: boolean
  oldMode?: string
  newMode?: string
  /** A rename's or copy's similarity, 0 to 100. */
  similarity?: number
  hunks: DiffHunk[]
  additions: number
  deletions: number
  /** Both sides' full text, when known: the unchanged lines between hunks can then be expanded. */
  oldText?: string
  newText?: string
}

/** Character ranges `[start, end)` of a line that changed against its counterpart. */
type IntralineRanges = readonly (readonly [number, number])[]

type IntralineMode = "word" | "char"

export type {
  DiffAlgorithm,
  DiffHunk,
  DiffLine,
  DiffLineKind,
  DiffOptions,
  DiffStatus,
  FileDiff,
  FileStatus,
  IgnoreWhitespace,
  IntralineMode,
  IntralineRanges,
  TextDiff,
}
