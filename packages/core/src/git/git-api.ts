import { existsSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NfError, TaskBranchResponse, WRITING_KINDS } from "@nf/contracts";
import type { Attempt, GitBranchCommit, Project, Task, TaskPullRequest } from "@nf/contracts";
import type { PullRequestSource } from "../board/pull-request-source.ts";
import { githubRepository, pullRequestNumber } from "../domain/pull-request.ts";
import { TaskStore } from "../persistence/task-store.persistence.ts";
import { t3WorkspaceRoots } from "../sources/t3-projects.ts";
import { loadProjectConfig } from "../system/project-config.ts";
import { COMMIT_FORMAT, parseCommits } from "./git-diff.ts";
import {
  commitDetail,
  commitLog,
  commitOf,
  compareRefs,
  defaultBranch,
  leftRight,
  listBranches,
  listCommits,
  shas,
} from "./git-history.ts";
import type { LogQuery } from "./git-history.ts";
import { gitText, gitTextOrNull } from "./git-read.ts";
import { listRepos } from "./git-repos.ts";
import { readStatus } from "./git-status.ts";
import { repoId, resolveRepo, workspaceRootOf, worktreeRepository } from "./git-workspace.ts";
import { worktreeChanges } from "./git-worktree.ts";

const BRANCH_COMMIT_LIMIT = 200;

const decodeTaskBranch = Schema.decodeEffect(TaskBranchResponse);

export interface GitApiContext {
  readonly home: string;
  /** T3 Code's `statev2.sqlite`, where a project's workspace root is recorded. */
  readonly t3State: string;
  readonly readPullRequest?: PullRequestSource;
}

interface Workspace {
  readonly project: Project;
  readonly root: string;
}

const projectByPrefix = Effect.fn("GitApi.project")(function* (prefix: string) {
  const store = yield* TaskStore;
  const projects = yield* store.listProjects();
  const project = projects.find((candidate) => candidate.prefix === prefix.toUpperCase());
  if (project === undefined) {
    const known = projects.map((candidate) => candidate.prefix).join(", ") || "none";
    return yield* new NfError({
      code: "not_found",
      message: `project '${prefix}' is not registered (known: ${known})`,
    });
  }
  return project;
});

const workspaceOf = Effect.fnUntraced(function* (context: GitApiContext, project: Project) {
  const roots = yield* t3WorkspaceRoots(context.t3State);
  const workspace: Workspace = { project, root: workspaceRootOf(project.root_path, roots) };
  return workspace;
});

const projectWorkspace = Effect.fnUntraced(function* (context: GitApiContext, prefix: string) {
  return yield* workspaceOf(context, yield* projectByPrefix(prefix));
});

const repoOf = Effect.fnUntraced(function* (context: GitApiContext, prefix: string, repo: string) {
  const workspace = yield* projectWorkspace(context, prefix);
  return { workspace, path: yield* resolveRepo(workspace.root, repo) };
});

export const gitRepos = Effect.fn("GitApi.repos")(function* (
  context: GitApiContext,
  prefix: string,
) {
  const workspace = yield* projectWorkspace(context, prefix);
  return yield* listRepos(workspace.root);
});

export const gitBranches = Effect.fn("GitApi.branches")(function* (
  context: GitApiContext,
  prefix: string,
  repo: string,
) {
  const { workspace, path } = yield* repoOf(context, prefix, repo);
  const config = yield* loadProjectConfig(context.home, workspace.project.prefix);
  return yield* listBranches(path, config.defaultBranch);
});

export const gitLog = Effect.fn("GitApi.log")(function* (
  context: GitApiContext,
  prefix: string,
  repo: string,
  query: LogQuery,
) {
  const { path } = yield* repoOf(context, prefix, repo);
  return yield* commitLog(path, query);
});

export const gitCommit = Effect.fn("GitApi.commit")(function* (
  context: GitApiContext,
  prefix: string,
  repo: string,
  sha: string,
) {
  const { path } = yield* repoOf(context, prefix, repo);
  return yield* commitDetail(path, sha);
});

