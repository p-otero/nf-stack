import { describe, expect, test } from "bun:test";

import type { GitBranch, GitCommit, GitRepo, GitWorktree, GitWorktreeEntry } from "@nf/contracts";
import type { Writable } from "@/contract";

import {
  boardViewHref,
  branchNamesOf,
  firstDiffPath,
  parseBoardView,
  parseGitTabLocation,
  toHistoryCommits,
  repoName,
  shortWorktreePath,
  toRepository,
  toTreeFiles,
  upstreamHeadOf,
  withoutGitLocation,
  worktreeBranchLabel,
  worktreeCounts,
  worktreeOf,
} from "./git-model";

const commit = (overrides: Partial<Writable<GitCommit>> = {}): Writable<GitCommit> => ({
  sha: "9be07d2".padEnd(40, "0"),
  parents: ["abcde".padEnd(40, "1")],
  author: "Ada",
  email: "ada@example.com",
  date: "2026-11-01T10:00:00Z",
  subject: "Rate-limit tokens",
  body: "",
  refs: [],
  filesChanged: 3,
  insertions: 12,
  deletions: 4,
  ...overrides,
});

const worktree = (overrides: Partial<Writable<GitWorktree>> = {}): Writable<GitWorktree> => ({
  repo: ".",
  path: "C:/work/ledger",
  branch: "main",
  head: "f".repeat(40),
  staged: { files: [], patch: "", truncated: false },
  unstaged: { files: [], patch: "", truncated: false },
  untracked: { files: [], patch: "", truncated: false },
  untrackedTruncated: false,
  ...overrides,
});

const worktreeEntry = (
  overrides: Partial<Writable<GitWorktreeEntry>> = {},
): Writable<GitWorktreeEntry> => ({
  path: "C:/work/ledger",
  branch: "main",
  head: "f".repeat(40),
  main: true,
  locked: false,
  prunable: false,
  ...overrides,
});

const change = (path: string) => ({
  path,
  status: "modified" as const,
  from: null,
  additions: null,
  deletions: null,
});

const changeSet = (paths: string[]) => ({
  files: paths.map(change),
  patch: "",
  truncated: false,
});

const branch = (name: string, current: boolean): Writable<GitBranch> => ({
  name,
  head: "a",
  current,
  upstream: null,
  ahead: null,
  behind: null,
  unpushed: null,
  base: "main",
  updatedAt: null,
  author: null,
});

describe("git tab routing", () => {
  test("reads the repository, branch and commit from the page's URL", () => {
    expect(
      parseGitTabLocation(
        "?view=git&repo=api&branch=main&commit=9be07d2&worktree=C%3A%2Fwork%2Fledger%2Ffeat",
      ),
    ).toEqual({
      repo: "api",
      branch: "main",
      commit: "9be07d2",
      worktree: "C:/work/ledger/feat",
    });
  });

  test("an absent or empty parameter is no choice at all", () => {
    expect(parseGitTabLocation("?view=git&repo=&branch=&worktree=")).toEqual({
      repo: null,
      branch: null,
      commit: null,
      worktree: null,
    });
    expect(parseGitTabLocation("")).toEqual({
      repo: null,
      branch: null,
      commit: null,
      worktree: null,
    });
  });

  test("the view is the Tasks board unless the URL names another", () => {
    expect(parseBoardView("?view=git")).toBe("git");
    expect(parseBoardView("?view=telemetry")).toBe("telemetry");
    expect(parseBoardView("?view=tasks")).toBe("tasks");
    expect(parseBoardView("?project=NF")).toBe("tasks");
  });

  test("the Git tab's place stays in the address beside the project", () => {
    expect(
      boardViewHref("http://localhost:4646/?project=NF", "git", {
        repo: "api",
        branch: null,
        commit: "9be07d2",
        worktree: "C:/work/ledger/feat",
      }),
    ).toBe("/?project=NF&view=git&repo=api&commit=9be07d2&worktree=C%3A%2Fwork%2Fledger%2Ffeat");
  });

  test("a project change drops the Git place but keeps the project and the view", () => {
    expect(
      withoutGitLocation(
        "http://127.0.0.1:4646/?project=B&view=git&repo=api&branch=feat&commit=abc&worktree=%2Fw%2Fx",
      ),
    ).toBe("/?project=B&view=git");
  });

  test("leaving the Git tab clears its parameters, and the Tasks board carries no view", () => {
    const href = boardViewHref(
      "http://localhost:4646/?project=NF&view=git&repo=api&branch=main&commit=9be07d2",
      "telemetry",
      { repo: "api", branch: "main", commit: null, worktree: null },
    );
    expect(href).toBe("/?project=NF&view=telemetry");
    expect(
      boardViewHref(`http://localhost:4646${href}`, "tasks", {
        repo: null,
        branch: null,
        commit: null,
        worktree: null,
      }),
    ).toBe("/?project=NF");
  });
});

