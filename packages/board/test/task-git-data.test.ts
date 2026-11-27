import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import type { GitBranchCommit, GitCommitDetail, GitWorktree, TaskBranch } from "@nf/contracts";
import {
  branchHistoryHref,
  projectOfTask,
  readCommitDetail,
  readTaskBranch,
  readTaskWorktree,
  toPatchSet,
  toWorktreeChanges,
} from "../src/components/nf/task-git-data";
import { uncommittedText } from "../src/components/nf/branch-badges";
import { worktreeState } from "../src/components/nf/task-git-state";

const answer = (status: number, body: unknown) =>
  spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body, { status }));

afterEach(() => {
  mock.restore();
});

const commit: GitBranchCommit = {
  sha: "a1b2c3d4e5f6a7b8c9d0",
  parents: ["0f0f0f0f"],
  subject: "Retry failed deliveries with full-jitter backoff",
  body: "",
  refs: [],
  author: "Sasha Rivera",
  email: "sasha@harbor.example",
  date: "2026-11-19T20:10:00Z",
  pushed: false,
  filesChanged: 1,
  insertions: 12,
  deletions: 3,
};

describe("task git data", () => {
  test("keys the git endpoints on the task's project prefix", () => {
    expect(projectOfTask("NF-055")).toBe("NF");
    expect(() => projectOfTask("not a key")).toThrow("'not a key' is not a task key");
  });

  test("links branch history to the Git tab, keeping the board's other parameters", () => {
    expect(
      branchHistoryHref("http://127.0.0.1:4317/board?project=EK&view=tasks&commit=abc", {
        task: "NF-055",
        repo: "nf-stack",
        name: "feat/nf-055-task-dialog",
      }),
    ).toBe("/board?project=NF&view=git&repo=nf-stack&branch=feat%2Fnf-055-task-dialog");
  });

  test("sums a change set's lines, leaving binary files out of the totals", () => {
    expect(
      toPatchSet({
        files: [
          { path: "src/a.ts", status: "modified", from: null, additions: 4, deletions: 1 },
          { path: "logo.png", status: "added", from: null, additions: null, deletions: null },
        ],
        patch: "diff --git",
        truncated: false,
      }),
    ).toEqual({ files: 2, additions: 4, deletions: 1, patch: "diff --git", truncation: null });
  });

  test("names the files a truncated commit's patch leaves out", async () => {
    const detail: GitCommitDetail = {
      commit,
      parent: "0f0f0f0f",
      files: [
        { path: "src/dispatch.ts", status: "modified", from: null, additions: 12, deletions: 3 },
        {
          path: "src/web hooks/backoff.ts",
          status: "added",
          from: null,
          additions: 40,
          deletions: 0,
        },
        { path: "test/dispatch.test.ts", status: "added", from: null, additions: 9, deletions: 0 },
        {
          path: "test/fixtures/large.json",
          status: "added",
          from: null,
          additions: 90000,
          deletions: 0,
        },
      ],
      patch: [
        "diff --git a/src/dispatch.ts b/src/dispatch.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "diff --git a/src/web hooks/backoff.ts b/src/web hooks/backoff.ts",
        "@@ -0,0 +1 @@",
        "+c",
        "",
      ].join("\n"),
      truncated: true,
      tree: [],
      treeTruncated: false,
    };
    answer(200, detail);
    expect(toPatchSet(await readCommitDetail("SS", ".", commit.sha)).truncation).toEqual({
      shown: 2,
      total: 4,
      missing: ["test/dispatch.test.ts", "test/fixtures/large.json"],
    });
    answer(200, { ...detail, truncated: false });
    expect(toPatchSet(await readCommitDetail("SS", ".", commit.sha)).truncation).toBeNull();
  });

  test("reads no branch as null and a server error as its message", async () => {
    answer(200, null);
    expect(await readTaskBranch("NF-055")).toBeNull();
    answer(500, { error: "git is not installed" });
    await expect(readTaskBranch("NF-055")).rejects.toThrow("git is not installed");
    answer(200, { task: "NF-055" });
    await expect(readTaskBranch("NF-055")).rejects.toThrow("unexpected task branch");
  });

  test("accepts a branch with its commits", async () => {
    const branch = {
      task: "NF-055",
      name: "feat/nf-055-task-dialog",
      ahead: 1,
      commits: [commit],
    } as unknown as TaskBranch;
    answer(200, branch);
    expect(await readTaskBranch("NF-055")).toEqual(branch);
  });

  const dirty: GitWorktree = {
    repo: ".",
    path: "C:/work/worktrees/ss-1",
    branch: "feat/webhook-backoff",
    head: "f60267d7a60e7e9cd2888807851a0d964f63d0a9",
    staged: {
      files: [
        { path: "src/dispatch.ts", status: "modified", from: null, additions: 3, deletions: 1 },
      ],
      patch: "diff --git a/src/dispatch.ts b/src/dispatch.ts",
      truncated: false,
    },
    unstaged: {
      files: [
        { path: "src/dispatch.ts", status: "modified", from: null, additions: 1, deletions: 1 },
      ],
      patch: "diff --git a/src/dispatch.ts b/src/dispatch.ts",
      truncated: false,
    },
    untracked: {
      files: [
        { path: "test/dispatch.test.ts", status: "added", from: null, additions: 2, deletions: 0 },
      ],
      patch: "diff --git a/test/dispatch.test.ts b/test/dispatch.test.ts",
      truncated: false,
    },
    untrackedTruncated: false,
  };

  test("counts each uncommitted path once, untracked files included", async () => {
    answer(200, dirty);
    const changes = toWorktreeChanges(await readTaskWorktree("SS-001"));
    expect(changes.staged.files).toBe(1);
    expect(changes.unstaged.files).toBe(1);
    expect(changes.untracked).toEqual(["test/dispatch.test.ts"]);
    expect(changes.uncommitted).toBe(2);
    expect(uncommittedText({ kind: "ready", changes })).toBe("2 uncommitted");
    expect(
      uncommittedText({
        kind: "ready",
        changes: toWorktreeChanges({ ...dirty, untrackedTruncated: true }),
      }),
    ).toBe("2+ uncommitted");
  });

  test("keeps a truncated worktree's staged and unstaged cuts apart", async () => {
    answer(200, {
      ...dirty,
      staged: {
        files: [
          { path: "src/dispatch.ts", status: "modified", from: null, additions: 3, deletions: 1 },
          { path: "dist/bundle.js", status: "added", from: null, additions: 40000, deletions: 0 },
        ],
        patch: "diff --git a/src/dispatch.ts b/src/dispatch.ts",
        truncated: true,
      },
    });
    const changes = toWorktreeChanges(await readTaskWorktree("SS-001"));
    expect(changes.staged.truncation).toEqual({
      shown: 1,
      total: 2,
      missing: ["dist/bundle.js"],
    });
    expect(changes.unstaged.truncation).toBeNull();
    expect(changes.uncommitted).toBe(3);
  });

  test("rejects a worktree answer without its untracked files", async () => {
    const { untracked: _untracked, ...older } = dirty;
    answer(200, older);
    await expect(readTaskWorktree("SS-001")).rejects.toThrow("unexpected worktree");
  });

  test("keeps a failed worktree read as an error with a retry, never as a clean worktree", async () => {
    answer(500, { error: "git status failed" });
    const error = await readTaskWorktree("SS-001").catch((cause: unknown) => cause as Error);
    let retried = 0;
    const state = worktreeState(true, {
      isPending: false,
      isError: true,
      error,
      data: undefined,
      refetch: async () => (retried += 1),
    });
    expect(state).toMatchObject({ kind: "error", message: "git status failed" });
    expect(uncommittedText(state)).toBeNull();
    if (state.kind === "error") state.retry();
    expect(retried).toBe(1);
    expect(
      worktreeState(true, {
        isPending: true,
        isError: false,
        error: null,
        data: undefined,
        refetch: async () => 0,
      }),
    ).toEqual({ kind: "loading" });
    expect(
      worktreeState(false, {
        isPending: true,
        isError: false,
        error: null,
        data: undefined,
        refetch: async () => 0,
      }),
    ).toEqual({ kind: "none" });
  });
});
