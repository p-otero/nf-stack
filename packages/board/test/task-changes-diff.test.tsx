import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

import type { GitCommitDetail, GitWorktree, TaskBranch } from "@nf/contracts";

registerDom("http://127.0.0.1:4646/?project=SS");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { fireEvent } = await import("@testing-library/react");
const { TaskChangesDiff } = await import("../src/components/nf/task-changes-diff");
const { toWorktreeChanges } = await import("../src/components/nf/task-git-data");

afterEach(() => {
  mock.restore();
});

afterAll(unregisterDom);

const SHA = "a1b2c3d4e5f6a7b8c9d0";

const filesPatch = [
  "diff --git a/src/one.ts b/src/one.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/one.ts",
  "@@ -0,0 +1,2 @@",
  "+one",
  "+two",
  "diff --git a/src/two.ts b/src/two.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/two.ts",
  "@@ -0,0 +1 @@",
  "+three",
  "diff --git a/src/three.ts b/src/three.ts",
  "deleted file mode 100644",
  "--- a/src/three.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "",
].join("\n");

const commitDetail = (
  patch: string,
  overrides: Partial<GitCommitDetail> = {},
): GitCommitDetail => ({
  commit: {
    sha: SHA,
    parents: ["0f0f0f0f"],
    author: "Sasha Rivera",
    email: "sasha@harbor.example",
    date: "2026-11-19T20:10:00Z",
    subject: "Vendor the webhook fixtures",
    body: "",
    refs: [],
    filesChanged: 3,
    insertions: 3,
    deletions: 1,
  },
  parent: "0f0f0f0f",
  files: [],
  patch,
  truncated: false,
  tree: [],
  treeTruncated: false,
  ...overrides,
});

const truncatedCommit: GitCommitDetail = commitDetail(
  "diff --git a/src/dispatch.ts b/src/dispatch.ts\n@@ -1 +1 @@\n-a\n+b\n",
  {
    files: [
      { path: "src/dispatch.ts", status: "modified", from: null, additions: 12, deletions: 0 },
      { path: "test/fixtures/a.json", status: "added", from: null, additions: 45000, deletions: 0 },
      { path: "test/fixtures/b.json", status: "added", from: null, additions: 45000, deletions: 0 },
    ],
    truncated: true,
  },
);

const truncatedWorktree: GitWorktree = {
  repo: ".",
  path: "C:/work/worktrees/ss-1",
  branch: "feat/webhook-backoff",
  head: SHA,
  staged: { files: [], patch: "", truncated: false },
  unstaged: {
    files: [
      { path: "src/dispatch.ts", status: "modified", from: null, additions: 1, deletions: 1 },
      { path: "dist/bundle.js", status: "modified", from: null, additions: 40000, deletions: 0 },
    ],
    patch: "diff --git a/src/dispatch.ts b/src/dispatch.ts\n@@ -1 +1 @@\n-a\n+b\n",
    truncated: true,
  },
  untracked: { files: [], patch: "", truncated: false },
  untrackedTruncated: false,
};

const groupedWorktree: GitWorktree = {
  repo: ".",
  path: "C:/work/worktrees/ss-1",
  branch: "feat/webhook-backoff",
  head: SHA,
  staged: {
    files: [{ path: "src/api.ts", status: "modified", from: null, additions: 1, deletions: 1 }],
    patch: "diff --git a/src/api.ts b/src/api.ts\n@@ -1 +1 @@\n-old\n+new\n",
    truncated: false,
  },
  unstaged: {
    files: [{ path: "src/status.ts", status: "modified", from: null, additions: 1, deletions: 0 }],
    patch: "diff --git a/src/status.ts b/src/status.ts\n@@ -1 +1,2 @@\n new\n+more\n",
    truncated: false,
  },
  untracked: {
    files: [{ path: "notes/todo.md", status: "added", from: null, additions: 1, deletions: 0 }],
    patch: "diff --git a/notes/todo.md b/notes/todo.md\n@@ -0,0 +1 @@\n+later\n",
    truncated: false,
  },
  untrackedTruncated: false,
};

const branch = (overrides: Partial<TaskBranch> = {}): TaskBranch => ({
  task: "SS-001",
  attempt: "SS-001-A1",
  repo: ".",
  repoPath: "C:/work/worktrees/ss-1",
  name: "feat/webhook-backoff",
  head: SHA,
  base: "main",
  upstream: null,
  ahead: 1,
  behind: 0,
  unpushed: 1,
  worktree: null,
  uncommitted: null,
  commits: [],
  commitsTruncated: false,
  pullRequest: null,
  ...overrides,
});

