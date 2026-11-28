import { afterAll, describe, expect, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

import type { GitWorktree } from "@nf/contracts";

registerDom("http://127.0.0.1:4646/?project=SS", { width: 390, height: 844 });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorktreePane } = await import("../src/components/nf/git/worktree-pane");

afterAll(unregisterDom);

const worktree: GitWorktree = {
  repo: ".",
  path: "C:/work/worktrees/ss-1",
  branch: "feat/webhook-backoff",
  head: "a1b2c3d4",
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

const render = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorktreePane, { worktree, className: "h-160" }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

describe("git tab worktree pane below the narrow breakpoint", () => {
  test("pins its files header and tree above the diff", async () => {
    const view = await render();
    const pane = view.container.querySelector('[aria-label="Uncommitted changes"]');
    const files = pane?.querySelector('[data-slot="diff-files"]');
    const trigger = files?.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.textContent).toContain("Changed files");
    const tree = files?.querySelector('[role="tree"]');
    const viewport = pane?.querySelector('[data-slot="diff-view-viewport"]');
    expect(tree?.textContent).toContain("Staged");
    expect(tree?.textContent).toContain("Unstaged");
    expect(tree?.textContent).toContain("Untracked");
    expect(viewport?.contains(tree ?? null)).toBe(false);
    expect(tree?.closest('[data-slot="scroll-area"]')).not.toBeNull();
    await view.unmount();
  });
});
