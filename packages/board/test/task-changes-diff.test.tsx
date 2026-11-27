import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

import type { GitCommitDetail, GitWorktree } from "@nf/contracts";

registerDom("http://127.0.0.1:4646/?project=SS");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { TaskChangesDiff } = await import("../src/components/nf/task-changes-diff");
const { toWorktreeChanges } = await import("../src/components/nf/task-git-data");

afterEach(() => {
  mock.restore();
});

afterAll(unregisterDom);

const SHA = "a1b2c3d4e5f6a7b8c9d0";

const truncatedCommit: GitCommitDetail = {
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
    insertions: 90012,
    deletions: 0,
  },
  parent: "0f0f0f0f",
  files: [
    { path: "src/dispatch.ts", status: "modified", from: null, additions: 12, deletions: 0 },
    { path: "test/fixtures/a.json", status: "added", from: null, additions: 45000, deletions: 0 },
    { path: "test/fixtures/b.json", status: "added", from: null, additions: 45000, deletions: 0 },
  ],
  patch: "diff --git a/src/dispatch.ts b/src/dispatch.ts\n@@ -1 +1 @@\n-a\n+b\n",
  truncated: true,
  tree: [],
  treeTruncated: false,
};

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
  untracked: [],
  untrackedTruncated: false,
};

const changes = (worktree: GitWorktree) => ({
  commits: [],
  unpushed: 0,
  all: undefined,
  allLoading: false,
  allError: undefined,
  worktree: { kind: "ready" as const, changes: toWorktreeChanges(worktree) },
});

const render = async (selected: string) => {
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
          repo: ".",
          base: "main",
          changes: changes(truncatedWorktree),
          selected,
        }),
      ),
    );
  });
  for (let tick = 0; tick < 10; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const notice = () => container.querySelector('[data-slot="diff-truncated"]')?.textContent ?? null;
  return {
    notice,
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
    const view = await render("worktree");
    expect(view.notice()).toContain(
      "The unstaged diff stops at the git API's size limit: showing 1 of 2 files.",
    );
    expect(view.notice()).toContain("Not shown: dist/bundle.js.");
    await view.unmount();
  });
});
