import {
  createChange,
  createController,
  definePrimitive,
  dispatch,
  type ChangeDetails,
  type ChangeOptions,
} from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"

type CommitHistoryChangeReason = "item-press" | "trigger-press" | "list-navigation" | "imperative"

type CommitLookupEntry = { id: string; hash: string; subject: string; merge: boolean }

/** How the primitive finds commits without holding a copy of a long history. */
type CommitLookup = {
  /** A commit by id, hash (or a prefix of 4 or more characters) or exact subject. */
  find: (ref: string) => CommitLookupEntry | undefined
  /** Every commit as agents list them: the id and the row's accessible name. Built on demand. */
  entries: () => readonly { value: string; label: string }[]
  /** The branches beside the base, as `listBranches` gives them. */
  branches?: () => readonly CommitBranchSummary[]
}

/** A branch as agents read it: where its head is and how far it is from the base. */
type CommitBranchSummary = {
  name: string
  head: string
  ahead: number
  behind: number
  updatedAt: string | undefined
  state: "base" | "active" | "merged" | "stale"
}

type CommitHistoryOptions = {
  lookup?: CommitLookup
  /** A working-tree row sits above the commits, selectable as `WORKING_TREE`. */
  workingTree?: boolean
  /** Open merges, by id. */
  expanded?: readonly string[]
  defaultExpanded?: readonly string[]
  onExpandedChange?: (expanded: string[], details: ChangeDetails<CommitHistoryChangeReason>) => void
  /** The selected commit's id, `null` for none. Selection is on once one of these three is given. */
  selected?: string | null
  defaultSelected?: string | null
  onSelectedChange?: (id: string | null, details: ChangeDetails<CommitHistoryChangeReason>) => void
  /** Commits whose details show under their row. */
  details?: readonly string[]
  defaultDetails?: readonly string[]
  onDetailsChange?: (open: string[], details: ChangeDetails<CommitHistoryChangeReason>) => void
  /** `"single"` (default) closes the open details when others open. */
  detailsMode?: "single" | "multiple"
  branch?: string
  branches?: readonly string[]
  onBranchChange?: (branch: string, details: ChangeDetails<CommitHistoryChangeReason>) => void
  onOpenCommit?: (id: string, details: ChangeDetails<CommitHistoryChangeReason>) => void
  onCopyHash?: (hash: string, details: ChangeDetails<"copy"> & { id: string }) => void
  /** The branch in focus in the branches view: its head scrolled to and focused, and filtered to with `filterBranch`. */
  focusedBranch?: string | null
  onFocusedBranchChange?: (branch: string | null, details: ChangeDetails<CommitHistoryChangeReason>) => void
  controller?: CommitHistoryController
}