const changes = (worktree: GitWorktree | null = null) => ({
  commits: [],
  unpushed: 0,
  all: undefined,
  allLoading: false,
  allError: undefined,
  worktree:
    worktree === null
      ? { kind: "none" as const }
      : { kind: "ready" as const, worktree, changes: toWorktreeChanges(worktree) },
});

const noWorktree = changes();

const render = async (selected: string, worktree: GitWorktree | null = null) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(TaskChangesDiff, {
          project: "SS",
          branch: branch(),
          changes: selected === "worktree" && worktree !== null ? changes(worktree) : noWorktree,
          selected,
        }),
      ),
    );
  });
  for (let tick = 0; tick < 10; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const notice = () =>
    container.querySelector('[data-slot="diff-truncated"]')?.textContent ?? null;
  const pane = () =>
    container.querySelector<HTMLElement>('[data-slot="diff-pane"]')?.parentElement ?? null;
  const tree = () => container.querySelector('[role="tree"]');
  const fileItems = () =>
    [...(tree()?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].filter(
      (item) => item.querySelector('[role="treeitem"]') === null,
    );
  const selectFile = async (name: string) => {
    const item = fileItems().find((entry) => entry.textContent?.startsWith(name));
    await act(async () => {
      const label = item?.querySelector('[data-slot="tree-label"]');
      if (label !== null && label !== undefined) fireEvent.click(label);
    });
    return fileItems().find((entry) => entry.textContent?.startsWith(name));
  };
  return {
    container,
    notice,
    pane,
    tree,
    fileItems,
    selectFile,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

describe("task changes diff", () => {
  test("says a truncated commit's patch is cut and which files it leaves out", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(truncatedCommit));
    const view = await render(SHA);
    expect(view.notice()).toContain(
      "Commit a1b2c3d stops at the git API's size limit: showing 1 of 3 files.",
    );
    expect(view.notice()).toContain("Not shown: test/fixtures/a.json, test/fixtures/b.json.");
    await view.unmount();
  });

  test("shows no notice on a complete commit", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ ...truncatedCommit, truncated: false }),
    );
    const view = await render(SHA);
    expect(view.notice()).toBeNull();
    await view.unmount();
  });

  test("says which side of a truncated worktree is cut", async () => {
    const view = await render("worktree", truncatedWorktree);
    expect(view.notice()).toContain(
      "The unstaged diff stops at the git API's size limit: showing 1 of 2 files.",
    );
    expect(view.notice()).toContain("Not shown: dist/bundle.js.");
    await view.unmount();
  });

  test("shows the diff's file tree, and a file chosen there opens in the diff", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(commitDetail(filesPatch)));
    const view = await render(SHA);
    expect(view.tree()?.getAttribute("aria-label")).toBe("Changed files");
    const names = view.fileItems().map((item) => item.textContent ?? "");
    expect(names.length).toBe(3);
    for (const name of ["one.ts", "two.ts", "three.ts"])
      expect(names.some((text) => text.startsWith(name))).toBe(true);
    expect((await view.selectFile("two.ts"))?.getAttribute("aria-selected")).toBe("true");
    expect(view.fileItems()[0]?.getAttribute("aria-selected")).toBe("false");
    await view.unmount();
  });

  test("keeps the file tree out of the diff's own scroll container", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(commitDetail(filesPatch)));
    const view = await render(SHA);
    const viewport = view.container.querySelector('[data-slot="diff-view-viewport"]');
    const tree = view.tree();
    expect(viewport).not.toBeNull();
    expect(tree).not.toBeNull();
    expect(viewport?.contains(tree)).toBe(false);
    expect(tree?.closest('[data-slot="scroll-area"]')).not.toBeNull();
    expect(viewport?.getAttribute("data-height")).toBe("fill");
    expect(view.pane()?.className).toContain("h-160");
    await view.unmount();
  });

  test("puts a worktree's untracked files in the same tree and diff as the Git tab", async () => {
    const view = await render("worktree", groupedWorktree);
    const treeText = view.tree()?.textContent ?? "";
    for (const label of ["Staged", "Unstaged", "Untracked"]) expect(treeText).toContain(label);
    for (const path of ["api.ts", "status.ts", "todo.md"]) expect(treeText).toContain(path);
    const diff = view.container.querySelector('[data-slot="git-diff"]')?.textContent ?? "";
    expect(diff).toContain("notes/todo.md");
    expect(diff).toContain("later");
    await view.unmount();
  });
});
