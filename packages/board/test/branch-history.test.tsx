import { afterAll, afterEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

import type { TaskBranch } from "@nf/contracts";

// A saturated CPU stretches each await in a render-and-assert test to hundreds of milliseconds;
// the dialog needs a handful of them, which the default 5 s does not cover.
setDefaultTimeout(15_000);

registerDom("http://127.0.0.1:4646/");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, createElement } = await import("react");
const { render, warmUp } = await import("./render");
const { NfTaskDetailDialog } = await import("../src/components/nf/task-detail-dialog");
const { branchHistoryHref } = await import("../src/components/nf/task-git-data");
const { projectOf } = await import("../src/board-data");
const { useGitLocation } = await import("../src/components/nf/git/hooks/use-git-location");

const mounted: (() => Promise<void>)[] = [];

const mount = async (element: ReturnType<typeof createElement>) => {
  mounted.push(await render(element));
};

const settle = async (ready: () => boolean) => {
  // A response body is read across tasks, so the branch can arrive after the mount's act.
  for (let attempt = 0; attempt < 20 && !ready(); attempt += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  mock.restore();
  history.replaceState(null, "", "/");
});

afterAll(unregisterDom);

const branch: TaskBranch = {
  task: "SS-001",
  attempt: "SS-001-A2",
  repo: "services/api",
  repoPath: "C:/work/harbor/services/api",
  name: "feat/webhook-backoff",
  head: "f".repeat(40),
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

const task = {
  id: "SS-001",
  title: "Back off webhook retries exponentially",
  status: "working" as const,
  dependsOn: [],
  acceptance: [],
  attempts: [],
  updatedAt: "2026-11-19T21:39:00Z",
};

const respond = () =>
  spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const href = String(input instanceof Request ? input.url : input);
    if (href.includes("/api/tasks/SS-001/branch")) return Response.json(branch);
    if (href.includes("/api/git/compare"))
      return Response.json({
        base: "main",
        head: branch.head,
        mergeBase: null,
        ahead: 1,
        behind: 0,
        commits: [],
        commitsTruncated: false,
        files: [],
        patch: "",
        truncated: false,
      });
    return Response.json({ error: "unexpected" }, { status: 404 });
  });

const dialog = (live: boolean) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(NfTaskDetailDialog, { task, live, onClose: () => undefined }),
  );

const warmUpFirstRender = async () => {
  respond();
  await warmUp(dialog(true));
  mock.restore();
};

await warmUpFirstRender();

const button = () =>
  [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Branch history",
  );

function Location() {
  const [location] = useGitLocation(projectOf(window.location.search));
  return createElement("output", { "data-testid": "location" }, JSON.stringify(location));
}

describe("branch history", () => {
  test("opens the Git tab on the task's project, repository and branch", async () => {
    history.replaceState(null, "", "/?view=tasks");
    respond();
    const assign = spyOn(window.location, "assign").mockImplementation(() => undefined);
    await mount(dialog(true));
    await settle(() => button()?.hasAttribute("disabled") === false);
    expect(button()?.hasAttribute("disabled")).toBe(false);
    await act(async () => button()?.click());
    expect(assign).toHaveBeenCalledWith(
      "/?view=git&project=SS&repo=services%2Fapi&branch=feat%2Fwebhook-backoff",
    );
  });

  test("keeps the branch when the Git tab opens from the link, even from every project", async () => {
    const href = branchHistoryHref("http://127.0.0.1:4646/?view=tasks", branch);
    history.replaceState(null, "", href);
    expect(projectOf(window.location.search)).toBe("SS");
    await mount(createElement(Location));
    const shown = document.querySelector('[data-testid="location"]')?.textContent ?? "null";
    expect(JSON.parse(shown)).toEqual({
      repo: "services/api",
      branch: "feat/webhook-backoff",
      commit: null,
      worktree: null,
    });
    expect(window.location.search).toContain("branch=feat%2Fwebhook-backoff");
  });
});