describe("git tab model", () => {
  test("a repository lists as the picker takes it, with only what the API reported", () => {
    const repo = {
      id: "services/api",
      path: "C:/work/ledger/services/api",
      branch: "main",
      head: "x".repeat(40),
      dirty: false,
      uncommitted: 0,
      ahead: 2,
      behind: null,
      upstream: "origin/main",
      remote: "git@github.com:acme/api.git",
      commits: 120,
    } satisfies Writable<GitRepo>;
    expect(toRepository(repo)).toEqual({
      value: "services/api",
      name: "services/api",
      path: "C:/work/ledger/services/api",
      branch: "main",
      uncommitted: 0,
      ahead: 2,
      behind: null,
      remote: true,
    });
  });

  test("the workspace root goes by its folder's name", () => {
    expect(repoName({ id: ".", path: "C:/work/ledger" })).toBe("ledger");
    expect(repoName({ id: ".", path: "/home/ana/ledger/" })).toBe("ledger");
    expect(repoName({ id: ".", path: "C:\\work\\ledger" })).toBe("ledger");
    expect(repoName({ id: "web", path: "C:/work/ledger/web" })).toBe("web");
  });

  test("a repository without any remote says so; one with a remote but no upstream says nothing", () => {
    const base = {
      id: "docs",
      path: "docs",
      branch: "main",
      head: null,
      dirty: false,
      uncommitted: 0,
      ahead: null,
      behind: null,
      upstream: null,
      remote: null,
      commits: 0,
    } satisfies Writable<GitRepo>;
    expect(toRepository({ ...base, upstream: null, remote: null }).remote).toBe(false);
    expect(
      toRepository({ ...base, upstream: null, remote: "git@github.com:acme/docs.git" }).remote,
    ).toBeUndefined();
  });

  test("a log commit becomes a history row, and unknown counts stay out rather than 0", () => {
    const rows = toHistoryCommits([
      commit({ refs: ["HEAD -> main", "origin/main", "tag: v1.2.0"], body: "Longer story." }),
      commit({ filesChanged: null, insertions: null, deletions: null, body: "  \n" }),
    ]);
    expect(rows[0]).toMatchObject({
      id: "9be07d2".padEnd(40, "0"),
      message: "Rate-limit tokens",
      author: "Ada",
      hash: "9be07d2",
      body: "Longer story.",
      tags: [{ label: "v1.2.0" }],
      stats: { files: 3, additions: 12, deletions: 4 },
    });
    expect(rows[1]?.body).toBeUndefined();
    expect(rows[1]?.stats).toBeUndefined();
    expect(rows[1]?.tags).toEqual([]);
  });

  test("a commit with any unknown count shows no stats instead of a made-up 0", () => {
    const rows = toHistoryCommits([
      commit({ insertions: null }),
      commit({ deletions: null }),
      commit({ insertions: 0, deletions: 7 }),
    ]);
    expect(rows[0]?.stats).toBeUndefined();
    expect(rows[1]?.stats).toBeUndefined();
    expect(rows[2]?.stats).toEqual({ files: 3, additions: 0, deletions: 7 });
  });

  test("the working tree counts each path once, untracked files among the unstaged", () => {
    expect(
      worktreeCounts(
        worktree({
          staged: changeSet(["a.ts", "b.ts"]),
          unstaged: changeSet(["a.ts", "c.ts"]),
          untracked: changeSet(["new.ts"]),
        }),
      ),
    ).toEqual({ staged: 2, unstaged: 3, untracked: 1, files: 4 });
    expect(worktreeCounts(worktree({ untracked: changeSet(["x.md", "y.md"]) }))).toEqual({
      staged: 0,
      unstaged: 2,
      untracked: 2,
      files: 2,
    });
  });

  test("a worktree reads as its branch, or the commit it is detached at", () => {
    expect(worktreeBranchLabel(worktreeEntry())).toBe("main");
    expect(worktreeBranchLabel(worktreeEntry({ branch: null, head: "abc1234def" }))).toBe(
      "Detached at abc1234",
    );
    expect(worktreeBranchLabel(worktreeEntry({ branch: null, head: null }))).toBe("Detached HEAD");
    expect(shortWorktreePath("C:/work/ledger/worktrees/feat-git")).toBe("…/worktrees/feat-git");
    expect(shortWorktreePath("/w/ledger")).toBe("w/ledger");
  });

  test("the URL's worktree is the one picked, or the repository's own when it is gone", () => {
    const main = worktreeEntry();
    const feature = worktreeEntry({ path: "/w/ledger-feat", branch: "feat/git", main: false });
    const pruned = worktreeEntry({
      path: "/w/ledger-gone",
      branch: "feat/gone",
      main: false,
      prunable: true,
    });
    expect(worktreeOf([main, feature], feature.path)).toEqual(feature);
    expect(worktreeOf([main, feature], null)).toEqual(main);
    expect(worktreeOf([main, feature], "/w/elsewhere")).toEqual(main);
    expect(worktreeOf([main, pruned], pruned.path)).toEqual(main);
  });

  test("the upstream's commit is the one git decorates with its name", () => {
    const pushed = commit({ sha: "f".repeat(40), refs: ["origin/main"] });
    const unpushed = commit({ sha: "e".repeat(40) });
    expect(upstreamHeadOf([unpushed, pushed], "origin/main")).toBe("f".repeat(40));
    expect(upstreamHeadOf([unpushed], "origin/main")).toBeUndefined();
    expect(upstreamHeadOf([unpushed, pushed], null)).toBeUndefined();
  });

  test("branches are names for the history's switcher", () => {
    expect(branchNamesOf([branch("main", true), branch("feat/x", false)])).toEqual([
      "main",
      "feat/x",
    ]);
  });

  test("the tree of a commit marks its changed files, and only the statuses the tree can draw", () => {
    const files = toTreeFiles(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "README.md"],
      [
        { path: "src/a.ts", status: "modified", from: null, additions: 1, deletions: 0 },
        { path: "src/b.ts", status: "added", from: null, additions: 5, deletions: null },
        {
          path: "src/c.ts",
          status: "renamed",
          from: "src/old.ts",
          additions: null,
          deletions: null,
        },
        { path: "src/d.ts", status: "copied", from: "src/a.ts", additions: null, deletions: null },
      ],
    );
    expect(files).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
      { path: "src/c.ts", status: "renamed", from: "src/old.ts" },
      { path: "src/d.ts", status: "renamed", from: "src/a.ts" },
      "README.md",
    ]);
  });
});

