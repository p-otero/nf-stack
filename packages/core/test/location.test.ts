import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  boardStages,
  boardViews,
  codeEvidence,
  ghPullRequestSource,
  githubRepository,
  githubRepoUrl,
  loadProjectConfig,
  locationContext,
  parseProjectConfig,
  pullRequestHref,
} from "../src/index.ts";
import type {
  AttemptCode,
  AttemptPatch,
  LocationContext,
  ProjectStageSpec,
  PullRequestFact,
  PullRequestSource,
  ResolvedProjectConfig,
} from "../src/index.ts";
import {
  addTask,
  cleanupAll,
  fakeGh,
  fixture,
  openStore,
  rejection,
  startImpl,
  tempDir,
} from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

afterEach(cleanupAll);

const AT = "2026-01-01T12:00:00.000Z";
const GITHUB_REMOTE = "https://github.com/o/demo.git";
const PR_URL = "https://github.com/o/demo/pull/7";

const DEFAULT_CONFIG: ResolvedProjectConfig = {
  t3DeepLinks: true,
  defaultBranch: null,
  stages: [],
  themes: ["light", "dark"],
  uiReview: null,
};

const stage = (id: string, branch: string | null, tag: string | null = null): ProjectStageSpec => ({
  id,
  label: id,
  tone: null,
  branch,
  tag,
});