export const gitCompare = Effect.fn("GitApi.compare")(function* (
  context: GitApiContext,
  prefix: string,
  repo: string,
  base: string,
  head: string,
) {
  const { path } = yield* repoOf(context, prefix, repo);
  return yield* compareRefs(path, base, head);
});

const taskByKey = Effect.fn("GitApi.task")(function* (key: string) {
  const store = yield* TaskStore;
  const task = yield* store.findTaskByKey(key);
  if (task === null) {
    return yield* new NfError({ code: "not_found", message: `task '${key}' is not recorded` });
  }
  return task;
});

/** The latest attempt that recorded a branch or worktree, writing attempts first. */
const codeAttempt = Effect.fnUntraced(function* (task: Task) {
  const store = yield* TaskStore;
  const attempts = (yield* store.listAttempts(task.project_id, task.key)).filter(
    (attempt) => attempt.branch !== null || attempt.worktree !== null,
  );
  const writing = attempts.filter((attempt) => WRITING_KINDS.includes(attempt.kind));
  return writing.at(-1) ?? attempts.at(-1) ?? null;
});

interface TaskCheckout {
  readonly workspace: Workspace;
  readonly attempt: Attempt;
  /** The repository folder, the primary checkout. */
  readonly repo: string;
  /** The attempt's worktree when it still exists. */
  readonly worktree: string | null;
}

const taskCheckout = Effect.fnUntraced(function* (context: GitApiContext, task: Task) {
  const store = yield* TaskStore;
  const workspace = yield* workspaceOf(context, yield* store.getProject(task.project_id));
  const attempt = yield* codeAttempt(task);
  if (attempt === null) return null;
  const worktree =
    attempt.worktree !== null && existsSync(attempt.worktree) ? attempt.worktree : null;
  const repo =
    worktree === null
      ? yield* resolveRepo(workspace.root, workspace.project.root_path)
      : yield* worktreeRepository(workspace.root, worktree);
  const checkout: TaskCheckout = { workspace, attempt, repo, worktree };
  return checkout;
});

export interface WorktreeQuery {
  readonly project: string | null;
  readonly repo: string | null;
  readonly task: string | null;
}

/** Uncommitted changes of a workspace repository, or of a task attempt's worktree. */
export const gitWorktree = Effect.fn("GitApi.worktree")(function* (
  context: GitApiContext,
  query: WorktreeQuery,
) {
  if (query.task !== null) {
    const checkout = yield* taskCheckout(context, yield* taskByKey(query.task));
    if (checkout === null || checkout.worktree === null) {
      return yield* new NfError({
        code: "not_found",
        message: `task '${query.task}' has no worktree on this machine`,
      });
    }
    return yield* worktreeChanges(
      repoId(checkout.workspace.root, checkout.repo),
      checkout.worktree,
    );
  }
  if (query.project === null || query.repo === null) {
    return yield* new NfError({ code: "invalid_value", message: "pass project and repo, or task" });
  }
  const { path } = yield* repoOf(context, query.project, query.repo);
  return yield* worktreeChanges(query.repo, path);
});

const pullRequestOf = Effect.fnUntraced(function* (
  context: GitApiContext,
  attempt: Attempt,
  remoteUrl: string | null,
  branch: string,
) {
  const repository = githubRepository(remoteUrl);
  const recorded = attempt.pr_url ?? null;
  const fact =
    context.readPullRequest === undefined
      ? null
      : recorded === null
        ? yield* context.readPullRequest.byHead(repository, branch)
        : yield* context.readPullRequest.byHref(repository, recorded);
  const url = recorded ?? fact?.href ?? null;
  if (url === null) return null;
  const pullRequest: TaskPullRequest = {
    url,
    number: pullRequestNumber(url),
    state: fact?.state ?? null,
  };
  return pullRequest;
});

interface BranchTracking {
  readonly upstream: string | null;
  readonly upstreamSha: string | null;
  readonly remote: string | null;
}

