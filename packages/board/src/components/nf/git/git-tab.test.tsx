import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { GitCommit, GitCommitDetail, GitLogPage, GitRepo, GitWorktree } from "@nf/contracts";
import type { Writable } from "@/contract";
import type { GitTabLocation } from "@/components/nf/git/git-tab";

const bunFetch = globalThis.fetch;
GlobalRegistrator.register({ url: "http://localhost/", width: 1600, height: 1000 });

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { useState } = await import("react");
const { boardHref } = await import("@/board-data");
const { GitTab } = await import("@/components/nf/git/git-tab");
const { useGitLocation } = await import("@/components/nf/git/hooks/use-git-location");

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

type Reply = { status: number; body: unknown };
type Routes = Record<string, (params: URLSearchParams) => Reply>;

const ok = (body: unknown): Reply => ({ status: 200, body });

const repo = (overrides: Partial<Writable<GitRepo>> = {}): Writable<GitRepo> => ({
  id: "services/api",
  path: "C:/work/ledger/services/api",
  branch: "main",
  head: "b".repeat(40),
  dirty: false,
  uncommitted: 0,
  ahead: 0,
  behind: 0,
  upstream: "origin/main",
  remote: "git@example.com:ledger/api.git",
  commits: 2,
  ...overrides,
});

const commit = (sha: string, subject: string, parents: string[]): Writable<GitCommit> => ({
  sha,
  parents,
  author: "Ana Ruiz",
  email: "ana@example.com",
  date: "2026-11-19T10:00:00Z",
  subject,
  body: "",
  refs: [],
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
});

const HEAD = "b".repeat(40);
const OLDER = "a".repeat(40);
const LOG: Writable<GitLogPage> = {
  commits: [
    commit(HEAD, "Bump the api to 0.3.0", [OLDER]),
    commit(OLDER, "Parse amounts from bank exports", []),
  ],
  total: 2,
  next: null,
};

const detail = (sha: string): Writable<GitCommitDetail> => {
  const entry = LOG.commits.find((item) => item.sha === sha) ?? LOG.commits[0];
  if (entry === undefined) throw new Error("no commit");
  return {
    commit: entry,
    parent: entry.parents[0] ?? null,
    files: [],
    patch: "",
    truncated: false,
    tree: ["package.json"],
    treeTruncated: false,
  };
};

const emptySet = { files: [], patch: "", truncated: false };
const worktree = (overrides: Partial<Writable<GitWorktree>> = {}): Writable<GitWorktree> => ({
  repo: "services/api",
  path: "C:/work/ledger/services/api",
  branch: "main",
  head: HEAD,
  staged: emptySet,
  unstaged: emptySet,
  untracked: [],
  untrackedTruncated: false,
  ...overrides,
});

const requests: string[] = [];

const serve = (routes: Routes) => {
  const answer = async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, "http://localhost");
    const route = url.pathname.replace("/api/git/", "");
    requests.push(`${route}?${url.searchParams.toString()}`);
    const handler = routes[route];
    const reply =
      handler === undefined
        ? { status: 404, body: { error: "no route" } }
        : handler(url.searchParams);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  Object.assign(globalThis, { fetch: answer });
};

const baseRoutes = (overrides: Routes = {}): Routes => ({
  repos: () => ok([repo()]),
  branches: () => ok([]),
  log: () => ok(LOG),
  commit: (params) => ok(detail(params.get("sha") ?? HEAD)),
  ...overrides,
});

const renderTab = (location: Partial<GitTabLocation> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changes: unknown[] = [];
  render(
    <QueryClientProvider client={client}>
      <GitTab
        api="http://localhost/api/board"
        project="LGD"
        timeZone="UTC"
        location={{ repo: null, branch: null, commit: null, ...location }}
        onLocationChange={(next) => changes.push(next)}
      />
    </QueryClientProvider>,
  );
  return changes;
};

function SwitchingProjects({ first, second }: { first: string; second: string }) {
  const [project, setProject] = useState(first);
  const [location, changeLocation] = useGitLocation(project);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          history.replaceState(null, "", boardHref(window.location.href, second));
          setProject(second);
        }}
      >
        Switch project
      </button>
      <GitTab
        api="http://localhost/api/board"
        project={project}
        timeZone="UTC"
        location={location}
        onLocationChange={changeLocation}
      />
    </>
  );
}

const renderSwitching = (url: string) => {
  history.replaceState(null, "", url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SwitchingProjects first="A" second="B" />
    </QueryClientProvider>,
  );
};

const A_FEATURE_HEAD = "c".repeat(40);
const A_FEATURE_OLDER = "d".repeat(40);
const B_HEAD = "e".repeat(40);

const projectLogs: Record<string, Writable<GitLogPage>> = {
  "A·feature": {
    commits: [
      commit(A_FEATURE_HEAD, "Try the feature in A", [A_FEATURE_OLDER]),
      commit(A_FEATURE_OLDER, "Start the feature in A", []),
    ],
    total: 2,
    next: null,
  },
  "B·main": { commits: [commit(B_HEAD, "Only commit in B", [])], total: 1, next: null },
};

const projectRoutes = (reposOf: (project: string) => Writable<GitRepo>[]): Routes => ({
  repos: (params) => ok(reposOf(params.get("project") ?? "")),
  branches: () => ok([]),
  log: (params) => {
    const log = projectLogs[`${params.get("project") ?? ""}·${params.get("branch") ?? ""}`];
    return log === undefined ? { status: 404, body: { error: "no such branch" } } : ok(log);
  },
  commit: (params) => {
    const sha = params.get("sha") ?? "";
    const found = Object.values(projectLogs)
      .flatMap((log) => log.commits)
      .find((entry) => entry.sha === sha);
    if (found === undefined) return { status: 404, body: { error: "no such commit" } };
    return ok({
      commit: found,
      parent: found.parents[0] ?? null,
      files: [],
      patch: "",
      truncated: false,
      tree: ["README.md"],
      treeTruncated: false,
    } satisfies Writable<GitCommitDetail>);
  },
});

