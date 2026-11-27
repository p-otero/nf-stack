import type { Tone } from "@/lib/tone"

type GitFileStatus = "added" | "modified" | "deleted" | "renamed"

/** A file in the tree; `status` marks it changed, and a rename says where it came `from`. */
type GitTreeFile = { path: string; status?: GitFileStatus; from?: string }

const gitStatusTones: Record<GitFileStatus, Tone> = {
  added: "success",
  modified: "warning",
  deleted: "destructive",
  renamed: "info",
}

function parentsOf(path: string) {
  const parents: string[] = []
  for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) parents.push(path.slice(0, at))
  return parents
}

type GitTreeIndex = {
  paths: string[]
  status: ReadonlyMap<string, GitTreeFile>
  /** Folders with a changed file anywhere inside them. */
  changedFolders: ReadonlySet<string>
}

/** The tree's paths, each changed file by path, and every folder that holds a change: O(files + changes × depth). */
function indexGitFiles(files: readonly (string | GitTreeFile)[]): GitTreeIndex {
  const paths: string[] = []
  const status = new Map<string, GitTreeFile>()
  const changedFolders = new Set<string>()
  for (const file of files) {
    if (typeof file === "string") {
      paths.push(file)
      continue
    }
    paths.push(file.path)
    if (!file.status) continue
    status.set(file.path, file)
    for (const folder of parentsOf(file.path)) changedFolders.add(folder)
  }
  return { paths, status, changedFolders }
}

export { gitStatusTones, indexGitFiles, parentsOf }
export type { GitFileStatus, GitTreeFile, GitTreeIndex }
