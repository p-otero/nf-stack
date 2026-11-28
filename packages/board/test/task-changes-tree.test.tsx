import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

import type { GitCommitDetail, TaskBranch } from "@nf/contracts";

registerDom("http://127.0.0.1:4646/?project=SS", { width: 390, height: 844 });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { fireEvent } = await import("@testing-library/react");
const { TaskChangesDiff } = await import("../src/components/nf/task-changes-diff");

afterEach(() => {
  mock.restore();
});

afterAll(unregisterDom);

const SHA = "a1b2c3d4e5f6a7b8c9d0";

const patch = [
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

const detail: GitCommitDetail = {
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
};

const branch: TaskBranch = {
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
};

const changes = {
  commits: [],
  unpushed: 0,
  all: undefined,
  allLoading: false,
  allError: undefined,
  worktree: { kind: "none" as const },
};

const render = async () => {
  spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(detail));
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
          branch,
          changes,
          selected: SHA,
        }),
      ),
    );
  });
  for (let tick = 0; tick < 10; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const files = () => container.querySelector<HTMLElement>('[data-slot="diff-files"]');
  const panel = () => container.querySelector('[role="tree"]');
  const leafItems = () =>
    [...(panel()?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].filter(
      (item) => item.querySelector('[role="treeitem"]') === null,
    );
  return {
    container,
    files,
    panel,
    leafItems,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

describe("task changes file tree below the narrow breakpoint", () => {
  test("pins a files header and its tree above the diff's own scroll container", async () => {
    const view = await render();
    const files = view.files();
    expect(files).not.toBeNull();
    const trigger = files?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.textContent).toContain("Changed files");
    expect(trigger?.textContent).toContain("3 files");
    expect(view.panel()).not.toBeNull();
    const viewport = view.container.querySelector('[data-slot="diff-view-viewport"]');
    expect(viewport?.contains(view.panel())).toBe(false);
    expect(view.panel()?.closest('[data-slot="scroll-area"]')).not.toBeNull();
    expect(
      files?.compareDocumentPosition(viewport as Node) === Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(true);
    expect(viewport?.getAttribute("data-height")).toBe("fill");
    expect(
      view.container.querySelector('[aria-label="Commit a1b2c3d"]')?.className,
    ).toContain("h-160");
    await view.unmount();
  });

  test("opens the file chosen in the pinned tree", async () => {
    const view = await render();
    const item = view.leafItems().find((entry) => entry.textContent?.startsWith("two.ts"));
    await act(async () => {
      const label = item?.querySelector('[data-slot="tree-label"]');
      if (label !== null && label !== undefined) fireEvent.click(label);
    });
    const chosen = view
      .leafItems()
      .find((entry) => entry.textContent?.startsWith("two.ts"))
      ?.getAttribute("aria-selected");
    expect(chosen).toBe("true");
    await view.unmount();
  });

  test("collapses the pinned tree to its header and keeps the diff in place", async () => {
    const view = await render();
    const trigger = view.files()?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    await act(async () => {
      if (trigger !== null && trigger !== undefined) fireEvent.click(trigger);
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector('[data-slot="diff-view-viewport"]')).not.toBeNull();
    await view.unmount();
  });
});
