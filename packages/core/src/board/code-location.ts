import * as Effect from "effect/Effect";
import { LOCATION_STAGE, TASK_LINK_KIND, TASK_LINK_STATE } from "@nf/contracts";
import type { TaskLink, TaskLocation } from "@nf/contracts";
import {
  githubRepository,
  githubRepoUrl,
  pullRequestNumber,
  repositoryCommitUrl,
  repositoryTreeUrl,
} from "../domain/pull-request.ts";
import type { GitHubRepository } from "../domain/pull-request.ts";
import { gitTextOrNull } from "../git/git-read.ts";
import type { ProjectStageSpec, ResolvedProjectConfig } from "../system/project-config.ts";
import { effectMemo } from "./effect-memo.ts";
import { ghPullRequestSource } from "./pull-request-source.ts";
import type { PullRequestFact, PullRequestSource } from "./pull-request-source.ts";

export interface BoardStage {
  readonly id: string;
  readonly label: string;
  readonly tone?: string;
}

const BRANCH_STAGE: BoardStage = { id: LOCATION_STAGE.BRANCH, label: "Branch", tone: "info" };
const PR_STAGE: BoardStage = { id: LOCATION_STAGE.PR, label: "PR", tone: "warning" };
const MERGED_STAGE: BoardStage = { id: LOCATION_STAGE.MERGED, label: "Merged", tone: "success" };

/**
 * The stages the board shows and filters by. Without a project config: branch, PR, merged. With
 * environments: branch and PR while the code is still on its way, then the environments in order.
 */
export function boardStages(config: ResolvedProjectConfig): BoardStage[] {
  if (config.stages.length === 0) return [BRANCH_STAGE, PR_STAGE, MERGED_STAGE];
  return [
    BRANCH_STAGE,
    PR_STAGE,
    ...config.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      ...(stage.tone === null ? {} : { tone: stage.tone }),
    })),
  ];
}

/** One read-only git question; an unreadable repository answers null instead of failing. */
const git = (root: string, args: readonly string[]): Effect.Effect<string | null> =>
  gitTextOrNull(root, args);

export interface GitProbe {
  readonly root: string;
  ref(ref: string): Effect.Effect<string | null>;
  contains(commit: string, ref: string): Effect.Effect<boolean>;
  tags(pattern: string, commit: string): Effect.Effect<readonly string[]>;
}

/**
 * Git answers memoized per question: every branch tip of a repository costs one `for-each-ref`,
 * and everything a branch contains costs one `rev-list` instead of one process per attempt. A
 * caller that polls passes the probe back instead of re-reading them.
 */
export function gitProbe(root: string): GitProbe {
  const snapshots = effectMemo<ReadonlyMap<string, string>>();
  const reachable = effectMemo<ReadonlySet<string>>();
  const single = effectMemo<string | null>();
  const found = effectMemo<readonly string[]>();
  const branchTips = () =>
    snapshots.read("branches", () =>
      Effect.map(
        git(root, [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)",
          "refs/heads",
          "refs/remotes",
        ]),
        (listed) =>
          new Map(
            (listed ?? "")
              .split("\n")
              .map((line) => line.split("\u0000"))
              .filter((fields): fields is [string, string] => fields.length === 2)
              .map(([name, sha]) => [name, sha] as const),
          ),
      ),
    );
  const ref = (name: string): Effect.Effect<string | null> => {
    const target = name.endsWith("^{commit}") ? name.slice(0, -"^{commit}".length) : name;
    if (!target.startsWith("refs/heads/") && !target.startsWith("refs/remotes/")) {
      return single.read(name, () => git(root, ["rev-parse", "--verify", "--quiet", name]));
    }
    return Effect.map(branchTips(), (tips) => tips.get(target) ?? null);
  };
  const reachableFrom = (name: string) =>
    reachable.read(name, () =>
      Effect.map(
        git(root, ["rev-list", "--end-of-options", name]),
        (listed) =>
          new Set(
            (listed ?? "")
              .split("\n")
              .map((sha) => sha.trim())
              .filter((sha) => sha.length > 0),
          ),
      ),
    );
  const contains = Effect.fn("Board.gitProbe.contains")(function* (commit: string, name: string) {
    const resolved = yield* ref(`${commit}^{commit}`);
    if (resolved === null) return false;
    const commits = yield* reachableFrom(name);
    return commits.has(resolved);
  });
  const tags = (pattern: string, commit: string) =>
    found.read(`${pattern}\u0000${commit}`, () =>
      Effect.map(
        git(root, ["tag", "--list", pattern, "--contains", commit, "--sort=-v:refname"]),
        (listed) =>
          listed === null
            ? []
            : listed
                .split("\n")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0),
      ),
    );
  return { root, ref, contains, tags };
}

