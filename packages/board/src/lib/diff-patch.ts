import type { DiffHunk, DiffLine, FileDiff } from "@/lib/diff-types"

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

// Spec: git quotes a path with unusual bytes as a C string: "a/caf\303\251.txt".
function unquote(path: string) {
  if (!path.startsWith('"')) return path
  const bytes: number[] = []
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, a: 7, v: 11, '"': 34, "\\": 92 }
  const encoder = new TextEncoder()
  for (let index = 1; index < path.length - 1; index++) {
    const char = path[index]!
    if (char !== "\\") {
      bytes.push(...encoder.encode(char))
      continue
    }
    const next = path[index + 1] ?? ""
    if (/[0-7]/.test(next)) {
      const octal = path.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)![0]
      bytes.push(Number.parseInt(octal, 8))
      index += octal.length
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0))
      index++
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function stripPrefix(path: string, prefixed: boolean) {
  if (!prefixed) return path
  return path.replace(/^[a-z]\//, "")
}

// Spec: `--- a/path\t2024-01-01 …`: a timestamp may follow a tab.
function headerPath(rest: string) {
  const value = rest.startsWith('"') ? rest.slice(0, rest.indexOf('"', 1) + 1) : rest.split("\t")[0]!.trimEnd()
  return value === "/dev/null" ? null : unquote(value)
}

// Spec: `diff --git a/x b/x`: with spaces in the name the two halves are equal.
function gitHeaderPaths(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('"', 1)
    const first = rest.slice(0, end + 1)
    return [unquote(first), unquote(rest.slice(end + 2))]
  }
  const quoted = rest.indexOf(' "')
  if (quoted > 0) return [rest.slice(0, quoted), unquote(rest.slice(quoted + 1))]
  const middle = (rest.length - 1) / 2
  if (Number.isInteger(middle) && rest[middle] === " ") return [rest.slice(0, middle), rest.slice(middle + 1)]
  const parts = rest.split(" ")
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null
}

function newFile(): FileDiff {
  return {
    oldPath: null,
    newPath: null,
    status: "modified",
    binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  }
}

function finish(file: FileDiff, prefixed: boolean, fallback: [string, string] | null) {
  if (fallback) {
    const [oldPath, newPath] = fallback.map((path) => stripPrefix(path, prefixed))
    if (file.oldPath === null && file.status !== "added") file.oldPath = oldPath ?? null
    if (file.newPath === null && file.status !== "deleted") file.newPath = newPath ?? null
  }
  if (file.status === "modified" && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    file.status = "renamed"
  }
  if (file.status === "added") file.oldPath = null
  if (file.status === "deleted") file.newPath = null
  return file
}

/**
 * Parses a unified diff, as `git diff`, `git show` or `git format-patch` print it, or a plain `diff -u`: every file
 * with its paths, status (added, deleted, modified, renamed, copied), modes, similarity, binary flag and hunks.
 * Anything before the first file (a commit message, mail headers) is skipped.
 */
function parsePatch(patch: string): FileDiff[] {
  const lines = patch.split("\n")
  const files: FileDiff[] = []
  let file: FileDiff | null = null
  let prefixed = true
  let gitPaths: [string, string] | null = null
  let index = 0

  const close = () => {
    if (file) files.push(finish(file, prefixed, gitPaths))
    file = null
    gitPaths = null
  }

  while (index < lines.length) {
    let line = lines[index]!
    if (line.endsWith("\r")) line = line.slice(0, -1)
    if (line.startsWith("diff --git ")) {
      close()
      file = newFile()
      gitPaths = gitHeaderPaths(line.slice("diff --git ".length))
      prefixed = gitPaths !== null && /^[a-z]\//.test(gitPaths[0]) && /^[a-z]\//.test(gitPaths[1])
      index++
      continue
    }
    if (line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      close()
      index++
      continue
    }
    if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      const current: FileDiff = file ?? newFile()
      if (!file) {
        close()
        file = current
        prefixed = /^"?[a-z]\//.test(line.slice(4)) && /^"?[a-z]\//.test(lines[index + 1]!.slice(4))
      }
      const oldPath = headerPath(line.slice(4).replace(/\r$/, ""))
      const newPath = headerPath(lines[index + 1]!.slice(4).replace(/\r$/, ""))
      current.oldPath = oldPath === null ? null : stripPrefix(oldPath, prefixed)
      current.newPath = newPath === null ? null : stripPrefix(newPath, prefixed)
      if (oldPath === null) current.status = "added"
      if (newPath === null) current.status = "deleted"
      index += 2
      continue
    }
    const header = hunkHeader.exec(line)
    if (header && file) {
      index = readHunk(lines, index, header, file)
      continue
    }
    if (file) readExtended(line, file)
    index++
  }
  close()
  return files
}