const ENV_CONFIG: ResolvedProjectConfig = {
  t3DeepLinks: false,
  defaultBranch: null,
  stages: [stage("dev", "develop"), stage("prod", "main")],
  themes: ["light", "dark"],
  uiReview: null,
};

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(repo: string, name: string, text: string, message: string): string {
  writeFileSync(join(repo, name), text);
  git(repo, ["add", name]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function gitRepo(): string {
  const root = tempDir("nf-git-");
  git(root, ["init", "-q", "-b", "main"]);
  return root;
}

interface Code {
  base: string;
  feature: string;
}

/** `main` has a base commit and a feature branch with a commit of its own. */
function featureBranch(root: string): Code {
  const base = commit(root, "base.txt", "base", "base");
  git(root, ["checkout", "-q", "-b", "feature/x"]);
  const feature = commit(root, "feature.txt", "feature", "feature");
  git(root, ["checkout", "-q", "main"]);
  commit(root, "main.txt", "main", "main");
  return { base, feature };
}

function merge(root: string, from: string, into: string): void {
  git(root, ["checkout", "-q", into]);
  git(root, ["merge", "-q", "--no-ff", "-m", `merge ${from} into ${into}`, from]);
}

function context(
  root: string,
  config: ResolvedProjectConfig,
  pullRequest: PullRequestSource = NO_PULL_REQUESTS,
) {
  return locationContext({ root, remoteUrl: GITHUB_REMOTE, config, pullRequest });
}

const code = (over: Partial<AttemptCode> = {}): AttemptCode => ({
  branch: null,
  commits: [],
  pr_url: null,
  ...over,
});

const NO_PULL_REQUESTS: PullRequestSource = {
  byHref: () => Effect.succeed(null),
  byHead: () => Effect.succeed(null),
};

const prSource = (fact: Omit<PullRequestFact, "href"> | null): PullRequestSource => ({
  byHref: () => Effect.succeed(fact === null ? null : { ...fact, href: PR_URL }),
  byHead: () => Effect.succeed(null),
});

/** The code evidence of `attempts` in one location context. */
const evidenceOf = (attempts: readonly AttemptCode[], location: Effect.Effect<LocationContext>) =>
  Effect.runPromise(Effect.flatMap(location, (resolved) => codeEvidence(attempts, resolved)));

const OPEN_PR: PullRequestSource = prSource({ state: "open", baseBranch: "main" });
const MERGED_PR_DEVELOP: PullRequestSource = prSource({ state: "merged", baseBranch: "develop" });

const parseConfig = (text: string) => Effect.runPromise(parseProjectConfig(text, "test.yaml"));
const parseConfigError = (text: string) =>
  rejection(parseConfig(text)).then((error) => error.message);

async function attemptWith(f: Fixture, over: AttemptPatch) {
  const task = await addTask(f, { title: "Located" });
  const attempt = await startImpl(f, task.key);
  await f.store.updateAttempt(f.projectId, attempt.key, over);
  return { task, attempt };
}

const locatedViews = (f: Fixture) =>
  f.run(boardViews(f.projectId, AT, { home: f.home, readPullRequest: NO_PULL_REQUESTS }));

describe("code location", () => {
  test("a task without a branch, commit or PR has no location and no links", async () => {
    const evidence = await evidenceOf([code()], context(gitRepo(), DEFAULT_CONFIG));
    expect(evidence).toEqual({ location: null, links: [] });
  });

  test("a branch that is not merged yet shows the branch stage and its GitHub link", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, DEFAULT_CONFIG),
    );
    expect(evidence.location).toEqual({
      stage: "branch",
      href: "https://github.com/o/demo/tree/feature/x",
    });
    expect(evidence.links).toEqual([
      {
        kind: "branch",
        href: "https://github.com/o/demo/tree/feature/x",
        label: "feature/x",
      },
      {
        kind: "commit",
        href: `https://github.com/o/demo/commit/${feature}`,
        label: feature.slice(0, 7),
      },
    ]);
  });

  test("commits contained in the default branch reach merged, recorded short or full", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    merge(root, "feature/x", "main");
    const short = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature.slice(0, 7)] })],
      context(root, DEFAULT_CONFIG),
    );
    expect(short.location).toEqual({
      stage: "merged",
      href: "https://github.com/o/demo/tree/main",
    });
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, DEFAULT_CONFIG),
    );
    expect(evidence.location).toEqual({
      stage: "merged",
      href: "https://github.com/o/demo/tree/main",
    });
  });

  test("an open pull request stops at the pr stage and carries its state", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature], pr_url: PR_URL })],
      context(root, DEFAULT_CONFIG, OPEN_PR),
    );
    expect(evidence.location).toEqual({ stage: "pr", href: PR_URL });
    expect(evidence.links.find((link) => link.kind === "pull-request")).toEqual({
      kind: "pull-request",
      href: PR_URL,
      label: "#7",
      state: "open",
    });
  });

  test("a merged pull request reaches the environment its base branch names", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    const evidence = await evidenceOf(
      [code({ branch: "feature/squash", commits: [feature], pr_url: PR_URL })],
      context(root, ENV_CONFIG, MERGED_PR_DEVELOP),
    );
    expect(evidence.location).toEqual({
      stage: "dev",
      href: "https://github.com/o/demo/tree/develop",
    });
  });

  test("a branch without a recorded PR takes the pull request found for it", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    const found = "https://github.com/o/demo/pull/9";
    const source: PullRequestSource = {
      byHref: () => Effect.succeed(null),
      byHead: () => Effect.succeed({ href: found, state: "open", baseBranch: null }),
    };
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, DEFAULT_CONFIG, source),
    );
    expect(evidence.location).toEqual({ stage: "pr", href: found });
    expect(evidence.links.find((link) => link.kind === "pull-request")).toEqual({
      kind: "pull-request",
      href: found,
      label: "#9",
      state: "open",
    });
  });

  test("a squash-merged branch shows merged from the pull request found for it", async () => {
    const gh = fakeGh();
    gh.configure({
      tokens: { o: "owner-token" },
      list: [
        {
          number: 9,
          state: "MERGED",
          url: "https://github.com/o/demo/pull/9",
          isDraft: false,
          baseRefName: "main",
          headRefName: "feature/x",
          mergedAt: "2026-11-16T10:00:00Z",
        },
      ],
    });
    const root = gitRepo();
    const { feature } = featureBranch(root);
    git(root, ["merge", "-q", "--squash", "feature/x"]);
    commit(root, "squash.txt", "squashed", "squash feature/x");
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, DEFAULT_CONFIG, ghPullRequestSource({ command: gh.command })),
    );
    expect(evidence.location).toEqual({
      stage: "merged",
      href: "https://github.com/o/demo/pull/9",
    });
    const looked = gh.calls().find((call) => call.args[0] === "pr" && call.args[1] === "list");
    expect(looked?.args).toEqual([
      "pr",
      "list",
      "--repo",
      "o/demo",
      "--state",
      "all",
      "--limit",
      "100",
      "--json",
      "number,url,state,isDraft,baseRefName,headRefName,mergedAt",
    ]);
    expect(looked?.token).toBe("owner-token");
  });

  test("environment branches are ordered and the furthest containing one wins", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    git(root, ["branch", "develop"]);
    merge(root, "feature/x", "develop");
    const devEvidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, ENV_CONFIG),
    );
    expect(devEvidence.location?.stage).toBe("dev");

    merge(root, "develop", "main");
    const prodEvidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, ENV_CONFIG),
    );
    expect(prodEvidence.location).toEqual({
      stage: "prod",
      href: "https://github.com/o/demo/tree/main",
    });
  });

  test("a tag stage matches its glob and links the tag", async () => {
    const root = gitRepo();
    const { feature } = featureBranch(root);
    merge(root, "feature/x", "main");
    git(root, ["tag", "v1.2.3"]);
    const config: ResolvedProjectConfig = {
      ...DEFAULT_CONFIG,
      stages: [stage("release", null, "v*")],
    };
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature] })],
      context(root, config),
    );
    expect(evidence.location).toEqual({
      stage: "release",
      href: "https://github.com/o/demo/tree/v1.2.3",
    });
  });

  test("a missing gh keeps the PR link and derives the stage from git", async () => {
    const absent = ghPullRequestSource({ command: ["nf-gh-does-not-exist"] });
    expect(
      await Effect.runPromise(absent.byHref(githubRepository(GITHUB_REMOTE), PR_URL)),
    ).toBeNull();
    const root = gitRepo();
    const { feature } = featureBranch(root);
    const evidence = await evidenceOf(
      [code({ branch: "feature/x", commits: [feature], pr_url: PR_URL })],
      context(root, DEFAULT_CONFIG, absent),
    );
    expect(evidence.location).toEqual({ stage: "pr", href: PR_URL });
    expect(evidence.links[0]).toEqual({
      kind: "pull-request",
      href: PR_URL,
      label: "#7",
    });
  });

  test("the stage list defaults to branch, pr, merged and prepends the environments", () => {
    expect(boardStages(DEFAULT_CONFIG).map((item) => item.id)).toEqual(["branch", "pr", "merged"]);
    expect(boardStages(ENV_CONFIG).map((item) => item.id)).toEqual(["branch", "pr", "dev", "prod"]);
    expect(boardStages(ENV_CONFIG)[2]).toEqual({ id: "dev", label: "dev" });
  });
});

