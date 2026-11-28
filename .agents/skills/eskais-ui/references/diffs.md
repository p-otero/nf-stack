# Diffs

Part of the `eskais-ui` skill.

## Which one

- **Two versions of one text** (a config, a generated file, an edit before saving): `TextDiff oldText newText language` (`"tsx"`, or a file name). Takes the diff options and every DiffView prop.
- **A patch or a pull request**: `GitDiff patch` (output of `git diff`, `git show`, a `.patch`) or `GitDiff files` (`FileDiff[]`). Headers per file, a tree of changed files (`fileTree`), layout and wrap controls (`toolbar`).
- **The file tree** is `--diff-tree-width` wide (13rem; set the variable on a parent to change it) and hides below 760px. `fileTree="collapsible"` puts a "Changed files" toggle at the start of the toolbar (`fileTreeOpen`, `defaultFileTreeOpen`, `onFileTreeOpenChange`), for a diff beside a wide list. `fileTree={false}` drops it.
- **Groups**, like a working tree's staged and unstaged changes: `groups={[{ label: "Staged", patch: staged }, { label: "Unstaged", files: unstaged }]}` in place of `patch`/`files`. The tree shows a section per group with its file count (`labels.fileCount`), each with its own folders; the diff lists the groups in order, each file's header carrying its group's label (read after the path). A path in both groups, like a file staged and edited again, shows in each with its real name; agents and `currentFile` tell the second apart as `path (2)`.
- **A file list or tree of your own beside GitDiff** (a `GitTree` of every file at the commit, with `fileTree={false}`): pass `currentFile` and `onCurrentFileChange`. Setting `currentFile` scrolls the diff to that file; the diff reports the file at the top as it scrolls (`details.reason` is `"scroll"`, or `"imperative"` after `openFile`), so the tree follows it. Echoing a reported file back doesn't scroll. `createDiffViewController()` is exported from `git-diff` too: `openFile(path)`, `currentFile()`, `nextHunk()`…
- **Your own chrome around the rows**: `DiffView files={toViewFiles(fileDiffs)} headers`, driven by `createDiffViewController()` (`openFile`, `nextHunk`, `markViewed`, `setLayout`, `setWrap`…).
- **Only the data**: `diffText`, `diffFile`, `intraline` and `diffTextAsync` from `@/lib/diff-*` (the `diff` item); `parsePatch` and `formatHunks` from `@/lib/diff-patch` (the `diff-patch` item, which `git-diff` brings). `formatHunks(diffText(a, b).hunks)` is what `git diff --histogram` prints; `algorithm: "myers"` matches `git diff --minimal`.

## Making regions expandable

- Unchanged lines between hunks fold behind "Expand N lines". They can open only when both texts are known: `TextDiff` always has them; for `GitDiff` pass `files` built with `diffFile(oldText, newText, { oldPath, newPath })` instead of a bare patch. A patch alone shows each hunk's `@@` header without an Expand button.
- `context` (3) sets the unchanged lines kept around each change.

## Size and speed

- **GitDiff in a scrolling dialog body** (a collapsible "Changes" section): `height="auto"`. It grows to the whole diff with no scroller of its own, so the body is the one scroller, and doesn't shrink in a flex column. Its rows still virtualize, against the body: only the lines in view render, find in page reaches the rest and j/k move the body. The file tree beside it stays in view, up to 40rem tall. To cap the diff instead, set `--diff-max-height` on a parent (`[--diff-max-height:24rem]`), below the body's visible height and never in viewport units: past it the diff scrolls inside, and at its top or bottom the wheel moves the body on. `toolbar={false}` drops the layout controls for a compact section.
- `TextDiff` and `DiffView` size to the whole diff (`height="auto"`, the default) and scroll with the nearest scrolling ancestor, or the page; set `--diff-max-height` on a parent to cap one and scroll inside past it. `height="fill"` takes the height of a sized parent instead, for a diff that fills a pane; `GitDiff` fills by default, beside its file tree, so give it a height. Either way only the rows in view render, every file in one list. A 20,000-line file or a 500-file patch opens in about 150 ms on a desktop.
- `TextDiff` diffs during render below 200k characters and in a Web Worker above (`worker`, `workerThreshold`). The worker is a Blob built from the engine's source: no worker file to configure; under a Content Security Policy without `worker-src blob:` it diffs on the main thread.
- Syntax colours load the language's Lezer parser on first use and parse each file side in slices while you read; lines show plain first and colour in when the parse lands.
- Pass `labels` as a constant: a new object every render re-renders every visible row.
- In split layout an added or deleted file shows its one side across the whole width.
- Wrapped lines (`wrap`) are measured as they render; unwrapped rows have a fixed height and scroll cheapest.

## Review flow

- `onLineSelect(selection, details)`: a click on a line number or Enter selects a line, Shift extends the range; `selection` is `{ path, start: { side, line }, end, lines }` (`side` is `"old"` or `"new"`, as GitHub's review API takes it), `null` when cleared (Escape). Anchor a comment form to it.
- `viewed`/`defaultViewed`/`onViewedChange`: the Viewed checkbox in each header; a file marked viewed folds away. `defaultCollapsed` folds files from the start.
- Keys: arrows by line (and side in split), j/k to the next or previous hunk, n/p to the next or previous file, Page Up/Down, Enter to expand a folded region.

## Agents

- The diff is one component, named by its `aria-label`, with `openFile(path)`, `currentFile()` (read-only), `nextHunk()`, `previousHunk()`, `nextFile()`, `previousFile()`, `markViewed(path, viewed?)`, `getHunk(path, n)` (read-only: the hunk's header and lines), `expandGap(path, gap)`, `setLayout`, `setWrap` and `clearSelection`. Its items are the file paths, so an agent can see what `openFile` takes.
- `details.source === "agent"` in `onViewedChange` or `onLayoutChange` tells an agent's change apart; `details.cancel()` refuses it.

## Headers and counts

- A header's counts read `+12 −3` with a five-block bar: one block per changed line below five lines, else in proportion. Screen readers hear the counts in words (`labels.counts`); the bar is decorative.
- A binary file shows `labels.binaryFile` ("Binary") and a mode-only change `labels.modeChange(from, to)` ("Mode 100644 → 100755", read as `labels.modeChanged`) instead of `+0 −0`, in the header and the file tree. A rename without changes shows no counts.
- A rename prints as git does, the shared folders and file name outside braces (`docs/{old-name.md → new-name.md}`), and truncates only when the header runs out of room; the native tooltip and the screen-reader name keep both paths whole.

## Colour

- Lines use `bg-diff-added`/`bg-diff-removed`, changed words `bg-diff-added-strong`/`bg-diff-removed-strong`, gutters `bg-diff-*-gutter` with `text-diff-*-foreground` signs. All derive from the success and destructive tones, so a custom palette follows, and every syntax colour keeps 4.5:1 on them in both modes. Each line also has its +/- sign and a screen-reader label, never colour alone.