/** A local branch's upstream, read by its full ref so the name never reaches git as a revision. */
const branchTracking = Effect.fnUntraced(function* (repo: string, ref: string) {
  const text = yield* gitTextOrNull(repo, [
    "for-each-ref",
    "--format=%(refname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:track,nobracket)",
    ref,
  ]);
  for (const line of (text ?? "").split("\n")) {
    const [name = "", upstreamRef = "", upstream = "", remote = "", track = ""] = line.split("\0");
    if (name !== ref) continue;
    const upstreamSha =
      upstreamRef.length > 0 && track !== "gone" ? yield* commitOf(repo, upstreamRef) : null;
    const tracking: BranchTracking = {
      upstream: upstreamSha === null ? null : upstream,
      upstreamSha,
      remote: remote.length > 0 ? remote : null,
    };
    return tracking;
  }
  const none: BranchTracking = { upstream: null, upstreamSha: null, remote: null };
  return none;
});

/** The task's branch: its distance from the base and upstream, its commits and its worktree. */
export const taskBranch = Effect.fn("GitApi.taskBranch")(function* (
  context: GitApiContext,
  key: string,
) {
  const task = yield* taskByKey(key);
  const checkout = yield* taskCheckout(context, task);
  if (checkout === null) return yield* decodeTaskBranch(null);
  const { attempt, workspace, repo, worktree } = checkout;
  const status = worktree === null ? null : yield* readStatus(worktree);
  const name = attempt.branch ?? status?.branch ?? null;
  if (name === null) return yield* decodeTaskBranch(null);
  const ref = `refs/heads/${name}`;
  const head = yield* commitOf(repo, ref);
  const config = yield* loadProjectConfig(context.home, workspace.project.prefix);
  const base = yield* defaultBranch(repo, config.defaultBranch);
  const tracking = yield* branchTracking(repo, ref);
  const [ahead, behind] =
    head === null || base === null ? [null, null] : yield* leftRight(repo, head, base.sha);
  const unpushedText =
    head === null
      ? null
      : tracking.upstreamSha === null
        ? yield* listCommits(repo, head, base === null ? [] : [base.sha], "list", {
            excludeRemotes: true,
          })
        : yield* listCommits(repo, head, [tracking.upstreamSha], "list");
  const unpushed = new Set((unpushedText ?? "").split("\n").filter((sha) => sha.length > 0));
  const logged =
    head === null
      ? ""
      : yield* gitText(repo, [
          "log",
          "--topo-order",
          "--shortstat",
          COMMIT_FORMAT,
          `--max-count=${BRANCH_COMMIT_LIMIT + 1}`,
          "--end-of-options",
          ...shas([head]),
          ...(base === null ? [] : shas([base.sha]).map((sha) => `^${sha}`)),
          "--",
        ]);
  const commits: GitBranchCommit[] = parseCommits(logged).map((commit) =>
    Object.assign(commit, { pushed: unpushedText !== null && !unpushed.has(commit.sha) }),
  );
  const remoteUrl = yield* gitTextOrNull(repo, [
    "config",
    "--get",
    `remote.${tracking.remote ?? "origin"}.url`,
  ]);
  return yield* decodeTaskBranch({
    task: task.key,
    attempt: attempt.key,
    repo: repoId(workspace.root, repo),
    repoPath: repo.split("\\").join("/"),
    name,
    head,
    base: base?.name ?? null,
    upstream: tracking.upstream,
    ahead,
    behind,
    unpushed: head === null || unpushedText === null ? null : unpushed.size,
    worktree: worktree === null ? null : worktree.split("\\").join("/"),
    uncommitted: status === null ? null : status.uncommitted,
    commits: commits.slice(0, BRANCH_COMMIT_LIMIT),
    commitsTruncated: commits.length > BRANCH_COMMIT_LIMIT,
    pullRequest: yield* pullRequestOf(context, attempt, remoteUrl, name),
  });
});