describe("GitHub references", () => {
  test("repo and pull request URLs come from every remote form, and only from GitHub", () => {
    expect(githubRepoUrl(GITHUB_REMOTE)).toBe("https://github.com/o/demo");
    expect(githubRepoUrl("git@github.com:o/demo.git")).toBe("https://github.com/o/demo");
    expect(githubRepoUrl("ssh://git@github.com/o/demo.git")).toBe("https://github.com/o/demo");
    expect(githubRepoUrl("https://example.test/o/demo.git")).toBeNull();
    expect(githubRepoUrl(null)).toBeNull();
    expect(pullRequestHref("12", GITHUB_REMOTE)).toBe("https://github.com/o/demo/pull/12");
    expect(pullRequestHref("#12", GITHUB_REMOTE)).toBe("https://github.com/o/demo/pull/12");
    expect(pullRequestHref("12", "https://example.test/o/demo.git")).toBeNull();
    expect(pullRequestHref(PR_URL, null)).toBe(PR_URL);
    expect(pullRequestHref("not a pr", GITHUB_REMOTE)).toBeNull();
  });
});

describe("project config", () => {
  test("a missing file means the defaults", async () => {
    const home = tempDir("nf-home-");
    expect(await Effect.runPromise(loadProjectConfig(home, "NF"))).toEqual(DEFAULT_CONFIG);
  });

  test("stages keep file order and resolve their labels", async () => {
    const config = await parseConfig(
      [
        "t3DeepLinks: true",
        "defaultBranch: trunk",
        "stages:",
        "  dev:",
        "    branch: develop",
        "    tone: info",
        "  prod:",
        "    branch: main",
        "    label: Producción",
        "  release:",
        "    tag: 'v*'",
        "",
      ].join("\n"),
    );
    expect(config).toEqual({
      t3DeepLinks: true,
      defaultBranch: "trunk",
      stages: [
        { id: "dev", label: "dev", tone: "info", branch: "develop", tag: null },
        { id: "prod", label: "Producción", tone: null, branch: "main", tag: null },
        { id: "release", label: "release", tone: null, branch: null, tag: "v*" },
      ],
      themes: ["light", "dark"],
      uiReview: null,
    });
  });

  test("ui.themes declares the evidence themes and defaults to light and dark", async () => {
    expect((await parseConfig("ui: { themes: [light] }\n")).themes).toEqual(["light"]);
    expect((await parseConfig("")).themes).toEqual(["light", "dark"]);
  });

  test("ui.themes cannot be empty or repeat a theme", async () => {
    expect(await parseConfigError("ui: { themes: [] }\n")).toMatch(
      /ui\.themes: list at least one theme/,
    );
    expect(await parseConfigError("ui: { themes: [light, light] }\n")).toMatch(
      /ui\.themes: duplicate theme/,
    );
  });

  test("an unknown theme is rejected by the schema", async () => {
    expect(await parseConfigError("ui: { themes: [sepia] }\n")).toMatch(/ui\.themes/);
  });

  test("an unknown key is reported with its path", async () => {
    expect(await parseConfigError("t3Deeplinks: true\n")).toMatch(/t3Deeplinks: unknown key/);
  });

  test("a stage needs exactly one selector", async () => {
    expect(await parseConfigError("stages:\n  dev: {}\n")).toMatch(
      /stages\.dev: set exactly one of branch and tag/,
    );
    expect(await parseConfigError("stages:\n  dev: { branch: a, tag: b }\n")).toMatch(
      /stages\.dev: set exactly one of branch and tag/,
    );
  });

  test("built-in stage ids are reserved and selectors are unique", async () => {
    expect(await parseConfigError("stages:\n  pr: { branch: develop }\n")).toMatch(
      /stages\.pr: 'pr' is a built-in stage/,
    );
    expect(
      await parseConfigError("stages:\n  dev: { branch: develop }\n  qa: { branch: develop }\n"),
    ).toMatch(/stages\.qa: branch develop is already used by stages\.dev/);
  });

  test("invalid YAML and empty values are rejected, never silently defaulted", async () => {
    expect(await parseConfigError("stages: [\n")).toMatch(/yaml:/);
    expect(await parseConfigError("defaultBranch: ''\n")).toMatch(
      /defaultBranch: must not be empty/,
    );
    expect(await parseConfigError("stages:\n  Dev: { branch: develop }\n")).toMatch(
      /stages\.Dev: stage ids are lowercase/,
    );
  });
});

