import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `nf board` is executed with *node*: the snapshot must not need Bun at snapshot time.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const ROOT = join(import.meta.dir, "..", "..", "..");
const PAGE = join(ROOT, "packages", "board", "dist", "index.html");
const FIXTURES = join(ROOT, "packages", "core", "test", "fixtures");

setDefaultTimeout(120_000);

const dirs: string[] = [];
afterEach(() => {
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
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd: string, name: string, text: string): string {
  writeFileSync(join(cwd, name), text);
  git(cwd, ["add", name]);
  git(cwd, ["commit", "-q", "-m", `add ${name}`]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function repo(remote = "https://github.com/example/board.git"): string {
  const dir = tmp("nf-board-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["remote", "add", "origin", remote]);
  return dir;
}

function nf(home: string, cwd: string, args: string[]) {
  const r = spawnSync(NODE, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home },
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

/** A command whose stderr carries a hint, not a failure; stdout is still the answer. */
function nfHint(home: string, cwd: string, args: string[]): string {
  const r = spawnSync(NODE, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home },
  });
  expect(r.status).toBe(0);
  return r.stdout.trim();
}

interface Telemetry {
  range: { from: string; to: string };
  groupBy: string;
  rows: {
    entity: { id: string; kind: string; color: number };
    tasks: number;
    n: number;
    firstPass: { accepted: number; total: number };
    costToAcceptance: { value: number | null; quality: string };
    tokens: { value: number | null };
    share: { cost: number | null; tokens: number | null };
  }[];
  totals: { tasks: number; firstPass: { accepted: number; total: number } };
  unpriced: { events: number; tokens: number | null };
  price_sources: string[];
}

interface Data {
  stages: { id: string; label: string; tone?: string }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    awaitingApproval?: boolean;
    labels?: string[];
    location?: { stage: string; href?: string };
    links?: {
      kind: string;
      href: string;
      label: string;
      state?: string;
    }[];
    attachments?: {
      id: string;
      name: string;
      kind: string;
      src: string;
      srcDark?: string;
      thumbnail?: string;
      alt: string;
      href?: string;
    }[];
    attempts: {
      id: string;
      liveness?: string;
      configured: { model: string };
      thread?: { id: string; href?: string };
    }[];
  }[];
  telemetry: { strategy: Telemetry; model: Telemetry };
  generatedAt: string;
  timeZone: string;
}

/** A 1x1 PNG; the board only needs an image extension and bytes. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function embedded(html: string): Data {
  const match = html.match(/<script type="application\/json" id="board-data">([\s\S]*?)<\/script>/);
  if (match === null) throw new Error("no embedded board data");
  return JSON.parse(match[1] as string) as Data;
}

/** The same rules `nf board` applies: nothing may be fetched from outside the file. */
function externalReferences(html: string): string[] {
  const markup = html.replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const checks: [string, RegExp][] = [
    [markup, /<script[^>]+src=/i],
    [markup, /<link[^>]+rel="?(stylesheet|preload|modulepreload)/i],
    // Fonts and images must be inlined bytes, never a file:// or network request.
    [styles, /url\((?!\s*["']?data:)/i],
  ];
  return checks
    .filter(([text, pattern]) => pattern.test(text))
    .map(([, pattern]) => String(pattern));
}

/** A frame sized to its content rejects any viewport unit anywhere in the page. */
function viewportUnits(html: string): string[] {
  return [...html.matchAll(/\b\d+(\.\d+)?[dls]?v[wh]\b/g)].map((match) => match[0]);
}

beforeAll(() => {
  if (existsSync(PAGE)) return;
  const build = spawnSync("bun", ["run", "board:build"], { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`board:build failed:\n${build.stdout}${build.stderr}`);
});

describe("nf board", () => {
  test("writes one self-contained snapshot with the project's views", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, [
      "task",
      "add",
      "--title",
      "Snapshot </script> board",
      "--goal",
      "one html file",
      "--acceptance",
      "it renders",
      "--json",
    ]);
    nf(home, cwd, [
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "delegate_task",
      "--provider",
      "pi",
      "--model",
      "deepseek-x",
      "--options",
      '{"thinking":"max"}',
      "--json",
    ]);
    nf(home, cwd, [
      "attempt",
      "update",
      "T-001-A1",
      "--thread-id",
      "thread-1",
      "--thread-link",
      "t3-thread://v2/env/thread-1",
      "--executed-model",
      "deepseek-y",
      "--json",
    ]);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded", "--json"]);

    const out = join(tmp("nf-board-out-"), "snapshot.html");
    const printed = JSON.parse(nf(home, cwd, ["board", "--out", out, "--json"])) as {
      path: string;
      tasks: number;
      bytes: number;
    };
    expect(printed.path).toBe(out);
    expect(printed.tasks).toBe(1);
    const html = readFileSync(out, "utf8");
    expect(printed.bytes).toBe(Buffer.byteLength(html));
    expect(html).toContain("<style>");
    expect(html).toMatch(/<script type="module">/);
    expect(externalReferences(html)).toEqual([]);
    expect(viewportUnits(html)).toEqual([]);
    // Task text must not be able to close the data script early.
    expect(html).not.toContain("Snapshot </script> board");

    const data = embedded(html);
    expect(data.timeZone.length).toBeGreaterThan(0);
    expect(new Date(data.generatedAt).toISOString()).toBe(data.generatedAt);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "T-001",
      title: "Snapshot </script> board",
      status: "review",
      acceptance: [{ text: "it renders", result: "unverified" }],
      counts: { attempts: 1, repairs: 0, reviews: 0, humanInterventions: 0 },
    });
    expect(data.tasks[0]?.attempts[0]).toMatchObject({
      id: "T-001-A1",
      status: "succeeded",
      liveness: "finished",
      configured: {
        provider: "pi",
        model: "deepseek-x",
        effort: { name: "thinking", value: "max" },
      },
      executed: { provider: "pi", model: "deepseek-y" },
      thread: { id: "thread-1", href: "t3-thread://v2/env/thread-1" },
    });

    // The snapshot carries the telemetry tab's data for both groupings.
    expect([data.telemetry.strategy.groupBy, data.telemetry.model.groupBy]).toEqual([
      "strategy",
      "model",
    ]);
    expect(data.telemetry.strategy.totals.tasks).toBe(1);
    expect(data.telemetry.strategy.totals.firstPass).toEqual({ accepted: 0, total: 0 });
    const row = data.telemetry.strategy.rows[0];
    expect(row?.entity).toMatchObject({ id: "none", kind: "strategy" });
    expect(row?.tasks).toBe(1);
    expect(row?.costToAcceptance).toMatchObject({ value: null, quality: "unknown" });
    expect(row?.tokens.value).toBeNull();
    expect(row?.share).toEqual({ cost: null, tokens: null });
    expect(data.telemetry.strategy.unpriced).toEqual({ events: 0, tokens: null });
    expect(data.telemetry.strategy.price_sources).toEqual([]);
    expect(new Date(data.telemetry.model.range.from).toISOString()).toBe(
      data.telemetry.model.range.from,
    );
  });

  test("defaults to $NF_HOME/boards and can write the views as JSON", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, ["task", "add", "--title", "Board path", "--goal", "g", "--acceptance", "a"]);

    const page = nf(home, cwd, ["board"]);
    expect(
      page.startsWith(join(home, "boards") + (process.platform === "win32" ? "\\" : "/")),
    ).toBe(true);
    expect(page).toMatch(/-\d{8}T\d{6}Z\.html$/);
    expect(existsSync(page)).toBe(true);
    expect(embedded(readFileSync(page, "utf8")).tasks[0]?.id).toBe("T-001");

    const viewsPath = nf(home, cwd, ["board", "--json-only"]);
    expect(viewsPath).toMatch(/-\d{8}T\d{6}Z\.json$/);
    const views = JSON.parse(readFileSync(viewsPath, "utf8")) as Data["tasks"];
    expect(views[0]).toMatchObject({ id: "T-001", title: "Board path", status: "todo" });
    expect(views[0]?.attempts).toEqual([]);
  });

  test("the snapshot carries the project's prefixed task and attempt keys", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json"]);
    nf(home, cwd, ["task", "add", "--title", "Prefixed board", "--goal", "g", "--acceptance", "a"]);
    nf(home, cwd, [
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "direct",
    ]);

    const viewsPath = nf(home, cwd, ["board", "--json-only"]);
    const views = JSON.parse(readFileSync(viewsPath, "utf8")) as Data["tasks"];
    expect(views[0]).toMatchObject({ id: "NF-001", title: "Prefixed board" });
    expect(views[0]?.attempts[0]?.id).toBe("NF-001-A1");
  });

  test("a ui task carries the UI label and its paired screenshots", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, [
      "task",
      "add",
      "--title",
      "A screen",
      "--goal",
      "it renders",
      "--acceptance",
      "it renders",
      "--ui",
    ]);
    expect(
      nfHint(home, cwd, [
        "attempt",
        "start",
        "T-001",
        "--kind",
        "implementation",
        "--mechanism",
        "direct",
      ]).split(/\s+/)[0],
    ).toBe("T-001-A1");
    writeFileSync(join(cwd, "light.png"), PNG);
    writeFileSync(join(cwd, "dark.png"), Buffer.concat([PNG, Buffer.from("dark")]));
    for (const theme of ["light", "dark"]) {
      nf(home, cwd, [
        "attempt",
        "attach",
        "T-001-A1",
        "--file",
        `${theme}.png`,
        "--kind",
        "screenshot",
        "--theme",
        theme,
        "--name",
        "checkout",
      ]);
    }

    const html = readFileSync(nf(home, cwd, ["board"]), "utf8");
    const task = embedded(html).tasks[0];
    expect(task?.labels).toEqual(["UI"]);
    expect(task?.attachments).toHaveLength(1);
    expect(task?.attachments?.[0]).toMatchObject({
      name: "checkout",
      kind: "image",
      alt: "checkout",
      src: expect.stringMatching(/^file:\/\//),
      srcDark: expect.stringMatching(/^file:\/\//),
      thumbnail: expect.stringMatching(/^data:image\/jpeg;base64,/),
      thumbnailDark: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(task?.attachments?.[0]?.href).toStartWith("file://");
  });

  test("a missing attachment file is a named file placeholder, not a broken image", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, [
      "task",
      "add",
      "--title",
      "A lost screen",
      "--goal",
      "g",
      "--acceptance",
      "a",
      "--ui",
    ]);
    nfHint(home, cwd, [
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "direct",
    ]);
    writeFileSync(join(cwd, "light.png"), PNG);
    writeFileSync(join(cwd, "dark.png"), Buffer.concat([PNG, Buffer.from("dark")]));
    for (const theme of ["light", "dark"]) {
      nf(home, cwd, [
        "attempt",
        "attach",
        "T-001-A1",
        "--file",
        `${theme}.png`,
        "--kind",
        "screenshot",
        "--theme",
        theme,
        "--name",
        "checkout",
      ]);
    }
    const shown = JSON.parse(
      nf(home, cwd, ["attempt", "show", "T-001-A1", "--attachments", "--json"]),
    ) as { attachments: { path: string }[] };
    for (const attachment of shown.attachments) rmSync(attachment.path, { force: true });

    const task = embedded(readFileSync(nf(home, cwd, ["board"]), "utf8")).tasks[0];
    expect(task?.attachments).toHaveLength(1);
    expect(task?.attachments?.[0]).toMatchObject({
      name: "checkout",
      kind: "file",
      alt: "checkout",
    });
    expect(task?.attachments?.[0]?.href).toBeUndefined();
  });

  test("the snapshot carries the stages, the derived location and the GitHub links", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    commit(cwd, "base.txt", "base");
    git(cwd, ["checkout", "-q", "-b", "develop"]);
    const sha = commit(cwd, "develop.txt", "develop");
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, ["task", "add", "--title", "Located", "--goal", "g", "--acceptance", "a"]);
    nf(home, cwd, [
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "direct",
      "--environment-id",
      "attempt-env",
    ]);
    nf(home, cwd, [
      "attempt",
      "update",
      "T-001-A1",
      "--thread-id",
      "thread one",
      "--branch",
      "develop",
      "--add-commit",
      sha,
      "--pr",
      "12",
    ]);
    mkdirSync(join(home, "projects"), { recursive: true });
    writeFileSync(
      join(home, "projects", "T.yaml"),
      [
        "t3DeepLinks: true",
        "stages:",
        "  dev:",
        "    branch: develop",
        "  prod:",
        "    branch: main",
        "",
      ].join("\n"),
      "utf8",
    );

    const out = join(tmp("nf-board-out-"), "located.html");
    nf(home, cwd, ["board", "--out", out]);
    const html = readFileSync(out, "utf8");
    expect(externalReferences(html)).toEqual([]);
    expect(viewportUnits(html)).toEqual([]);
    const data = embedded(html);
    expect(data.stages.map((stage) => stage.id)).toEqual(["branch", "pr", "dev", "prod"]);
    const task = data.tasks[0];
    expect(task?.location).toEqual({
      stage: "dev",
      href: "https://github.com/example/board/tree/develop",
    });
    const links = task?.links ?? [];
    expect(links.find((link) => link.kind === "pull-request")).toMatchObject({
      href: "https://github.com/example/board/pull/12",
      label: "#12",
    });
    expect(links.find((link) => link.kind === "branch")).toMatchObject({
      href: "https://github.com/example/board/tree/develop",
      label: "develop",
    });
    expect(links.find((link) => link.kind === "commit")).toMatchObject({
      href: `https://github.com/example/board/commit/${sha}`,
      label: sha.slice(0, 7),
    });
    expect(task?.attempts[0]?.thread).toEqual({
      id: "thread one",
      href: "t3code://threads/attempt-env/thread%20one",
    });
  });

  test("a copy of the recorded real store renders the snapshot", () => {
    const home = tmp("nf-board-home-");
    copyFileSync(join(FIXTURES, "nf-v2.db"), join(home, "nf.db"));
    copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));
    const out = join(tmp("nf-board-out-"), "real-store.html");
    nfHint(home, repo(), ["board", "--project", "demo", "--out", out]);
    const html = readFileSync(out, "utf8");
    expect(externalReferences(html)).toEqual([]);
    expect(viewportUnits(html)).toEqual([]);
    const data = embedded(html);
    expect(data.tasks.map((task) => task.id)).toEqual([
      "DE-001",
      "DE-002",
      "DE-003",
      "DE-004",
      "DE-005",
    ]);
    expect(data.stages.map((stage) => stage.id)).toEqual(["branch", "pr", "merged"]);
    // The recorded checkout is gone, so git has nothing to say: only the recorded branch remains,
    // and a task without one has no location. It never fails the render.
    expect(data.tasks.find((task) => task.id === "DE-001")?.location).toEqual({
      stage: "branch",
    });
    expect(data.tasks.find((task) => task.id === "DE-004")?.location).toBeUndefined();
  });

  test("marks a UI review as awaiting approval and ships the review commands", () => {
    const home = tmp("nf-board-home-");
    const cwd = repo();
    nf(home, cwd, ["init", "--json", "--prefix", "T"]);
    nf(home, cwd, [
      "task",
      "add",
      "--title",
      "A screen",
      "--goal",
      "g",
      "--acceptance",
      "a",
      "--ui",
    ]);
    nfHint(home, cwd, [
      "attempt",
      "start",
      "T-001",
      "--kind",
      "implementation",
      "--mechanism",
      "direct",
    ]);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);

    const viewsPath = nf(home, cwd, ["board", "--json-only"]);
    const views = JSON.parse(readFileSync(viewsPath, "utf8")) as Data["tasks"];
    expect(views[0]).toMatchObject({ id: "T-001", status: "review", awaitingApproval: true });

    const out = join(tmp("nf-board-out-"), "snapshot.html");
    nf(home, cwd, ["board", "--out", out]);
    const html = readFileSync(out, "utf8");
    // A snapshot cannot write: it carries the copyable commands of `nf task accept|reject`.
    expect(html).toContain("nf task accept ");
    expect(html).toContain("--approved-by-user");
    expect(html).toContain("nf task reject ");
    // The snapshot embeds its data and never the live marker that carries a write token.
    expect(html).toContain('id="board-data"');
    expect(html).not.toContain('id="board-source"');
  });
});
