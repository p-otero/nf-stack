# Git history and files

A branch's history as a commit trail, and a repository's files at a commit. Five items:

| Item                    | What it is                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `commit-history`        | `CommitHistory`: one line per commit, merges folded until opened, a commit's details inline, virtualized     |
| `server-commit-history` | `ServerCommitHistory`: the same over a `PageSource`, older pages as the end scrolls into view                |
| `git-tree`              | `GitTree`: the files at a commit on UI SDK's Tree, changed files marked by status, virtualized               |
| `repository-select`     | `RepositorySelect`: one repository of several, each with its path, branch and uncommitted/ahead/behind state |
| `git-chip`              | `GitFileChip` and `GitBranchChip`, for paths and branch names inside text                                    |

`commit-graph` (lib) is the model under `CommitHistory`, usable on its own.

## Commits

```tsx
<CommitHistory
  aria-label="Commits on main"
  className="max-h-[32rem]"
  commits={commits}
  branch={branch}
  branches={["main", "release"]}
  onBranchChange={setBranch}
/>
```

- **Order**: newest first, children before parents, the order of `git log --topo-order`. The component never reorders; a merged branch nests under its merge only where its commits come right after it.
- **A commit**: `{ id, parents, message, date, author?, hash?, body?, tags?, stats?, status? }`. `parents` are the full parent ids, first parent first (`%P`). `hash` defaults to the first 7 characters of `id`.
- **Messages**: a string turns `` `src/routes.ts` `` into a file chip, `` `branch:main` `` into a branch chip, other backticked text into inline code, and git's own merge subjects ("Merge a into b", "Merge branch 'a' into b", "Merge pull request #1 from a/b") into branch chips. Or pass segments: `[{ type: "text", text: "Bump " }, { type: "file", path: "package.json" }]`.
- **Tags**: `tags: [{ label: "Release", tone: "violet" }, { label: "Fix", tone: "warning" }]`, drawn as `Badge`s. A category is `violet`; a status is one of the status tones.
- **Merges** start collapsed. A press, Enter, Right/Left or the chevron opens one; `expanded`/`defaultExpanded`/`onExpandedChange` hold the open merge ids.
- **Details**: a press or Enter on any other commit opens author, date, hash with a copy button, files and lines changed, and the body under its row. One at a time unless `detailsMode="multiple"`; `details`/`defaultDetails`/`onDetailsChange` hold them. With `onOpenCommit`, the press calls it instead, for apps that navigate to a commit page.
- **Selection**: for a list beside a commit pane, pass `selected` + `onSelect` (or `defaultSelected`); any of them turns selection on. A press, Enter or Space selects a row, which carries `aria-selected` and the `nav-current` look (fill, hairline, medium weight). A press or Enter on the row already selected opens its details, or its merged commits on a merge; the chevron and Right/Left still open a merge without selecting it. Arrows only move focus, so a held arrow never re-renders the pane. `onSelect(id, details)` gets `details.reason` and `details.cancel()`.
- **Uncommitted changes**: `workingTree={{ staged: 2, unstaged: 3 }}` puts a row above the newest commit, "Uncommitted changes · 2 staged · 3 unstaged" with a hollow dashed node. It takes roving focus and selection like a commit, under the reserved id `WORKING_TREE` (`"working-tree"`), so `defaultSelected={WORKING_TREE}` opens a dirty checkout on its changes. `workingTree.label`, `labels.workingTree`, `labels.staged(n)` and `labels.unstaged(n)` change the words. Leave the prop out on a clean checkout.
- **Header**: `headerStart` goes before the branch switcher (a repository picker: `RepositorySelect` from the `repository-select` item, `size="sm"`), `actions` after it, before the count.
- **Not pushed**: `upstreamHead` (the upstream's head, `git rev-parse @{u}`) marks every commit above it, and `unpushed: true` marks one commit, as `git log @{u}..` lists them. Each gets a small cloud-upload mark beside its time and ", not pushed" in its name (`labels.notPushed`); the header shows how many before the count, read as "3 not pushed" (`labels.unpushed(n)`).
- **Focus mode**: while details are open the other rows dim to `muted-foreground`, which keeps 4.5:1. `focusMode={false}` turns it off, `true` keeps it on.
- **A commit in progress**: put it first with `status: "pending"`. It spins (not under reduced motion) and shows `labels.pending` in place of its time. Replace it with `status: "done"` when it lands: its node grows into a check and its time and tags fade in, and the count goes up.
- **The count** counts finished commits; pass `count` with the server's total when paging.
- **Time**: one clock (`useNow`, every 30 s) for every row, or pass `now`. Rows show "26m"; the name says "26 minutes ago" and the title the full date, in the page's language.
- **Labels**: every string is in `labels` (`branch`, `commits(n)`, `pending`, `copyHash`, `copied`, `files(n)`, `additions(n)`, `deletions(n)`, `loadMore`, `loading`).

### Every active branch

`view="branches"` draws a compact `git log --graph --all`: the base in lane 0 and each unmerged branch in a lane of its own, from its merge-base to its head.

```tsx
<CommitHistory
  aria-label="Branches"
  view="branches"
  commits={allCommits} // git log --all --topo-order
  branch="main" // the base; the switcher still picks it
  branches={[
    { name: "main", head: "a41f0e2" },
    { name: "feature/webhooks", head: "w3c1a0e", updatedAt: "2026-11-18T11:56:00Z" },
    { name: "fix/cents", head: "c1e5f7a", tone: "warning", ahead: 1, behind: 2 },
  ]}
  filterBranch
/>
```

- Each branch's head carries a pill: a dot in its lane colour, the name and `↑ahead ↓behind`, read in the row's name ("branch feature/webhooks, 3 ahead, 0 behind"). `ahead` and `behind` are worked out along first parents when you don't pass them.
- Colours come from the chart tokens, stable for a name and distinct for up to five branches; `tone` takes over. The pill and the strip name each lane, so colour is never the only cue.
- The header's select lists the active branches after "All branches" (`labels.allBranches`): a dot in each branch's lane colour (in the trigger too), its name, arrows for ahead and behind (a zero side left out; screen readers hear "3 ahead, 0 behind" from `labels.ahead`/`behind`) and its last update. Typing in its search field filters by name; `labels.noBranches` shows when none match. Opening it with 200 branches paints in about 25 ms; merged ones are left out, stale ones (no change in `staleAfter`, 30 days) say so in `listBranches`. Choosing one, pressing its pill in the trail, or `focusBranch(name)` scrolls to its head and focuses it; with `filterBranch` the trail shows only the base and that branch until "All branches" or the pill again. `focusedBranch`/`onFocusedBranchChange` control it. The base is the `branch` prop in this view.
- Past `maxLanes` (8 here) lanes aren't drawn; a "+N" beside the graph counts them.
- Agents call `listBranches()` (name, head, ahead, behind, updatedAt, state) and `focusBranch(name)`.

### Paging

`hasMore`, `loadingMore` and `onLoadMore` load older commits when the end comes into view and from a Load more button. Append the next page to the same array: the graph continues from where it was, laying out only the new rows. Or let `ServerCommitHistory` do it:

```tsx
<DataProvider>
  <ServerCommitHistory
    aria-label="Commits"
    source={commitSource} // a PageSource<Commit>, like cursorSource (page-source-cursor) over your git log endpoint
    filter={{ branch }}
    pageSize={100}
    labels={{ errorTitle: "Couldn't load commits", retry: "Try again", emptyTitle: "No commits yet" }}
  />
</DataProvider>
```

A new `filter` starts again from the newest commit. See `references/server-data.md` for sources.

### Size

`CommitHistory` scrolls itself: give it a bounded height (`max-h-*`, or `min-h-0 flex-1` in a flex column). It renders only the rows in view; a row with open details is measured, so heights vary freely. 50,000 commits paint in about 70 ms and a held arrow key stays within a frame on a desktop CPU.

### Find in page

Rows out of view aren't in the page, so the browser's find doesn't see them. `findable` adds UI SDK's findable layers, built once the page is idle after its first paint: find in page then counts every subject (the file and branch chips included), and a match scrolls its row into view and highlights it in the row. It's off by default because it costs: on 50,000 commits about a frame on some held-arrow presses (p95 22–27 ms against 10 ms) and 10–40% more on the first paint. With it, the history's scroller is capped at `--commit-history-height` (40rem); set the variable to `none` when a parent bounds it. `GitTree findable` does the same for names (p95 about 16 ms against 10 ms on 100,000 files).

### Agents

The history is one component to an agent, named by its `aria-label`, with every commit as an item named in full ("Merge invoice-pdf into main, 38 minutes ago, Release"). Actions take a commit's id, hash (4 characters or more) or subject:

- `select(commit)`: only with selection on; `select(null)` clears it, `select("working-tree")` picks the working-tree row
- `expandDetails(commit)`, `collapseDetails(commit)`
- `expand(merge)`, `collapse(merge)`: refused on a commit with no merged commits
- `copyHash(commit)`: copies where the page can, and returns the hash, so the agent reads it either way
- `openCommit(commit)`: only with `onOpenCommit`
- `selectBranch(name)`: only with `branches` and `onBranchChange`

`createCommitHistoryController()` gives the same calls to your own code.

## Repositories

```tsx
<RepositorySelect
  aria-label="Repository"
  size="sm"
  repositories={[
    { value: "api", name: "api", path: "~/work/acme/api", branch: "main", ahead: 0, behind: 0, remote: true },
    { value: "docs", name: "docs", path: "~/work/acme/docs", branch: "main", uncommitted: 1, remote: false },
  ]}
  value={repo}
  onValueChange={setRepo}
/>
```

- A repository is `{ value, name, path?, branch?, uncommitted?, ahead?, behind?, remote?, disabled? }`. `ahead`/`behind` are `null` without an upstream; `remote: false` reads "No remote".
- The trigger shows the name; each option shows the name, the path in mono, the branch as a `GitBranchChip` and badges: uncommitted (warning), ahead (info), behind (outline), No remote, or Up to date (success) when none apply.
- It's UI SDK's Select: arrows, typeahead by name, and agents' `setValue`. Every word is in `labels`.
- In a master-detail Git view, put it in `CommitHistory headerStart` with `size="sm"`; in a toolbar, in a `Field` with a `FieldLabel`.

## Files

```tsx
<GitTree
  aria-label="Files at e02c6d9"
  className="max-h-96"
  files={[
    "package.json",
    { path: "src/routes.ts", status: "added" },
    { path: "src/billing/proration.ts", status: "modified" },
    { path: "src/invoice/pdf.ts", status: "renamed", from: "src/invoice/print.ts" },
  ]}
  current={openPath}
  onOpenFile={setOpenPath}
/>
```

- `files` are path strings (a trailing `/` is an empty folder) or `{ path, status, from }`. Folders come first. Statuses are `added` (success), `modified` (warning), `deleted` (destructive, struck through) and `renamed` (info); each shows a letter (`labels.mark`) and reads in the name ("proration.ts, Modified").
- Folders that hold a change start open and carry a dot; `expanded`/`defaultExpanded`/`onExpandedChange` take over.
- Keys are UI SDK's tree: arrows, Home/End, typeahead, Left/Right. A press or Enter on a file calls `onOpenFile(path)`; `current` marks the open file.
- Agents call `open(path)` (opens a file's folders first), `expand(path)` and `collapse(path)`.
- 100,000 files paint in about 140 ms; only the rows in view render.