describe("board views", () => {
  test("records a pull request on an attempt and shows it as a task link", async () => {
    const f = await fixture();
    const { attempt } = await attemptWith(f, { pr_url: PR_URL, branch: "feature/x" });
    expect((await f.store.getAttempt(f.projectId, attempt.key)).pr_url).toBe(PR_URL);
    const [view] = await locatedViews(f);
    expect(view?.location).toEqual({ stage: "pr", href: PR_URL });
    expect(view?.links?.filter((link) => link.kind === "pull-request")).toEqual([
      { kind: "pull-request", href: PR_URL, label: "#7" },
    ]);
  });

  test("t3DeepLinks builds the t3code URL from the attempt environment", async () => {
    const f = await fixture();
    const { attempt } = await attemptWith(f, {
      thread_id: "thread/one",
      thread_link: "t3-thread://recorded",
      environment_id: "env-a",
    });
    const ensureConfig = async (t3DeepLinks: boolean) => {
      mkdirSync(join(f.home, "projects"), { recursive: true });
      writeFileSync(join(f.home, "projects", "T.yaml"), `t3DeepLinks: ${t3DeepLinks}\n`, "utf8");
      const [view] = await locatedViews(f);
      return view?.attempts.find((item) => item.id === attempt.key)?.thread;
    };
    expect(await ensureConfig(false)).toEqual({
      id: "thread/one",
      href: "t3-thread://recorded",
    });
    expect(await ensureConfig(true)).toEqual({
      id: "thread/one",
      href: "t3code://threads/env-a/thread%2Fone",
    });
  });

  test("t3DeepLinks is on when the project config does not say", async () => {
    const f = await fixture();
    const { attempt } = await attemptWith(f, {
      thread_id: "thread-1",
      thread_link: "t3-thread://recorded",
      environment_id: "env-a",
    });
    const [view] = await locatedViews(f);
    expect(view?.attempts.find((item) => item.id === attempt.key)?.thread?.href).toBe(
      "t3code://threads/env-a/thread-1",
    );
  });

  test("without a known environment the recorded thread link stays", async () => {
    const f = await fixture();
    const { attempt } = await attemptWith(f, {
      thread_id: "thread-1",
      thread_link: "t3-thread://recorded",
    });
    mkdirSync(join(f.home, "projects"), { recursive: true });
    writeFileSync(join(f.home, "projects", "T.yaml"), "t3DeepLinks: true\n", "utf8");
    const [view] = await locatedViews(f);
    expect(view?.attempts.find((item) => item.id === attempt.key)?.thread?.href).toBe(
      "t3-thread://recorded",
    );
  });

  test("the attempt's environment wins, with the project's coordinator as the fallback", async () => {
    const home = tempDir("nf-home-");
    const root = tempDir("nf-proj-");
    const opened = await openStore(home);
    try {
      const { project } = await opened.store.registerProject({
        name: "demo",
        prefix: "T",
        rootPath: root,
        remoteUrl: null,
        coordinatorEnvironmentId: "coord-env",
      });
      const task = await opened.store.addTask(project.id, {
        title: "Coordinated",
        goal: "g",
        acceptance: ["a"],
      });
      const attempt = await opened.store.startAttempt(project.id, task.key, {
        kind: "implementation",
        mechanism: "direct",
        environmentId: "attempt-env",
      });
      await opened.store.updateAttempt(project.id, attempt.key, { thread_id: "thread-1" });
      const inherited = await opened.store.addTask(project.id, {
        title: "Inherited",
        goal: "g",
        acceptance: ["a"],
      });
      const fromProject = await opened.store.startAttempt(project.id, inherited.key, {
        kind: "implementation",
        mechanism: "direct",
      });
      await opened.store.updateAttempt(project.id, fromProject.key, { thread_id: "thread-2" });
      mkdirSync(join(home, "projects"), { recursive: true });
      writeFileSync(join(home, "projects", "T.yaml"), "t3DeepLinks: true\n", "utf8");
      const views = await opened.run(
        boardViews(project.id, AT, { home, readPullRequest: NO_PULL_REQUESTS }),
      );
      expect(views[0]?.attempts[0]?.thread?.href).toBe("t3code://threads/attempt-env/thread-1");
      expect(views[1]?.attempts[0]?.thread?.href).toBe("t3code://threads/coord-env/thread-2");
    } finally {
      await opened.close();
    }
  });
});
