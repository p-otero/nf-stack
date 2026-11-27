import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  statSync,
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// `nf serve` runs the real nf under *node*, like the rest of the CLI tests.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const FIXTURES = join(import.meta.dir, "..", "..", "core", "test", "fixtures");
const ABSENT_T3 = join(FIXTURES, "statev2-absent.sqlite");

setDefaultTimeout(120_000);

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop() as ChildProcess;
    child.kill();
    await new Promise<void>((resume) => {
      if (child.exitCode !== null) return resume();
      child.once("exit", () => resume());
      setTimeout(() => resume(), 5_000);
    });
  }
  while (dirs.length > 0)
    rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5 });
});

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function repo(name: string): string {
  const dir = tmp(`nf-serve-${name}-`);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["remote", "add", "origin", `https://github.com/example/${name}.git`]);
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
}

function nf(home: string, cwd: string, args: string[]): Run {
  const result = spawnSync(NODE, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home, NF_T3_STATE: ABSENT_T3 },
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

/** A project registered under `prefix` with one todo task, returning its checkout. */
function project(home: string, name: string, prefix: string, title: string): string {
  const cwd = repo(name);
  const init = nf(home, cwd, ["init", "--prefix", prefix]);
  if (init.code !== 0) throw new Error(`nf init failed: ${init.err}`);
  const added = nf(home, cwd, [
    "task",
    "add",
    "--title",
    title,
    "--goal",
    "g",
    "--acceptance",
    "a",
  ]);
  if (added.code !== 0) throw new Error(`nf task add failed: ${added.err}`);
  return cwd;
}

interface Starting {
  readonly child: ChildProcess;
  /** Resolves with the origin the server printed, which is also its readiness. */
  origin(): Promise<string>;
  run(): Promise<Run>;
}

function startServe(home: string, args: string[], env: Record<string, string> = {}): Starting {
  const child = spawn(NODE, [BIN, "serve", ...args], {
    cwd: home,
    env: { ...process.env, NF_HOME: home, NF_T3_STATE: ABSENT_T3, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let out = "";
  let err = "";
  let found: string | null = null;
  const waiting: ((origin: string) => void)[] = [];
  const read = () => {
    const match = /http:\/\/localhost:(\d+)\//.exec(out);
    if (match?.[1] === undefined || found !== null) return;
    found = `http://127.0.0.1:${match[1]}`;
    for (const resume of waiting) resume(found);
  };
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
    read();
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const run = new Promise<Run>((resume) => {
    child.once("exit", (code) => resume({ code: code ?? -1, out, err }));
  });
  return {
    child,
    origin: () =>
      new Promise<string>((resume, reject) => {
        if (found !== null) return resume(found);
        waiting.push(resume);
        setTimeout(() => reject(new Error(`nf serve printed no URL: ${out}${err}`)), 60_000);
      }),
    run: () => run,
  };
}

interface Served {
  readonly child: ChildProcess;
  readonly origin: string;
  readonly port: number;
  run(): Promise<Run>;
}

async function serve(
  home: string,
  args: string[] = ["--port", "0"],
  env: Record<string, string> = {},
) {
  const starting = startServe(home, args, env);
  const origin = await starting.origin();
  return {
    child: starting.child,
    origin,
    port: Number(new URL(origin).port),
    run: () => starting.run(),
  } satisfies Served;
}

interface Attachment {
  id: string;
  src: string;
  srcDark?: string;
  href: string;
}

interface Payload {
  tasks: {
    id: string;
    project: string;
    status: string;
    awaitingApproval?: boolean;
    decisionNeeded?: string;
    attachments?: Attachment[];
  }[];
  project: string | null;
  projects: { prefix: string; name: string }[];
  stages: { id: string }[];
  telemetry: { strategy: { rows: unknown[] } };
  generatedAt: string;
  timeZone: string;
}

function board(origin: string, ref?: string): Promise<Response> {
  return fetch(`${origin}/api/board${ref === undefined ? "" : `?project=${ref}`}`);
}

async function payloadOf(origin: string, ref?: string): Promise<Payload> {
  const response = await board(origin, ref);
  expect(response.status).toBe(200);
  return (await response.json()) as Payload;
}

/** A 1x1 PNG; the board only needs an image extension and bytes. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

describe("nf serve", () => {
  test("serves the page and answers the board API with the snapshot's views", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "alpha", "AL", "Alpha task");
    const served = await serve(home);

    const page = await fetch(`${served.origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('id="board-source"');
    const source = JSON.parse(
      /<script type="application\/json" id="board-source">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
        "null",
    ) as { kind: string; api: string; actions: string; token: string };
    expect(source.kind).toBe("live");
    expect(source.api).toBe("/api/board");
    expect(source.actions).toBe("/api/tasks");
    expect(source.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(html).not.toContain('id="board-data"');

    const jsonOnly = nf(home, cwd, ["board", "--json-only"]);
    expect(jsonOnly.code).toBe(0);
    const snapshot = JSON.parse(readFileSync(jsonOnly.out.trim(), "utf8")) as Payload["tasks"];

    const payload = await payloadOf(served.origin, "AL");
    expect(payload.tasks).toEqual(snapshot);
    expect(payload.project).toBe("AL");
    expect(payload.projects.map((entry) => entry.prefix)).toEqual(["AL"]);
    expect(payload.stages.map((stage) => stage.id)).toEqual(["branch", "pr", "merged"]);
    expect(payload.telemetry.strategy.rows).toHaveLength(1);
    expect(new Date(payload.generatedAt).toISOString()).toBe(payload.generatedAt);
    expect(payload.timeZone.length).toBeGreaterThan(0);
  });

  test("answers 304 while the data is unchanged, and a new ETag once it changes", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "etag", "ET", "ETag task");
    const served = await serve(home);

    const first = await board(served.origin, "ET");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    await first.text();

    const again = await board(served.origin, "ET");
    expect(again.status).toBe(200);
    expect(again.headers.get("etag")).toBe(etag);
    await again.text();

    const revalidated = await fetch(`${served.origin}/api/board?project=ET`, {
      headers: { "If-None-Match": etag },
    });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");

    const changed = nf(home, cwd, [
      "task",
      "add",
      "--title",
      "Another task",
      "--goal",
      "g",
      "--acceptance",
      "a",
    ]);
    expect(changed.code).toBe(0);
    const after = await board(served.origin, "ET");
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    await after.text();
  });

  test("serves every project, and filters by the prefix it is asked for", async () => {
    const home = tmp("nf-serve-home-");
    project(home, "one", "ON", "One");
    project(home, "two", "TW", "Two");
    const served = await serve(home);

    const all = await payloadOf(served.origin);
    expect(all.project).toBeNull();
    expect(all.tasks.map((task) => task.id).toSorted()).toEqual(["ON-001", "TW-001"]);
    expect(all.projects.map((entry) => entry.prefix).toSorted()).toEqual(["ON", "TW"]);

    const one = await payloadOf(served.origin, "ON");
    expect(one.tasks.map((task) => task.id)).toEqual(["ON-001"]);
    expect(one.projects.map((entry) => entry.prefix).toSorted()).toEqual(["ON", "TW"]);

    const unknown = await board(served.origin, "ZZ");
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toContain("known: ON, TW");
  });

  test("serves attachment bytes over HTTP and refuses anything else", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "shots", "SH", "A screen");
    expect(nf(home, cwd, ["task", "set", "SH-001", "--ui"]).code).toBe(0);
    const started = nf(home, cwd, [
      "attempt",
      "start",
      "SH-001",
      "--kind",
      "implementation",
      "--mechanism",
      "direct",
    ]);
    expect(started.out.trim().split(/\s+/)[0]).toBe("SH-001-A1");
    writeFileSync(join(cwd, "light.png"), PNG);
    writeFileSync(join(cwd, "dark.png"), Buffer.concat([PNG, Buffer.from("dark")]));
    for (const theme of ["light", "dark"]) {
      const attached = nf(home, cwd, [
        "attempt",
        "attach",
        "SH-001-A1",
        "--file",
        `${theme}.png`,
        "--kind",
        "screenshot",
        "--theme",
        theme,
        "--name",
        "board",
      ]);
      expect(attached.code).toBe(0);
    }
    const served = await serve(home);

    const payload = await payloadOf(served.origin, "SH");
    const attachment = payload.tasks[0]?.attachments?.[0];
    expect(attachment?.src).toMatch(/^\/artifacts\/[A-Za-z0-9]+$/);
    expect(attachment?.srcDark).toMatch(/^\/artifacts\/[A-Za-z0-9]+$/);
    expect(attachment?.srcDark).not.toBe(attachment?.src);
    expect(attachment?.href).toBe(attachment?.src);

    const image = await fetch(`${served.origin}${attachment?.src}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).equals(PNG)).toBe(true);

    const revalidated = await fetch(`${served.origin}${attachment?.src}`, {
      headers: { "If-None-Match": image.headers.get("etag") ?? "" },
    });
    expect(revalidated.status).toBe(304);

    for (const path of [
      "/artifacts/../../nf.db",
      "/artifacts/..%2F..%2Fnf.db",
      "/artifacts/00000000000000000000000000",
      "/artifacts/",
    ]) {
      const refused = await fetch(`${served.origin}${path}`);
      expect(refused.status).toBe(404);
      expect(await refused.text()).not.toContain("SQLite format");
    }
  });

  test("reuses a running nf serve on the same NF_HOME and refuses another store", async () => {
    const home = tmp("nf-serve-home-");
    project(home, "shared", "SS", "Shared");
    const first = await serve(home);

    const second = startServe(home, ["--port", String(first.port)]);
    const secondRun = await second.run();
    expect(secondRun.code).toBe(0);
    expect(secondRun.err).toBe("");
    expect(secondRun.out).toContain("already running at");
    expect((await board(first.origin, "SS")).status).toBe(200);

    const other = tmp("nf-serve-other-");
    project(other, "other", "OT", "Other");
    const foreign = startServe(other, ["--port", String(first.port)]);
    const foreignRun = await foreign.run();
    expect(foreignRun.code).toBe(1);
    expect(foreignRun.out).toBe("");
    expect(foreignRun.err).toContain("NF_HOME");
    expect(foreignRun.err).toContain(`already running on port ${first.port}`);
  });

  test("fails clearly when another process holds the port", async () => {
    const home = tmp("nf-serve-home-");
    project(home, "held", "HD", "Held");
    const holder = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("not nf");
    });
    await new Promise<void>((resume) => holder.listen(0, "127.0.0.1", () => resume()));
    const port = (holder.address() as { port: number }).port;
    try {
      const refused = startServe(home, ["--port", String(port)]);
      const result = await refused.run();
      expect(result.code).toBe(1);
      expect(result.err).toContain(`port ${port} is already in use by another process`);
    } finally {
      await closeServer(holder);
    }
  });

  test("reads the store without writing to it", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "quiet", "QU", "Quiet");
    expect(
      nf(home, cwd, ["task", "add", "--title", "Second", "--goal", "g", "--acceptance", "a"]).code,
    ).toBe(0);
    const served = await serve(home);
    const before = storeState(home);

    for (const ref of [undefined, "QU"]) {
      const response = await board(served.origin, ref);
      expect(response.status).toBe(200);
      await response.text();
    }
    expect((await fetch(`${served.origin}/api/health`)).status).toBe(200);
    served.child.kill();
    await served.run();

    expect(storeState(home)).toEqual(before);
  });

  test("accepts a review only from its own page and records the user's decision", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "approve", "AP", "A screen");
    uiReview(home, cwd, "AP-001", { themes: ["light", "dark"], passing: true });
    const served = await serve(home);
    const source = await pageSource(served.origin);
    const path = "/api/tasks/AP-001/accept";

    const noToken = await post(served.origin, path, { "Content-Type": "application/json" }, "{}");
    expect(noToken.status).toBe(403);
    const wrongToken = await post(
      served.origin,
      path,
      { "Content-Type": "application/json", "X-NF-Board-Token": "not-this-servers-token" },
      "{}",
    );
    expect(wrongToken.status).toBe(403);
    const foreignOrigin = await post(
      served.origin,
      path,
      {
        "Content-Type": "application/json",
        "X-NF-Board-Token": source.token,
        Origin: "http://evil.example",
      },
      "{}",
    );
    expect(foreignOrigin.status).toBe(403);
    const noOrigin = await post(
      served.origin,
      path,
      { "Content-Type": "application/json", "X-NF-Board-Token": source.token },
      "{}",
    );
    expect(noOrigin.status).toBe(403);
    const notJson = await post(
      served.origin,
      path,
      {
        "Content-Type": "text/plain",
        "X-NF-Board-Token": source.token,
        Origin: served.origin,
      },
      "{}",
    );
    expect(notJson.status).toBe(415);
    expect(notJson.headers["access-control-allow-origin"]).toBeUndefined();

    const accepted = await post(
      served.origin,
      path,
      {
        "Content-Type": "application/json",
        "X-NF-Board-Token": source.token,
        Origin: served.origin,
      },
      '{"comment":"Looks right"}',
    );
    expect(accepted.status).toBe(200);
    expect(JSON.parse(accepted.body)).toEqual({ key: "AP-001", action: "accept", status: "done" });

    const payload = await payloadOf(served.origin, "AP");
    expect(payload.tasks[0]?.status).toBe("done");
    expect(payload.tasks[0]?.awaitingApproval).toBeUndefined();
    const recorded = storedTask(home, "AP-001");
    expect(recorded.events.map((event) => [event.kind, event.actor_role])).toContainEqual([
      "accept",
      "user",
    ]);
    expect(recorded.events.at(-1)).toMatchObject({
      kind: "accept",
      actor_role: "user",
      from_status: "review",
      to_status: "done",
    });

    const getAction = await fetch(`${served.origin}${path}`);
    expect(getAction.status).toBe(405);
    await getAction.text();
  });

  test("rejects a review with a required comment and keeps it as the repair note", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "reject", "RJ", "A screen");
    uiReview(home, cwd, "RJ-001", { themes: ["light", "dark"], passing: true });
    expect(
      nf(home, cwd, [
        "task",
        "add",
        "--title",
        "Not in review",
        "--status",
        "proposed",
        "--goal",
        "g",
        "--acceptance",
        "a",
      ]).code,
    ).toBe(0);
    const served = await serve(home);
    const source = await pageSource(served.origin);
    const headers = {
      "Content-Type": "application/json",
      "X-NF-Board-Token": source.token,
      Origin: served.origin,
    };

    const withoutComment = await post(served.origin, "/api/tasks/RJ-001/reject", headers, "{}");
    expect(withoutComment.status).toBe(400);
    expect(JSON.parse(withoutComment.body)).toEqual({
      error: "rejection comment must not be empty",
    });
    const blankComment = await post(
      served.origin,
      "/api/tasks/RJ-001/reject",
      headers,
      '{"comment":"   "}',
    );
    expect(blankComment.status).toBe(400);

    const notReview = await post(
      served.origin,
      "/api/tasks/RJ-002/reject",
      headers,
      '{"comment":"x"}',
    );
    expect(notReview.status).toBe(409);
    expect(JSON.parse(notReview.body)).toMatchObject({
      error: expect.stringContaining("proposed -> working is not allowed"),
    });

    const comment = "The dialog overlaps the footer";
    const rejected = await post(
      served.origin,
      "/api/tasks/RJ-001/reject",
      headers,
      JSON.stringify({ comment }),
    );
    expect(rejected.status).toBe(200);
    expect(JSON.parse(rejected.body)).toEqual({
      key: "RJ-001",
      action: "reject",
      status: "working",
    });

    const payload = await payloadOf(served.origin, "RJ");
    const view = payload.tasks.find((task) => task.id === "RJ-001");
    expect(view?.status).toBe("working");
    expect(view?.decisionNeeded).toBe(comment);
    expect(view?.awaitingApproval).toBeUndefined();
    const recorded = storedTask(home, "RJ-001");
    expect({ ...recorded.task }).toEqual({ status: "working", decision_needed: comment });
    expect({ ...recorded.events.at(-1) }).toEqual({
      kind: "review_rejected",
      actor_role: "user",
      from_status: "review",
      to_status: "working",
      note: comment,
    });
  });

  test("returns the acceptance gate's refusal verbatim with 409", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "gate", "GA", "A screen");
    uiReview(home, cwd, "GA-001", { themes: ["light"], passing: true });
    expect(
      nf(home, cwd, ["task", "add", "--title", "No verdict", "--goal", "g", "--acceptance", "a"])
        .code,
    ).toBe(0);
    uiReview(home, cwd, "GA-002", { themes: ["light", "dark"], passing: false });
    const served = await serve(home);
    const source = await pageSource(served.origin);
    const accept = (key: string) =>
      post(
        served.origin,
        `/api/tasks/${key}/accept`,
        {
          "Content-Type": "application/json",
          "X-NF-Board-Token": source.token,
          Origin: served.origin,
        },
        "{}",
      );

    const missingEvidence = await accept("GA-001");
    expect(missingEvidence.status).toBe(409);
    expect(JSON.parse(missingEvidence.body)).toMatchObject({
      error: expect.stringContaining("dark screenshot"),
    });
    const incomplete = await accept("GA-002");
    expect(incomplete.status).toBe(409);
    expect(JSON.parse(incomplete.body)).toMatchObject({
      error: expect.stringContaining("acceptance not passing: #1 unverified"),
    });

    const payload = await payloadOf(served.origin, "GA");
    expect(payload.tasks.map((task) => task.status)).toEqual(["review", "review"]);
    for (const key of ["GA-001", "GA-002"]) {
      expect(storedTask(home, key).events.some((event) => event.kind === "accept")).toBe(false);
    }
  });
  test("answers the read-only git API and rejects a repository outside the workspace", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "git api", "GA", "Git task");
    writeFileSync(join(cwd, "README.md"), "# git api\n");
    git(cwd, ["add", "README.md"]);
    git(cwd, ["commit", "-q", "-m", "First"]);
    const served = await serve(home);
    const get = async (path: string) => {
      const response = await fetch(`${served.origin}${path}`);
      return { status: response.status, body: await response.json() };
    };

    const repos = await get("/api/git/repos?project=ga");
    expect(repos.status).toBe(200);
    expect(repos.body).toEqual([
      expect.objectContaining({ id: ".", branch: "main", dirty: false, commits: 1, ahead: null }),
    ]);
    const log = await get("/api/git/log?project=GA&repo=.");
    expect(log.status).toBe(200);
    expect(log.body).toMatchObject({ total: 1, next: null, commits: [{ subject: "First" }] });
    const shown = await get("/api/git/commit?project=GA&repo=.&sha=HEAD");
    expect(shown.body).toMatchObject({ parent: null, tree: ["README.md"], truncated: false });
    expect((await get("/api/git/branches?project=GA&repo=.")).status).toBe(200);
    expect((await get("/api/git/worktree?project=GA&repo=.")).body).toMatchObject({
      untracked: { files: [], patch: "", truncated: false },
      staged: { files: [], patch: "" },
    });
    expect((await get("/api/git/worktrees?project=GA&repo=.")).body).toEqual([
      expect.objectContaining({ branch: "main", main: true, locked: false, prunable: false }),
    ]);
    expect(
      (await get("/api/git/compare?project=GA&repo=.&base=HEAD&head=main")).body,
    ).toMatchObject({ ahead: 0, behind: 0, commits: [] });
    expect(await get("/api/tasks/GA-001/branch")).toEqual({ status: 200, body: null });

    expect(await get("/api/git/log?project=GA&repo=..")).toMatchObject({
      status: 403,
      body: { code: "repo_outside_workspace" },
    });
    expect((await get("/api/git/log?project=GA")).status).toBe(400);
    expect((await get("/api/git/repos?project=NOPE")).status).toBe(404);
    expect((await get("/api/tasks/GA-999/branch")).status).toBe(404);
    expect((await get("/api/git/unknown?project=GA")).status).toBe(404);
    expect((await get("/api/git/log?project=GA&repo=.&limit=1e2")).status).toBe(400);
    expect((await get("/api/git/worktree?project=GA&repo=.&worktree=..")).body).toMatchObject({
      code: "invalid_value",
    });
  });

  test("git API: option-like branch names write nothing and a .git pointer cannot leave the workspace", async () => {
    const home = tmp("nf-serve-home-");
    const cwd = project(home, "hostile", "HO", "Hostile task");
    const commitAll = (message: string) => {
      git(cwd, ["add", "-A"]);
      git(cwd, ["commit", "-q", "-m", message]);
    };
    writeFileSync(join(cwd, "victim...main"), "keep\n");
    commitAll("First");
    writeFileSync(join(cwd, "second.txt"), "2\n");
    commitAll("Second");
    for (const name of ["--output=victim", "-n"]) {
      git(cwd, ["update-ref", `refs/heads/${name}`, "HEAD~1"]);
    }
    const outsider = tmp("nf-serve-outsider-");
    git(outsider, ["init", "-q", "-b", "main"]);
    writeFileSync(join(outsider, "secret.txt"), "s\n");
    git(outsider, ["add", "-A"]);
    git(outsider, ["commit", "-q", "-m", "Outside"]);
    mkdirSync(join(cwd, "leak"));
    writeFileSync(join(cwd, "leak", ".git"), `gitdir: ${join(outsider, ".git")}\n`);
    const files = () =>
      readdirSync(cwd, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const path = join(entry.parentPath, entry.name);
          return `${path} ${statSync(path).size} ${statSync(path).mtimeMs}`;
        })
        .toSorted();
    const before = files();
    const served = await serve(home);
    const get = async (path: string) => {
      const response = await fetch(`${served.origin}${path}`);
      return { status: response.status, body: await response.json() };
    };

    const branches = await get("/api/git/branches?project=HO&repo=.");
    expect(branches.status).toBe(200);
    for (const name of ["--output=victim", "-n"]) {
      expect(branches.body).toContainEqual(
        expect.objectContaining({ name, ahead: 0, behind: 1, base: "main" }),
      );
    }
    expect(
      (await get(`/api/git/log?project=HO&repo=.&branch=${encodeURIComponent("refs/heads/-n")}`))
        .body,
    ).toMatchObject({ total: 1, commits: [{ subject: "First" }] });
    expect((await get("/api/git/log?project=HO&repo=.&all=1")).body).toMatchObject({ total: 2 });
    expect(files()).toEqual(before);
    expect(readFileSync(join(cwd, "victim...main"), "utf8")).toBe("keep\n");

    expect(await get("/api/git/log?project=HO&repo=leak")).toMatchObject({
      status: 403,
      body: { code: "repo_outside_workspace" },
    });
    const repos = await get("/api/git/repos?project=HO");
    expect(repos.body).toEqual([expect.objectContaining({ id: "." })]);
  });
});

/** A UI task with an implementation attempt, the requested screenshots, and acceptance status. */
function uiReview(
  home: string,
  cwd: string,
  key: string,
  options: { themes: ("light" | "dark")[]; passing: boolean },
) {
  expect(nf(home, cwd, ["task", "set", key, "--ui"]).code).toBe(0);
  const started = nf(home, cwd, [
    "attempt",
    "start",
    key,
    "--kind",
    "implementation",
    "--mechanism",
    "direct",
  ]);
  expect(started.code).toBe(0);
  const attempt = started.out.trim().split(/\s+/)[0] ?? "";
  for (const theme of options.themes) {
    writeFileSync(join(cwd, `${theme}.png`), Buffer.concat([PNG, Buffer.from(theme)]));
    const attached = nf(home, cwd, [
      "attempt",
      "attach",
      attempt,
      "--file",
      `${theme}.png`,
      "--kind",
      "screenshot",
      "--theme",
      theme,
      "--name",
      "board",
    ]);
    expect(attached.code).toBe(0);
  }
  expect(nf(home, cwd, ["attempt", "finish", attempt, "--status", "succeeded"]).code).toBe(0);
  expect(nf(home, cwd, ["task", "set", key, "--status", "working"]).code).toBe(0);
  expect(nf(home, cwd, ["task", "set", key, "--status", "review"]).code).toBe(0);
  if (options.passing) {
    expect(nf(home, cwd, ["task", "check", key, "--item", "1", "--result", "pass"]).code).toBe(0);
  }
}

/** The live marker `nf serve` embedded: the token that lets this page write. */
async function pageSource(origin: string): Promise<{ token: string; actions: string }> {
  const html = await (await fetch(`${origin}/`)).text();
  const source = JSON.parse(
    /<script type="application\/json" id="board-source">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
      "null",
  ) as { token?: string; actions?: string };
  if (typeof source.token !== "string" || typeof source.actions !== "string") {
    throw new Error("the served page has no live source marker");
  }
  return { token: source.token, actions: source.actions };
}

interface Posted {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** A POST with headers a browser would not let a test set, such as a foreign Origin. */
function post(
  origin: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<Posted> {
  const url = new URL(path, origin);
  return new Promise((resume, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () =>
          resume({ status: res.statusCode ?? 0, body: text, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** One task's stored state and audit trail, read like any other observer would. */
function storedTask(
  home: string,
  key: string,
): {
  task: { status: string; decision_needed: string | null };
  events: {
    kind: string;
    actor_role: string;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
  }[];
} {
  const db = new DatabaseSync(join(home, "nf.db"), { readOnly: true });
  try {
    const task = db.prepare("SELECT status, decision_needed FROM tasks WHERE key = ?").get(key) as {
      status: string;
      decision_needed: string | null;
    };
    const events = db
      .prepare(
        `SELECT e.kind, e.actor_role, e.from_status, e.to_status, e.note FROM task_events e
         JOIN tasks t ON t.id = e.task_id WHERE t.key = ? ORDER BY e.id`,
      )
      .all(key) as {
      kind: string;
      actor_role: string;
      from_status: string | null;
      to_status: string | null;
      note: string | null;
    }[];
    return { task, events: [...events] };
  } finally {
    db.close();
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resume) => server.close(() => resume()));
}

/** Row counts and the store file's write time: a read-only server leaves both as they were. */
function storeState(home: string): Record<string, number> {
  const file = join(home, "nf.db");
  if (!existsSync(file)) throw new Error(`${file} is missing`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const state: Record<string, number> = { mtimeMs: statSync(file).mtimeMs };
    for (const table of [
      "projects",
      "tasks",
      "attempts",
      "task_events",
      "attempt_attachments",
      "usage_events",
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      state[table] = row.n;
    }
    return state;
  } finally {
    db.close();
  }
}
