import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GIT_PATCH_LIMITS,
  gitBranches,
  gitCommit,
  gitCompare,
  gitLog,
  gitRepos,
  gitWorktree,
  taskBranch,
  workspaceRootOf,
} from "../src/index.ts";
import type { GitApiContext, LogQuery } from "../src/index.ts";
import { cleanupAll, openStore, rejection, tempDir } from "./helpers.ts";
import type { OpenStore } from "./helpers.ts";

setDefaultTimeout(120_000);
afterEach(cleanupAll);

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function initRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "commit.gpgsign", "false"]);
  return path;
}

function commit(repo: string, files: Record<string, string>, message: string): string {
  for (const [name, text] of Object.entries(files)) write(join(repo, name), text);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function t3State(dir: string, workspaceRoot: string): string {
  const file = join(dir, "statev2.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE projection_projects (
    project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL,
    scripts_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
  const insert = db.prepare(
    "INSERT INTO projection_projects VALUES (?, ?, ?, '[]', '2026-01-01', '2026-01-01', ?)",
  );
  insert.run("p1", "work", workspaceRoot, null);
  insert.run("p2", "gone", join(workspaceRoot, "api repo"), "2026-01-02");
  db.close();
  return file;
}

interface Workspace {
  readonly root: string;
  readonly api: string;
  readonly cli: string;
  readonly outsider: string;
  readonly remote: string;
  readonly opened: OpenStore;
  readonly context: GitApiContext;
}

/**
 * `work space/` holds `api repo` (pushed to a bare remote) and `tools/cli` (no remote), plus a
 * repository under `node_modules` that the scan skips.
 */
async function workspace(): Promise<Workspace> {
  const base = realpathSync.native(tempDir("nf-git-"));
  const root = join(base, "work space");
  const remote = join(base, "remote.git");
  mkdirSync(remote);
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  const api = initRepo(join(root, "api repo"));
  commit(api, { "README.md": "# api\n", "src/app.ts": "export const a = 1;\n" }, "Initial commit");
  git(api, ["remote", "add", "origin", remote]);
  git(api, ["push", "-q", "-u", "origin", "main"]);
  const cli = initRepo(join(root, "tools", "cli"));
  commit(cli, { "main.go": "package main\n" }, "CLI");
  initRepo(join(root, "node_modules", "dep"));
  const outsider = initRepo(join(base, "outsider"));
  commit(outsider, { "x.txt": "x\n" }, "Outside");
  const home = tempDir("nf-home-");
  const opened = await openStore(home);
  await opened.store.registerProject({
    name: "api",
    prefix: "WS",
    rootPath: api,
    remoteUrl: remote,
  });
  const context: GitApiContext = { home, t3State: t3State(base, root) };
  return { root, api, cli, outsider, remote, opened, context };
}

describe("workspaceRootOf", () => {
  test("prefers the T3 project at the checkout, then the closest one containing it", () => {
    expect(workspaceRootOf("/w/a", ["/w", "/w/a"])).toBe(resolve("/w/a"));
    expect(workspaceRootOf("/w/a/b", ["/", "/w", "/x"])).toBe(resolve("/w"));
    expect(workspaceRootOf("/w/a", ["/x"])).toBe(resolve("/w/a"));
    expect(workspaceRootOf("/w/ab", ["/w/a"])).toBe(resolve("/w/ab"));
  });
});

describe("git API", () => {
  test("lists the workspace's repositories, nested ones included, with null counts without a remote", async () => {
    const ws = await workspace();
    write(join(ws.api, "src", "app.ts"), "export const a = 2;\n");
    const repos = await ws.opened.run(gitRepos(ws.context, "ws"));
    expect(repos.map((repo) => repo.id)).toEqual(["api repo", "tools/cli"]);
    const [api, cli] = repos;
    expect(api).toMatchObject({
      branch: "main",
      dirty: true,
      uncommitted: 1,
      ahead: 0,
      behind: 0,
      upstream: "origin/main",
      remote: ws.remote,
      commits: 1,
    });
    expect(api?.path).toBe(ws.api.split("\\").join("/"));
    expect(cli).toMatchObject({
      branch: "main",
      dirty: false,
      ahead: null,
      behind: null,
      upstream: null,
      remote: null,
      commits: 1,
    });
    expect(cli?.head).toMatch(/^[0-9a-f]{40}$/);
  });

  test("rejects a repository outside the workspace root", async () => {
    const ws = await workspace();
    for (const repo of ["..", ws.outsider, "../outsider"]) {
      const error = await rejection(ws.opened.run(gitLog(ws.context, "WS", repo, LOG)));
      expect(error).toMatchObject({ code: "repo_outside_workspace" });
    }
    const missing = await rejection(ws.opened.run(gitLog(ws.context, "WS", "nope", LOG)));
    expect(missing).toMatchObject({ code: "not_found" });
    const notTop = await rejection(ws.opened.run(gitLog(ws.context, "WS", "api repo/src", LOG)));
    expect(notTop).toMatchObject({ code: "not_found" });
    const option = await rejection(
      ws.opened.run(gitLog(ws.context, "WS", "api repo", { ...LOG, branch: "--output=x" })),
    );
    expect(option).toMatchObject({ code: "invalid_value" });
  });

  test("rejects a folder whose .git file points outside the workspace", async () => {
    const ws = await workspace();
    const leak = join(ws.root, "leak");
    write(join(leak, ".git"), "gitdir: ../../outsider/.git\n");
    expect(git(leak, ["log", "-1", "--format=%s"])).toBe("Outside");
    const error = await rejection(ws.opened.run(gitLog(ws.context, "WS", "leak", LOG)));
    expect(error).toMatchObject({ code: "repo_outside_workspace" });
    const worktree = await rejection(
      ws.opened.run(gitWorktree(ws.context, { project: "WS", repo: "leak", task: null })),
    );
    expect(worktree).toMatchObject({ code: "repo_outside_workspace" });
    const repos = await ws.opened.run(gitRepos(ws.context, "WS"));
    expect(repos.map((repo) => repo.id)).toEqual(["api repo", "tools/cli"]);
  });

  test("branch names that read like options never reach git as options", async () => {
    const ws = await workspace();
    git(ws.api, ["switch", "-q", "-c", "scratch"]);
    const tip = commit(ws.api, { "hostile.txt": "h\n" }, "Hostile");
    git(ws.api, ["switch", "-q", "main"]);
    git(ws.api, ["branch", "-q", "-D", "scratch"]);
    for (const name of ["--output=victim", "-n"])
      git(ws.api, ["update-ref", `refs/heads/${name}`, tip]);
    write(join(ws.api, "victim...main"), "keep\n");
    write(join(ws.api, "victim"), "keep\n");
    git(ws.api, ["add", "victim...main", "victim"]);
    git(ws.api, ["commit", "-q", "-m", "Decoys"]);
    const project = (await ws.opened.store.listProjects())[0];
    if (project === undefined) throw new Error("no project");
    const task = await ws.opened.store.addTask(project.id, {
      title: "H",
      goal: "g",
      acceptance: ["a"],
    });
    const attempt = await ws.opened.store.startAttempt(project.id, task.key, {
      kind: "implementation",
      mechanism: "direct",
    });
    await ws.opened.store.updateAttempt(project.id, attempt.key, { branch: "--output=victim" });
    const before = snapshot(dirname(ws.root));

    const branches = await ws.opened.run(gitBranches(ws.context, "WS", "api repo"));
    for (const name of ["--output=victim", "-n"]) {
      expect(branches.find((branch) => branch.name === name)).toMatchObject({
        head: tip,
        ahead: 1,
        behind: 1,
        base: "main",
        upstream: null,
      });
    }
    const viaRef = await ws.opened.run(
      gitLog(ws.context, "WS", "api repo", { ...LOG, branch: "refs/heads/--output=victim" }),
    );
    expect(viaRef.commits[0]?.sha).toBe(tip);
    const all = await ws.opened.run(gitLog(ws.context, "WS", "api repo", { ...LOG, all: true }));
    expect(all.commits.map((entry) => entry.sha)).toContain(tip);
    const compared = await ws.opened.run(
      gitCompare(ws.context, "WS", "api repo", "main", "refs/heads/-n"),
    );
    expect(compared).toMatchObject({ ahead: 1, behind: 1 });
    const branch = await ws.opened.run(taskBranch(ws.context, task.key));
    expect(branch).toMatchObject({
      name: "--output=victim",
      head: tip,
      ahead: 1,
      behind: 1,
      unpushed: 1,
    });
    expect(snapshot(dirname(ws.root))).toEqual(before);

    git(ws.api, ["symbolic-ref", "HEAD", "refs/heads/--output=victim"]);
    const checkedOut = snapshot(dirname(ws.root));
    const repos = await ws.opened.run(gitRepos(ws.context, "WS"));
    expect(repos[0]).toMatchObject({ branch: "--output=victim", head: tip, commits: 2 });
    await ws.opened.run(gitWorktree(ws.context, { project: "WS", repo: "api repo", task: null }));
    expect(snapshot(dirname(ws.root))).toEqual(checkedOut);
    expect(readFileSync(join(ws.api, "victim...main"), "utf8")).toBe("keep\n");
  });

  test("takes limit and cursor only as plain digits", async () => {
    const ws = await workspace();
    for (const query of [{ limit: "1e2" }, { limit: "0x2" }, { limit: "2.0" }, { cursor: "1e1" }]) {
      const error = await rejection(
        ws.opened.run(gitLog(ws.context, "WS", "api repo", { ...LOG, ...query })),
      );
      expect(error).toMatchObject({ code: "invalid_value" });
    }
  });

  test("marks a local-only branch and counts its unpushed commits", async () => {
    const ws = await workspace();
    git(ws.api, ["switch", "-q", "-c", "local-only"]);
    commit(ws.api, { "a.txt": "a\n" }, "Local one");
    commit(ws.api, { "b.txt": "b\n" }, "Local two");
    git(ws.api, ["switch", "-q", "main"]);
    const branches = await ws.opened.run(gitBranches(ws.context, "WS", "api repo"));
    const local = branches.find((branch) => branch.name === "local-only");
    const main = branches.find((branch) => branch.name === "main");
    expect(local).toMatchObject({
      upstream: null,
      unpushed: null,
      ahead: 2,
      behind: 0,
      base: "main",
    });
    expect(local?.current).toBe(false);
    expect(main).toMatchObject({ upstream: "origin/main", unpushed: 0, ahead: 0, current: true });
    const cliBranches = await ws.opened.run(gitBranches(ws.context, "WS", "tools/cli"));
    expect(cliBranches).toEqual([
      expect.objectContaining({
        name: "main",
        upstream: null,
        unpushed: null,
        ahead: 0,
        behind: 0,
      }),
    ]);
  });

  test("pages the history and reads every branch with all", async () => {
    const ws = await workspace();
    commit(ws.api, { "c.txt": "c\n" }, "Second");
    commit(ws.api, { "d.txt": "d\n" }, "Third");
    git(ws.api, ["switch", "-q", "-c", "side"]);
    commit(ws.api, { "e.txt": "e\n" }, "Side");
    git(ws.api, ["switch", "-q", "main"]);
    const first = await ws.opened.run(gitLog(ws.context, "WS", "api repo", { ...LOG, limit: "2" }));
    expect(first.commits.map((entry) => entry.subject)).toEqual(["Third", "Second"]);
    expect(first.total).toBe(3);
    expect(first.next).toBe("2");
    expect(first.commits[0]).toMatchObject({
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
      author: "Test",
    });
    const second = await ws.opened.run(
      gitLog(ws.context, "WS", "api repo", { ...LOG, limit: "2", cursor: first.next }),
    );
    expect(second.commits.map((entry) => entry.subject)).toEqual(["Initial commit"]);
    expect(second.next).toBeNull();
    const all = await ws.opened.run(gitLog(ws.context, "WS", "api repo", { ...LOG, all: true }));
    expect(all.commits.map((entry) => entry.subject)).toContain("Side");
    expect(all.total).toBe(4);
    const side = await ws.opened.run(
      gitLog(ws.context, "WS", "api repo", { ...LOG, branch: "side" }),
    );
    expect(side.commits[0]?.subject).toBe("Side");
  });

  test("shows a merge commit against its first parent, with renames and the tree", async () => {
    const ws = await workspace();
    git(ws.api, ["switch", "-q", "-c", "feature"]);
    git(ws.api, ["mv", "src/app.ts", "src/main app.ts"]);
    commit(ws.api, { "feature.txt": "feature\n" }, "Feature work");
    git(ws.api, ["switch", "-q", "main"]);
    commit(ws.api, { "README.md": "# api\n\nmain\n" }, "Main work");
    git(ws.api, ["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"]);
    const merge = git(ws.api, ["rev-parse", "HEAD"]);
    const firstParent = git(ws.api, ["rev-parse", "HEAD^1"]);
    const detail = await ws.opened.run(gitCommit(ws.context, "WS", "api repo", merge));
    expect(detail.commit.parents).toHaveLength(2);
    expect(detail.parent).toBe(firstParent);
    expect(detail.commit.filesChanged).toBeNull();
    expect(detail.files).toEqual([
      { path: "feature.txt", status: "added", from: null, additions: 1, deletions: 0 },
      {
        path: "src/main app.ts",
        status: "renamed",
        from: "src/app.ts",
        additions: 0,
        deletions: 0,
      },
    ]);
    expect(detail.patch).toContain("diff --git a/feature.txt b/feature.txt");
    expect(detail.patch).not.toContain("README.md");
    expect(detail.truncated).toBe(false);
    expect(detail.tree).toEqual(["README.md", "feature.txt", "src/main app.ts"]);

    const root = git(ws.api, ["rev-list", "--max-parents=0", "HEAD"]);
    const initial = await ws.opened.run(gitCommit(ws.context, "WS", "api repo", root));
    expect(initial.parent).toBeNull();
    expect(initial.files.map((file) => file.status)).toEqual(["added", "added"]);

    const compared = await ws.opened.run(
      gitCompare(ws.context, "WS", "api repo", "main~1", "feature"),
    );
    expect(compared.ahead).toBe(1);
    expect(compared.behind).toBe(1);
    expect(compared.commits.map((entry) => entry.subject)).toEqual(["Feature work"]);
    expect(compared.files.map((file) => file.path)).toEqual(["feature.txt", "src/main app.ts"]);
    expect(compared.patch).not.toContain("README.md");
  });

  test("reads staged, unstaged and untracked changes without touching the index", async () => {
    const ws = await workspace();
    write(join(ws.api, "README.md"), "# api\n\nstaged\n");
    git(ws.api, ["add", "README.md"]);
    write(join(ws.api, "README.md"), "# api\n\nstaged\nand unstaged\n");
    write(join(ws.api, "src", "app.ts"), "export const a = 3;\n");
    write(join(ws.api, "new file.txt"), "new\n");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(ws.api, "src", "app.ts"), past, past);
    const index = join(ws.api, ".git", "index");
    const before = { bytes: readFileSync(index), mtime: statSync(index).mtimeMs };

    const changes = await ws.opened.run(
      gitWorktree(ws.context, { project: "WS", repo: "api repo", task: null }),
    );
    expect(changes.branch).toBe("main");
    expect(changes.staged.files).toEqual([
      { path: "README.md", status: "modified", from: null, additions: 2, deletions: 0 },
    ]);
    expect(changes.unstaged.files.map((file) => file.path)).toEqual(["README.md", "src/app.ts"]);
    expect(changes.unstaged.patch).toContain("+and unstaged");
    expect(changes.staged.patch).not.toContain("and unstaged");
    expect(changes.untracked).toEqual(["new file.txt"]);
    await ws.opened.run(gitRepos(ws.context, "WS"));

    expect(readFileSync(index).equals(before.bytes)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(before.mtime);
    expect(existsSync(join(ws.api, ".git", "index.lock"))).toBe(false);
  });

  test("caps a patch at the file limit and at the byte limit", async () => {
    const ws = await workspace();
    const many: Record<string, string> = {};
    for (let n = 0; n <= GIT_PATCH_LIMITS.files; n += 1) many[`many/file ${n}.txt`] = `${n}\n`;
    const wide = commit(ws.api, many, "Many files");
    const detail = await ws.opened.run(gitCommit(ws.context, "WS", "api repo", wide));
    expect(detail.files).toHaveLength(GIT_PATCH_LIMITS.files + 1);
    expect(detail.truncated).toBe(true);
    expect(detail.patch.match(/^diff --git /gm)).toHaveLength(GIT_PATCH_LIMITS.files);

    const line = `${"x".repeat(99)}\n`;
    const big = line.repeat(9_000);
    const heavy = commit(
      ws.api,
      { "big/one.txt": big, "big/two.txt": big, "big/three.txt": big },
      "Big",
    );
    const large = await ws.opened.run(gitCommit(ws.context, "WS", "api repo", heavy));
    expect(large.truncated).toBe(true);
    expect(large.files).toHaveLength(3);
    expect(Buffer.byteLength(large.patch)).toBeLessThanOrEqual(GIT_PATCH_LIMITS.bytes);
    expect(large.patch.match(/^diff --git /gm)?.length).toBe(2);

    const small = await ws.opened.run(gitCommit(ws.context, "WS", "tools/cli", "HEAD"));
    expect(small.truncated).toBe(false);
  });

  test("describes a task's branch from its attempt's worktree", async () => {
    const ws = await workspace();
    const project = (await ws.opened.store.listProjects())[0];
    if (project === undefined) throw new Error("no project");
    const task = await ws.opened.store.addTask(project.id, {
      title: "T",
      goal: "g",
      acceptance: ["a"],
    });
    const none = await ws.opened.run(taskBranch(ws.context, task.key));
    expect(none).toBeNull();

    const tree = join(dirname(ws.root), "task worktree");
    git(ws.api, ["worktree", "add", "-q", "-b", "feat/task", tree]);
    const pushed = commit(tree, { "one.txt": "1\n" }, "Pushed one");
    git(tree, ["push", "-q", "-u", "origin", "feat/task"]);
    const unpushed = commit(tree, { "two.txt": "2\n" }, "Unpushed two");
    write(join(tree, "dirty.txt"), "dirty\n");
    const attempt = await ws.opened.store.startAttempt(project.id, task.key, {
      kind: "implementation",
      mechanism: "direct",
    });
    await ws.opened.store.updateAttempt(project.id, attempt.key, {
      worktree: tree,
      branch: "feat/task",
    });

    const branch = await ws.opened.run(taskBranch(ws.context, task.key));
    expect(branch).toMatchObject({
      task: task.key,
      attempt: attempt.key,
      repo: "api repo",
      name: "feat/task",
      head: unpushed,
      base: "main",
      upstream: "origin/feat/task",
      ahead: 2,
      behind: 0,
      unpushed: 1,
      uncommitted: 1,
      pullRequest: null,
    });
    expect(branch?.worktree).toBe(tree.split("\\").join("/"));
    expect(branch?.commits.map((entry) => [entry.sha, entry.pushed])).toEqual([
      [unpushed, false],
      [pushed, true],
    ]);

    const changes = await ws.opened.run(
      gitWorktree(ws.context, { project: null, repo: null, task: task.key }),
    );
    expect(changes.repo).toBe("api repo");
    expect(changes.branch).toBe("feat/task");
    expect(changes.untracked).toEqual(["dirty.txt"]);

    git(tree, ["switch", "-q", "-c", "feat/local"]);
    const local = commit(tree, { "three.txt": "3\n" }, "Local three");
    await ws.opened.store.updateAttempt(project.id, attempt.key, { branch: "feat/local" });
    const localBranch = await ws.opened.run(taskBranch(ws.context, task.key));
    expect(localBranch).toMatchObject({ upstream: null, unpushed: 2, ahead: 3 });
    expect(localBranch?.commits.map((entry) => [entry.sha, entry.pushed])).toEqual([
      [local, false],
      [unpushed, false],
      [pushed, true],
    ]);
  });
});

const LOG: LogQuery = { branch: null, all: false, cursor: null, limit: null };

/** Every file under `dir`, `.git` folders included, with its size and modification time. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stat = statSync(path);
      return `${path} ${stat.size} ${stat.mtimeMs}`;
    })
    .toSorted();
}