/** The branch merges land on: configured, else `origin/HEAD`, else an existing `main`/`master`. */
const detectDefaultBranch = Effect.fn("Board.detectDefaultBranch")(function* (
  probe: GitProbe,
  configured: string | null,
) {
  if (configured !== null) return configured;
  const head = yield* git(probe.root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head !== null && head.length > 0) return head.replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    if ((yield* probe.ref(`refs/heads/${name}`)) !== null) return name;
  }
  return null;
});

export interface LocationContext {
  readonly remoteUrl: string | null;
  readonly repository: GitHubRepository | null;
  readonly defaultBranch: string | null;
  readonly stages: readonly ProjectStageSpec[];
  readonly pullRequest: PullRequestSource;
  readonly probe: GitProbe;
}

/** Everything the derivation needs about the project's repository and config. */
export const locationContext = Effect.fn("Board.locationContext")(function* (options: {
  root: string;
  remoteUrl: string | null;
  config: ResolvedProjectConfig;
  pullRequest?: PullRequestSource;
  /** Answers from an earlier derivation; without it every call probes the repository itself. */
  probe?: GitProbe;
}) {
  const probe = options.probe ?? gitProbe(options.root);
  const context: LocationContext = {
    remoteUrl: options.remoteUrl,
    repository: githubRepository(options.remoteUrl),
    defaultBranch: yield* detectDefaultBranch(probe, options.config.defaultBranch),
    stages: options.config.stages,
    pullRequest: options.pullRequest ?? ghPullRequestSource(),
    probe,
  };
  return context;
});

/** What one attempt recorded about its code. */
export interface AttemptCode {
  readonly branch: string | null;
  readonly commits: readonly string[];
  readonly pr_url: string | null;
}

export interface CodeEvidence {
  /** Absent when the task has no code yet. */
  readonly location: TaskLocation | null;
  readonly links: readonly TaskLink[];
}

const branchTip = Effect.fnUntraced(function* (probe: GitProbe, branch: string) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const commit = yield* probe.ref(`${ref}^{commit}`);
    if (commit !== null) return commit;
  }
  return null;
});

const headCommit = Effect.fnUntraced(function* (evidence: AttemptCode, ctx: LocationContext) {
  for (const sha of evidence.commits.toReversed()) {
    if ((yield* ctx.probe.ref(`${sha}^{commit}`)) !== null) return sha;
  }
  return evidence.branch === null ? null : yield* branchTip(ctx.probe, evidence.branch);
});

const repoUrl = (ctx: LocationContext): string | null => githubRepoUrl(ctx.remoteUrl);

const withHref = (stage: string, href: string | null | undefined): TaskLocation =>
  href === null || href === undefined ? { stage } : { stage, href };

const treeHref = (ctx: LocationContext, ref: string | null): string | null => {
  const repo = repoUrl(ctx);
  return repo === null || ref === null ? null : repositoryTreeUrl(repo, ref);
};

const commitHref = (ctx: LocationContext, sha: string): string | null => {
  const repo = repoUrl(ctx);
  return repo === null ? null : repositoryCommitUrl(repo, sha);
};

/** The ref of an environment that contains the attempt's head, or null. */
const stageRef = Effect.fnUntraced(function* (
  stage: ProjectStageSpec,
  evidence: AttemptCode,
  head: string | null,
  pr: PullRequestFact | null,
  ctx: LocationContext,
) {
  if (stage.branch !== null) {
    if (evidence.branch === stage.branch) return stage.branch;
    if (head !== null) {
      for (const ref of [`refs/heads/${stage.branch}`, `refs/remotes/origin/${stage.branch}`]) {
        if (yield* ctx.probe.contains(head, ref)) return stage.branch;
      }
    }
    if (pr?.state === TASK_LINK_STATE.MERGED && pr.baseBranch === stage.branch) return stage.branch;
    return null;
  }
  if (stage.tag === null || head === null) return null;
  return (yield* ctx.probe.tags(stage.tag, head))[0] ?? null;
});

/** The attempt's recorded PR, else the most recent one its branch opened. */
const attemptPullRequest = (
  evidence: AttemptCode,
  ctx: LocationContext,
): Effect.Effect<PullRequestFact | null> => {
  if (evidence.pr_url !== null) return ctx.pullRequest.byHref(ctx.repository, evidence.pr_url);
  return evidence.branch === null
    ? Effect.succeed(null)
    : ctx.pullRequest.byHead(ctx.repository, evidence.branch);
};