function readExtended(line: string, file: FileDiff) {
  const value = (prefix: string) => line.slice(prefix.length)
  if (line.startsWith("new file mode ")) {
    file.status = "added"
    file.newMode = value("new file mode ")
  } else if (line.startsWith("deleted file mode ")) {
    file.status = "deleted"
    file.oldMode = value("deleted file mode ")
  } else if (line.startsWith("old mode ")) file.oldMode = value("old mode ")
  else if (line.startsWith("new mode ")) file.newMode = value("new mode ")
  else if (line.startsWith("rename from ")) {
    file.status = "renamed"
    file.oldPath = unquote(value("rename from "))
  } else if (line.startsWith("rename to ")) file.newPath = unquote(value("rename to "))
  else if (line.startsWith("copy from ")) {
    file.status = "copied"
    file.oldPath = unquote(value("copy from "))
  } else if (line.startsWith("copy to ")) file.newPath = unquote(value("copy to "))
  else if (line.startsWith("similarity index ")) file.similarity = Number.parseInt(value("similarity index "), 10)
  else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true
  else if (line.startsWith("index ")) {
    const mode = /^index \S+ (\d+)$/.exec(line)?.[1]
    if (mode) {
      file.oldMode ??= mode
      file.newMode ??= mode
    }
  }
}

function readHunk(lines: string[], start: number, header: RegExpExecArray, file: FileDiff) {
  const hunk: DiffHunk = {
    oldStart: Number(header[1]),
    oldLines: header[2] === undefined ? 1 : Number(header[2]),
    newStart: Number(header[3]),
    newLines: header[4] === undefined ? 1 : Number(header[4]),
    lines: [],
  }
  if (header[5]) hunk.heading = header[5]
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  let oldLeft = hunk.oldLines
  let newLeft = hunk.newLines
  let index = start + 1
  let last: DiffLine | undefined
  // Spec: the counts, not the markers, say where a hunk ends: a removed line can begin with "--".
  while (index < lines.length && (oldLeft > 0 || newLeft > 0 || lines[index]!.startsWith("\\"))) {
    let raw = lines[index]!
    if (raw.endsWith("\r")) raw = raw.slice(0, -1)
    const marker = raw[0]
    const text = raw.slice(1)
    if (marker === "\\") {
      if (last) last.noNewline = true
      index++
      continue
    }
    if (oldLeft <= 0 && newLeft <= 0) break
    if (marker === "+") {
      last = { kind: "added", text, newLine: newLine++ }
      newLeft--
      file.additions++
    } else if (marker === "-") {
      last = { kind: "removed", text, oldLine: oldLine++ }
      oldLeft--
      file.deletions++
    } else if (marker === " " || raw === "") {
      last = { kind: "context", text, oldLine: oldLine++, newLine: newLine++ }
      oldLeft--
      newLeft--
    } else break
    hunk.lines.push(last)
    index++
  }
  file.hunks.push(hunk)
  return index
}

function range(start: number, count: number) {
  return count === 1 ? String(start) : `${String(start)},${String(count)}`
}

/** Writes hunks back as unified-diff text, `@@` headers included, the way git prints them. */
function formatHunks(hunks: readonly DiffHunk[]) {
  const out: string[] = []
  for (const hunk of hunks) {
    const heading = hunk.heading ? ` ${hunk.heading}` : ""
    out.push(`@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@${heading}`)
    for (const line of hunk.lines) {
      out.push((line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ") + line.text)
      if (line.noNewline) out.push("\\ No newline at end of file")
    }
  }
  return out.join("\n")
}

export { formatHunks, parsePatch }