const requestsFor = (project: string) =>
  requests.filter(
    (request) => request.includes(`project=${project}&`) || request.endsWith(`project=${project}`),
  );

afterEach(() => {
  cleanup();
  requests.length = 0;
  globalThis.fetch = bunFetch;
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await GlobalRegistrator.unregister();
});

describe("git tab", () => {
  test("a failed working-tree read shows the server's message, and Retry reads it again", async () => {
    let failing = true;
    serve(
      baseRoutes({
        repos: () => ok([repo({ dirty: true, uncommitted: 1 })]),
        worktree: () =>
          failing
            ? { status: 500, body: { error: "git status exited with 128" } }
            : ok(
                worktree({
                  unstaged: { files: [], patch: "", truncated: false },
                  untracked: ["notes.txt"],
                }),
              ),
      }),
    );
    renderTab();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not read the working tree");
    expect(alert.textContent).toContain("git status exited with 128");
    failing = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "Uncommitted changes" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(requests.filter((request) => request.startsWith("worktree?")).length).toBe(2);
  });

  test("a failed branches read is shown with Retry instead of being dropped", async () => {
    serve(
      baseRoutes({ branches: () => ({ status: 403, body: { error: "repo outside workspace" } }) }),
    );
    renderTab();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not read the branches");
    expect(alert.textContent).toContain("repo outside workspace");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("a checkout with only untracked files gets the uncommitted row and lists them", async () => {
    serve(
      baseRoutes({
        repos: () => ok([repo({ dirty: true, uncommitted: 2 })]),
        worktree: () => ok(worktree({ untracked: ["notes.txt", "src/new.ts"] })),
      }),
    );
    renderTab();
    const pane = await screen.findByRole("region", { name: "Uncommitted changes" });
    expect(pane.textContent).toContain("2 files");
    expect(pane.textContent).toContain("Untracked · 2");
    expect(pane.textContent).toContain("no diff until they are added");
    const list = within(pane).getByRole("list", { name: "Untracked files" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["notes.txt", "src/new.ts"]);
    const history = screen.getByRole("region", { name: "History of services/api" });
    expect(history.textContent).toContain("Uncommitted changes");
  });

  test("HEAD opens preselected, and a row press selects another commit", async () => {
    serve(baseRoutes());
    renderTab();
    await screen.findByRole("heading", { name: "Bump the api to 0.3.0" });
    const history = screen.getByRole("region", { name: "History of services/api" });
    expect(history.getAttribute("data-branch")).toBe("main");
    fireEvent.click(within(history).getByText("Parse amounts from bank exports"));
    await screen.findByRole("heading", { name: "Parse amounts from bank exports" });
    expect(requests).toContain(`commit?project=LGD&repo=services%2Fapi&sha=${OLDER}`);
  });

  test("a branch and a commit chosen in one project stay there when another project has the same repo id", async () => {
    serve(projectRoutes(() => [repo({ id: ".", path: "C:/work/project" })]));
    renderSwitching("/?project=A&view=git&repo=.&branch=feature");
    await screen.findByRole("heading", { name: "Try the feature in A" });
    const history = screen.getByRole("region", { name: "History of project" });
    fireEvent.click(within(history).getByText("Start the feature in A"));
    await screen.findByRole("heading", { name: "Start the feature in A" });

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    await screen.findByRole("heading", { name: "Only commit in B" });
    const inB = requestsFor("B");
    expect(inB.some((request) => request.includes("branch=feature"))).toBe(false);
    expect(inB.some((request) => request.includes(A_FEATURE_OLDER))).toBe(false);
    expect(inB).toContain(`commit?project=B&repo=.&sha=${B_HEAD}`);
    expect(window.location.search).toBe("?project=B&view=git");
  });

  test("a commit route in one project does not follow into a project with other repositories", async () => {
    serve(
      projectRoutes((project) =>
        project === "A"
          ? [repo({ id: "services/api" })]
          : [repo({ id: "web", path: "C:/work/b/web" })],
      ),
    );
    projectLogs["A·main"] = projectLogs["A·feature"] ?? LOG;
    renderSwitching(`/?project=A&view=git&repo=services%2Fapi&commit=${A_FEATURE_HEAD}`);
    await screen.findByRole("button", { name: "History" });

    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    await screen.findByRole("region", { name: "History of web" });
    await screen.findByRole("heading", { name: "Only commit in B" });
    const inB = requestsFor("B");
    expect(inB.some((request) => request.includes("services%2Fapi"))).toBe(false);
    expect(inB.some((request) => request.includes(A_FEATURE_HEAD))).toBe(false);
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    expect(window.location.search).toBe("?project=B&view=git");
    delete projectLogs["A·main"];
  });
  test("a commit with no files leaves All changes with nothing to open", async () => {
    serve(baseRoutes({ commit: () => ok({ ...detail(HEAD), files: [], patch: "", tree: [] }) }));
    renderTab({ commit: HEAD });
    const all = await screen.findByRole("button", { name: /All changes/ });
    expect(all.hasAttribute("disabled")).toBe(true);
    fireEvent.click(all);
    expect(screen.getByRole("button", { name: "History" })).toBeDefined();
  });
});