const attemptLocation = Effect.fnUntraced(function* (
  evidence: AttemptCode,
  pr: PullRequestFact | null,
  ctx: LocationContext,
) {
  const head = yield* headCommit(evidence, ctx);
  if (ctx.stages.length > 0) {
    for (const stage of ctx.stages.toReversed()) {
      const ref = yield* stageRef(stage, evidence, head, pr, ctx);
      if (ref !== null) return withHref(stage.id, treeHref(ctx, ref));
    }
    if (pr !== null) return withHref(LOCATION_STAGE.PR, pr.href);
    if (evidence.pr_url !== null) return withHref(LOCATION_STAGE.PR, evidence.pr_url);
    if (evidence.branch !== null)
      return withHref(LOCATION_STAGE.BRANCH, treeHref(ctx, evidence.branch));
    if (head !== null) return withHref(LOCATION_STAGE.BRANCH, commitHref(ctx, head));
    return null;
  }
  const mergedInDefault =
    head !== null && ctx.defaultBranch !== null
      ? (yield* ctx.probe.contains(head, `refs/heads/${ctx.defaultBranch}`)) ||
        (yield* ctx.probe.contains(head, `refs/remotes/origin/${ctx.defaultBranch}`))
      : false;
  if (pr?.state === TASK_LINK_STATE.MERGED || mergedInDefault) {
    return withHref(
      LOCATION_STAGE.MERGED,
      pr?.href ?? evidence.pr_url ?? treeHref(ctx, ctx.defaultBranch),
    );
  }
  if (pr !== null) return withHref(LOCATION_STAGE.PR, pr.href);
  if (evidence.pr_url !== null) return withHref(LOCATION_STAGE.PR, evidence.pr_url);
  if (evidence.branch !== null)
    return withHref(LOCATION_STAGE.BRANCH, treeHref(ctx, evidence.branch));
  if (head !== null) return withHref(LOCATION_STAGE.BRANCH, commitHref(ctx, head));
  return null;
});

function scanLinks(
  ctx: LocationContext,
  evidence: AttemptCode,
  found: PullRequestFact | null,
): TaskLink[] {
  const links: TaskLink[] = [];
  const prHref = evidence.pr_url ?? found?.href ?? null;
  if (prHref !== null) {
    const number = pullRequestNumber(prHref);
    links.push({
      kind: TASK_LINK_KIND.PULL_REQUEST,
      href: prHref,
      label: number === null ? "PR" : `#${number}`,
      ...(found === null ? {} : { state: found.state }),
    });
  }
  const branch = treeHref(ctx, evidence.branch);
  if (evidence.branch !== null && branch !== null) {
    links.push({ kind: TASK_LINK_KIND.BRANCH, href: branch, label: evidence.branch });
  }
  for (const sha of evidence.commits) {
    const href = commitHref(ctx, sha);
    if (href !== null) {
      links.push({ kind: TASK_LINK_KIND.COMMIT, href, label: sha.slice(0, 7) });
    }
  }
  return links;
}

function stageOrder(ctx: LocationContext): readonly string[] {
  return ctx.stages.length === 0
    ? [LOCATION_STAGE.BRANCH, LOCATION_STAGE.PR, LOCATION_STAGE.MERGED]
    : [LOCATION_STAGE.BRANCH, LOCATION_STAGE.PR, ...ctx.stages.map((stage) => stage.id)];
}

/**
 * Where the task's code is and where it can be read, from its attempts' recorded branches,
 * commits and PRs: git containment decides the environment, `gh` only adds the PR's state and a
 * base branch that catches a squash merge git cannot see.
 */
export const codeEvidence = Effect.fn("Board.codeEvidence")(function* (
  attempts: readonly AttemptCode[],
  ctx: LocationContext,
) {
  const order = stageOrder(ctx);
  const links = new Map<string, TaskLink>();
  let location: TaskLocation | null = null;
  let rank = -1;
  for (const recorded of attempts) {
    const found = yield* attemptPullRequest(recorded, ctx);
    const next = yield* attemptLocation(recorded, found, ctx);
    if (next !== null) {
      const rankOf = order.indexOf(next.stage);
      if (rankOf > rank) {
        rank = rankOf;
        location = next;
      }
    }
    for (const link of scanLinks(ctx, recorded, found)) {
      links.set(`${link.kind}\u0000${link.href}`, link);
    }
  }
  const evidence: CodeEvidence = { location, links: [...links.values()] };
  return evidence;
});
