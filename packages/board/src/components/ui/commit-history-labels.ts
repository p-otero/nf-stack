const numberFormats = new Map<string, Intl.NumberFormat>()

function formatCount(value: number, locale?: string) {
  let format = numberFormats.get(locale ?? "")
  if (!format) {
    format = new Intl.NumberFormat(locale)
    numberFormats.set(locale ?? "", format)
  }
  return format.format(value)
}

type CommitHistoryLabels = {
  /** The branch switcher's name. */
  branch: string
  /** The count beside the branch: "9 commits". */
  commits: (count: number, locale?: string) => string
  /** A pending commit's status, in place of its time. */
  pending: string
  copyHash: string
  copied: string
  /** "2 files" in a commit's details. */
  files: (count: number, locale?: string) => string
  /** Read out for `+18`. */
  additions: (count: number, locale?: string) => string
  /** Read out for `-9`. */
  deletions: (count: number, locale?: string) => string
  loadMore: string
  loading: string
  /** Names the select that shows one branch, or every one, in the branches view. */
  branchFilter: string
  /** Its first choice: every active branch. */
  allBranches: string
  /** Names the search field in the branch select, and is its placeholder. */
  searchBranches: string
  /** Shown in the branch select when no branch matches the search. */
  noBranches: string
  /** Read for a branch pill: "branch feature/webhooks". */
  branchHead: (name: string) => string
  /** Read for `↑3`: "3 ahead". */
  ahead: (count: number, locale?: string) => string
  /** Read for `↓12`: "12 behind". */
  behind: (count: number, locale?: string) => string
  /** The working-tree row's name, unless `workingTree.label` gives one. */
  workingTree: string
  /** Read after a commit the upstream doesn't have yet. */
  notPushed: string
  /** The header's count of commits the upstream doesn't have: "3 not pushed". */
  unpushed: (count: number, locale?: string) => string
  /** "2 staged" on the working-tree row. */
  staged: (count: number, locale?: string) => string
  /** "3 unstaged" on the working-tree row. */
  unstaged: (count: number, locale?: string) => string
}

const commitHistoryLabels: CommitHistoryLabels = {
  branch: "Branch",
  commits: (count, locale) => `${formatCount(count, locale)} ${count === 1 ? "commit" : "commits"}`,
  pending: "Committing",
  copyHash: "Copy hash",
  copied: "Copied",
  files: (count, locale) => `${formatCount(count, locale)} ${count === 1 ? "file" : "files"}`,
  additions: (count, locale) => `${formatCount(count, locale)} ${count === 1 ? "addition" : "additions"}`,
  deletions: (count, locale) => `${formatCount(count, locale)} ${count === 1 ? "deletion" : "deletions"}`,
  loadMore: "Load more",
  loading: "Loading…",
  branchFilter: "Branches shown",
  allBranches: "All branches",
  searchBranches: "Search branches",
  noBranches: "No branches match",
  branchHead: (name) => `branch ${name}`,
  ahead: (count, locale) => `${formatCount(count, locale)} ahead`,
  behind: (count, locale) => `${formatCount(count, locale)} behind`,
  workingTree: "Uncommitted changes",
  notPushed: "not pushed",
  unpushed: (count, locale) => `${formatCount(count, locale)} not pushed`,
  staged: (count, locale) => `${formatCount(count, locale)} staged`,
  unstaged: (count, locale) => `${formatCount(count, locale)} unstaged`,
}

export { commitHistoryLabels, formatCount }
export type { CommitHistoryLabels }