const patch = (body: string) => `${body}\n`;

describe("firstDiffPath", () => {
  test("a commit with no files has nothing for the diff to open", () => {
    expect(firstDiffPath("")).toBeUndefined();
  });

  test("the first file the patch carries is the one its press opens", () => {
    expect(
      firstDiffPath(
        patch(
          [
            "diff --git a/src/only.ts b/src/only.ts",
            "--- a/src/only.ts",
            "+++ b/src/only.ts",
            "@@ -1 +1 @@",
            "-a",
            "+b",
          ].join("\n"),
        ),
      ),
    ).toBe("src/only.ts");
  });

  test("a binary file the patch names is openable, so the counts-only files after it are not opened instead", () => {
    expect(
      firstDiffPath(
        patch(
          [
            "diff --git a/logo.png b/logo.png",
            "index 1111111..2222222 100644",
            "Binary files a/logo.png and b/logo.png differ",
            "diff --git a/src/only.ts b/src/only.ts",
            "--- a/src/only.ts",
            "+++ b/src/only.ts",
            "@@ -1 +1 @@",
            "-a",
            "+b",
          ].join("\n"),
        ),
      ),
    ).toBe("logo.png");
  });

  test("a deleted file opens under its old path", () => {
    expect(
      firstDiffPath(
        patch(
          [
            "diff --git a/old.ts b/old.ts",
            "deleted file mode 100644",
            "--- a/old.ts",
            "+++ /dev/null",
            "@@ -1 +0,0 @@",
            "-a",
          ].join("\n"),
        ),
      ),
    ).toBe("old.ts");
  });
});
