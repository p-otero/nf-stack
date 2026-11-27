import { createChange, definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { parentsOf } from "@/lib/git-status"

type GitTreeChangeReason = "item-press" | "trigger-press" | "list-navigation" | "find-in-page" | "imperative"

/** How the primitive reads the tree without a copy of every path. */
type GitTreeLookup = {
  kind: (path: string) => "file" | "folder" | undefined
  /** Every path as agents list them: the path, and the row's name with its status. */
  entries: () => readonly { value: string; label: string }[]
}

type GitTreeOptions = {
  lookup?: GitTreeLookup
  expanded?: readonly string[]
  defaultExpanded?: readonly string[]
  onExpandedChange?: (expanded: string[], details: ChangeDetails<GitTreeChangeReason>) => void
  onOpenFile?: (path: string, details: ChangeDetails<GitTreeChangeReason>) => void
}

function reasonOf(options: unknown): { reason: GitTreeChangeReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<GitTreeChangeReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const gitTree = definePrimitive({
  name: "git-tree",
  options: {
    lookup: "value",
    expanded: "list",
    defaultExpanded: "list",
    onExpandedChange: "callback",
    onOpenFile: "callback",
  },
  state: (options: GitTreeOptions) => ({ expanded: [...(options.expanded ?? options.defaultExpanded ?? [])] }),
  sync: (options) => (options.expanded === undefined ? {} : { expanded: [...options.expanded] }),
  controlled: ["expanded"],
  api: (context) => {
    const change = createChange(context)
    // The agent bridge passes arguments unchecked.
    const check = (path: unknown, kind?: "file" | "folder") => {
      const found = typeof path === "string" ? context.options().lookup?.kind(path) : undefined
      if (!found || typeof path !== "string") throw new RangeError(`No path "${String(path)}" in the tree.`)
      if (kind && found !== kind) throw new RangeError(`"${path}" is a ${found}, not a ${kind}.`)
      return path
    }
    const setExpanded = (next: string[], options?: unknown, action = "setExpanded") =>
      settled(change("expanded", next, reasonOf(options)), action, reasonOf(options))
    const api = {
      setExpanded(expanded: readonly string[], options?: ChangeOptions<GitTreeChangeReason>) {
        return setExpanded([...expanded], options)
      },
      /** Opens a folder with its parents, or a file through `onOpenFile`, opening the folders it is in first. */
      open(path: string, options?: ChangeOptions<GitTreeChangeReason>) {
        const target = check(path)
        const kind = context.options().lookup?.kind(target)
        if (kind === "folder") return api.expand(target, options)
        const { expanded } = context.store.get()
        const missing = parentsOf(target).filter((folder) => !expanded.includes(folder))
        if (missing.length > 0 && !setExpanded([...expanded, ...missing], options, "open")) return false
        if (!context.options().onOpenFile) throw new Error("This tree doesn't open files.")
        return settled(!dispatch(context, "onOpenFile", target, reasonOf(options)), "open", reasonOf(options))
      },
      expand(path: string, options?: ChangeOptions<GitTreeChangeReason>) {
        const folder = check(path, "folder")
        const { expanded } = context.store.get()
        const missing = [...parentsOf(folder), folder].filter((open) => !expanded.includes(open))
        return missing.length === 0 ? true : setExpanded([...expanded, ...missing], options, "expand")
      },
      collapse(path: string, options?: ChangeOptions<GitTreeChangeReason>) {
        const folder = check(path, "folder")
        const { expanded } = context.store.get()
        return expanded.includes(folder)
          ? setExpanded(
              expanded.filter((open) => open !== folder),
              options,
              "collapse",
            )
          : true
      },
      paths: () => context.options().lookup?.entries() ?? [],
    }
    return api
  },
  slots: (slot) => ({ root: slot({ role: "region" }) }),
  agent: { actions: ["open", "expand", "collapse"], items: (api) => api.paths() },
})

export { gitTree }
export type { GitTreeChangeReason, GitTreeLookup, GitTreeOptions }