interface CommitHistoryController {
  select: (ref: string | null, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  expand: (ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  collapse: (ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  expandDetails: (ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  collapseDetails: (ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  openCommit: (ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  selectBranch: (name: string, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
  focusBranch: (name: string | null, options?: ChangeOptions<CommitHistoryChangeReason>) => boolean | undefined
}

const COPIED_FOR = 2000

/** The id of the working-tree row, for `selected`, `onSelect` and `select`. No commit id can take it. */
const WORKING_TREE = "working-tree"

function reasonOf(options: unknown): { reason: CommitHistoryChangeReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<CommitHistoryChangeReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const list = (value: readonly string[] | undefined) => (value ? [...value] : undefined)

const commitHistory = definePrimitive({
  name: "commit-history",
  options: {
    lookup: "value",
    workingTree: "boolean",
    expanded: "list",
    defaultExpanded: "list",
    onExpandedChange: "callback",
    selected: "value",
    defaultSelected: "value",
    onSelectedChange: "callback",
    details: "list",
    defaultDetails: "list",
    onDetailsChange: "callback",
    detailsMode: "string",
    branch: "string",
    branches: "list",
    onBranchChange: "callback",
    onOpenCommit: "callback",
    onCopyHash: "callback",
    focusedBranch: "value",
    onFocusedBranchChange: "callback",
    controller: "value",
  },
  state: (options: CommitHistoryOptions) => ({
    expanded: list(options.expanded ?? options.defaultExpanded) ?? [],
    details: list(options.details ?? options.defaultDetails) ?? [],
    selected: options.selected ?? options.defaultSelected ?? null,
    branch: options.branch ?? null,
    focusedBranch: options.focusedBranch ?? null,
    copied: null as string | null,
  }),
  sync: (options) => ({
    ...(options.expanded === undefined ? {} : { expanded: [...options.expanded] }),
    ...(options.details === undefined ? {} : { details: [...options.details] }),
    ...(options.selected === undefined ? {} : { selected: options.selected }),
    ...(options.branch === undefined ? {} : { branch: options.branch }),
    ...(options.focusedBranch === undefined ? {} : { focusedBranch: options.focusedBranch }),
  }),
  controlled: ["expanded", "details", "selected", "branch", "focusedBranch"],
  api: (context) => {
    const change = createChange(context)
    let timer: ReturnType<typeof setTimeout> | undefined
    context.onDestroy(() => clearTimeout(timer))

    // The agent bridge passes arguments unchecked.
    const find = (ref: unknown) => {
      const entry = typeof ref === "string" ? context.options().lookup?.find(ref) : undefined
      if (!entry) throw new RangeError(`No commit "${String(ref)}". Pass a commit's id, hash or subject.`)
      return entry
    }
    const findMerge = (ref: unknown, action: string) => {
      const entry = find(ref)
      if (!entry.merge) throw new RangeError(`"${entry.subject}" has no merged commits to ${action}.`)
      return entry
    }
    const changeKey = (key: "expanded" | "details", next: string[], action: string, options?: unknown) =>
      settled(change(key, next, reasonOf(options)), action, reasonOf(options))
    const setExpanded = (next: string[], options?: unknown, action = "setExpanded") =>
      changeKey("expanded", next, action, options)
    const setDetails = (next: string[], options?: unknown, action = "setDetails") =>
      changeKey("details", next, action, options)

    const selectable = () => {
      const { selected, defaultSelected, onSelectedChange } = context.options()
      return selected !== undefined || defaultSelected !== undefined || onSelectedChange !== undefined
    }

    const api = {
      /** Selects a commit by id, hash or subject; `null` clears the selection. */
      select(ref: string | null, options?: ChangeOptions<CommitHistoryChangeReason>) {
        if (!selectable()) throw new Error("This history doesn't select commits; pass selected or onSelect.")
        const id =
          ref === null ? null : ref === WORKING_TREE && context.options().workingTree ? WORKING_TREE : find(ref).id
        if (context.store.get().selected === id) return true
        return settled(change("selected", id, reasonOf(options)), "select", reasonOf(options))
      },
      setExpanded(expanded: readonly string[], options?: ChangeOptions<CommitHistoryChangeReason>) {
        return setExpanded([...expanded], options)
      },
      expand(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = findMerge(ref, "expand")
        const { expanded } = context.store.get()
        return expanded.includes(id) ? true : setExpanded([...expanded, id], options, "expand")
      },
      collapse(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = findMerge(ref, "collapse")
        const { expanded } = context.store.get()
        return expanded.includes(id)
          ? setExpanded(
              expanded.filter((open) => open !== id),
              options,
              "collapse",
            )
          : true
      },
      expandDetails(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = find(ref)
        const { details } = context.store.get()
        if (details.includes(id)) return true
        return setDetails(
          context.options().detailsMode === "multiple" ? [...details, id] : [id],
          options,
          "expandDetails",
        )
      },
      collapseDetails(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = find(ref)
        const { details } = context.store.get()
        return details.includes(id)
          ? setDetails(
              details.filter((open) => open !== id),
              options,
              "collapseDetails",
            )
          : true
      },
      toggleDetails(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = find(ref)
        return context.store.get().details.includes(id)
          ? api.collapseDetails(id, options)
          : api.expandDetails(id, options)
      },
      toggle(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = findMerge(ref, "expand")
        return context.store.get().expanded.includes(id) ? api.collapse(id, options) : api.expand(id, options)
      },
      openCommit(ref: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { id } = find(ref)
        if (!context.options().onOpenCommit) throw new Error("This history doesn't open commits; use expandDetails.")
        return settled(!dispatch(context, "onOpenCommit", id, reasonOf(options)), "openCommit", reasonOf(options))
      },
      /** Copies the commit's hash where the page has clipboard access, and returns it either way. */
      async copyHash(ref: string, event?: Event) {
        const { id, hash } = find(ref)
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
        let copied = false
        if (clipboard) {
          try {
            await clipboard.writeText(hash)
            copied = true
          } catch {
            copied = false
          }
        }
        if (copied) {
          clearTimeout(timer)
          context.store.set({ copied: id })
          timer = setTimeout(() => context.store.set({ copied: null }), COPIED_FOR)
          dispatch(context, "onCopyHash", hash, { reason: "copy", event, id })
        }
        return hash
      },
      selectBranch(name: string, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const { branches = [], onBranchChange } = context.options()
        if (!onBranchChange) throw new Error("This history shows one branch.")
        if (typeof name !== "string" || !branches.includes(name)) {
          throw new RangeError(`No branch "${String(name)}". Branches: ${branches.join(", ")}.`)
        }
        return settled(change("branch", name, reasonOf(options)), "selectBranch", reasonOf(options))
      },
      /** Scrolls to a branch's head and focuses it, in the branches view; `null` lets go of it. */
      focusBranch(name: string | null, options?: ChangeOptions<CommitHistoryChangeReason>) {
        const branches = context.options().lookup?.branches?.() ?? []
        if (name !== null && !branches.some((branch) => branch.name === name)) {
          const names = branches.map((branch) => branch.name).join(", ") || "none"
          throw new RangeError(`No branch "${String(name)}" in the overview. Branches: ${names}.`)
        }
        return settled(change("focusedBranch", name, reasonOf(options)), "focusBranch", reasonOf(options))
      },
      /** The branches beside the base with their heads and how far ahead and behind they are. Reads only. */
      listBranches() {
        return [...(context.options().lookup?.branches?.() ?? [])]
      },
      commits: () => context.options().lookup?.entries() ?? [],
    }
    return api
  },
  slots: (slot) => ({
    root: slot({
      role: "region",
      attrs: (state) => ({
        "data-details-open": state.details.length > 0 ? "" : undefined,
        "data-selected": state.selected ?? undefined,
        "data-branch": state.branch ?? undefined,
      }),
    }),
  }),
  agent: {
    actions: [
      "select",
      "expandDetails",
      "collapseDetails",
      "expand",
      "collapse",
      "copyHash",
      "openCommit",
      "selectBranch",
      "focusBranch",
      "listBranches",
    ],
    items: (api) => api.commits(),
  },
})

function createCommitHistoryController() {
  return createController<CommitHistoryController>()
}

export { commitHistory, createCommitHistoryController, WORKING_TREE }
export type {
  CommitBranchSummary,
  CommitHistoryChangeReason,
  CommitHistoryController,
  CommitHistoryOptions,
  CommitLookup,
  CommitLookupEntry,
}
