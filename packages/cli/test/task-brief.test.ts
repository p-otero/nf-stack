import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.ts";

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

function repo(): string {
  const dir = tmp("nf-brief-repo-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://example.test/brief.git"], { cwd: dir });
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
  json: () => any;
}

/** `main` in this process: the same argv parsing, Effect programs and SQLite writes. */
function nf(home: string, cwd: string) {
  return async (args: string[]): Promise<Run> => {
    let out = "";
    let err = "";
    const code = await main(
      args,
      {
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
        readStdin: async () => "",
      },
      { ...process.env, NF_HOME: home, NF_OFFLINE: "1" },
      cwd,
    );
    return { code, out, err, json: () => JSON.parse(out) };
  };
}

interface Project {
  home: string;
  cwd: string;
  nf: (args: string[]) => Promise<Run>;
}

async function project(): Promise<Project> {
  const home = tmp("nf-brief-home-");
  const cwd = repo();
  const run = nf(home, cwd);
  await run(["init", "--json", "--prefix", "T"]);
  return { home, cwd, nf: run };
}

const addBrief = (p: Project, title = "Old title", goal = "Old goal") =>
  p.nf([
    "task",
    "add",
    "--title",
    title,
    "--goal",
    goal,
    "--acceptance",
    "first item",
    "--acceptance",
    "second item",
  ]);

const briefOf = async (p: Project) =>
  (await p.nf(["task", "show", "T-001", "--json"])).json() as {
    title: string;
    goal: string;
    status: string;
    acceptance: { position: number; text: string; result: string; evidence: string | null }[];
  };

const eventsOf = async (p: Project) =>
  (await p.nf(["task", "show", "T-001", "--events", "--json"])).json() as {
    events: { kind: string; note: string | null }[];
  };

describe("task set brief fields", () => {
  test("title and goal are editable, shown, and audited with the old and new value", async () => {
    const p = await project();
    await addBrief(p);

    const edited = await p.nf([
      "task",
      "set",
      "T-001",
      "--title",
      "New title",
      "--goal",
      "New goal",
      "--json",
    ]);
    expect(edited.code).toBe(0);
    expect(edited.json()).toMatchObject({ title: "New title", goal: "New goal" });

    const shown = await p.nf(["task", "show", "T-001"]);
    expect(shown.out).toContain("T-001  todo  New title");
    expect(shown.out).toContain("goal: New goal");
    expect(await briefOf(p)).toMatchObject({ title: "New title", goal: "New goal" });

    const events = (await eventsOf(p)).events.filter((e) => e.kind === "update");
    expect(events.map((e) => e.note)).toEqual([
      'title: "Old title" -> "New title"',
      'goal: "Old goal" -> "New goal"',
    ]);

    expect((await p.nf(["task", "set", "T-001", "--title", "  "])).code).toBe(1);
    expect((await p.nf(["task", "set", "T-001"])).code).toBe(2);
    expect((await p.nf(["help"])).out).toContain("--add-acceptance");
  });

  test("acceptance edits reset changed and new items and keep unchanged results", async () => {
    const p = await project();
    await addBrief(p);
    expect(
      (
        await p.nf([
          "task",
          "check",
          "T-001",
          "--item",
          "1",
          "--result",
          "pass",
          "--evidence",
          "ran it",
        ])
      ).code,
    ).toBe(0);

    const replaced = await p.nf([
      "task",
      "set",
      "T-001",
      "--acceptance",
      "first item",
      "--acceptance",
      "rewritten",
      "--json",
    ]);
    expect(replaced.code).toBe(0);
    expect(replaced.json().acceptance).toEqual([
      { position: 1, text: "first item", result: "pass", evidence: "ran it" },
      { position: 2, text: "rewritten", result: "unverified", evidence: null },
    ]);

    const added = await p.nf(["task", "set", "T-001", "--add-acceptance", "extra", "--json"]);
    expect(
      added
        .json()
        .acceptance.map((a: { position: number; text: string; result: string }) => [
          a.position,
          a.text,
          a.result,
        ]),
    ).toEqual([
      [1, "first item", "pass"],
      [2, "rewritten", "unverified"],
      [3, "extra", "unverified"],
    ]);

    const removed = await p.nf(["task", "set", "T-001", "--remove-acceptance", "2", "--json"]);
    expect(removed.json().acceptance).toEqual([
      { position: 1, text: "first item", result: "pass", evidence: "ran it" },
      { position: 2, text: "extra", result: "unverified", evidence: null },
    ]);

    const acceptance = (await eventsOf(p)).events.filter((e) => e.kind === "acceptance");
    expect(acceptance.map((e) => e.note)).toEqual([
      'acceptance: ["first item","second item"] -> ["first item","rewritten"]',
      'acceptance: ["first item","rewritten"] -> ["first item","rewritten","extra"]',
      'acceptance: ["first item","rewritten","extra"] -> ["first item","extra"]',
    ]);
  });

  test("a missing acceptance item and mixed acceptance flags are refused", async () => {
    const p = await project();
    await addBrief(p);

    const missing = await p.nf(["task", "set", "T-001", "--remove-acceptance", "9"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("T-001 has no acceptance item #9");

    const mixed = await p.nf([
      "task",
      "set",
      "T-001",
      "--acceptance",
      "a",
      "--add-acceptance",
      "b",
    ]);
    expect(mixed.code).toBe(2);
    expect(mixed.err).toContain("either --acceptance or --add-acceptance/--remove-acceptance");

    const notNumber = await p.nf(["task", "set", "T-001", "--remove-acceptance", "last"]);
    expect(notNumber.code).toBe(2);
    expect(notNumber.err).toContain("needs an acceptance number");
  });

  test("a done task refuses brief edits unless --reopen comes in the same call", async () => {
    const p = await project();
    await addBrief(p);
    await p.nf(["task", "check", "T-001", "--item", "1", "--result", "pass"]);
    await p.nf(["task", "check", "T-001", "--item", "2", "--result", "pass"]);
    await p.nf(["task", "set", "T-001", "--status", "working"]);
    await p.nf(["task", "set", "T-001", "--status", "review"]);
    expect((await p.nf(["task", "accept", "T-001"])).code).toBe(0);

    const refusedTitle = await p.nf(["task", "set", "T-001", "--title", "changed"]);
    expect(refusedTitle.code).toBe(1);
    expect(refusedTitle.err).toContain("T-001 is done; pass --reopen");

    const refusedAcceptance = await p.nf(["task", "set", "T-001", "--add-acceptance", "third"]);
    expect(refusedAcceptance.code).toBe(1);
    expect((await briefOf(p)).status).toBe("done");

    const reopened = await p.nf([
      "task",
      "set",
      "T-001",
      "--title",
      "changed",
      "--add-acceptance",
      "third",
      "--reopen",
      "--json",
    ]);
    expect(reopened.code).toBe(0);
    expect(reopened.json().status).toBe("todo");
    expect(await briefOf(p)).toMatchObject({
      title: "changed",
      status: "todo",
      acceptance: [
        { position: 1, text: "first item", result: "pass" },
        { position: 2, text: "second item", result: "pass" },
        { position: 3, text: "third", result: "unverified" },
      ],
    });
    expect((await eventsOf(p)).events.at(-1)?.kind).toBe("reopen");
  });

  test("a cancelled task reopens with an explicit target in the same call", async () => {
    const p = await project();
    await addBrief(p);
    expect((await p.nf(["task", "set", "T-001", "--status", "cancelled"])).code).toBe(0);
    expect((await p.nf(["task", "set", "T-001", "--title", "changed"])).code).toBe(1);

    const reopened = await p.nf([
      "task",
      "set",
      "T-001",
      "--title",
      "changed",
      "--status",
      "todo",
      "--reopen",
      "--json",
    ]);
    expect(reopened.code).toBe(0);
    expect(reopened.json()).toMatchObject({ title: "changed", status: "todo" });
    expect((await eventsOf(p)).events.at(-1)?.kind).toBe("reopen");
  });

  test("the board data carries the edited brief", async () => {
    const p = await project();
    await addBrief(p);
    await p.nf([
      "task",
      "set",
      "T-001",
      "--title",
      "Board title",
      "--goal",
      "Board goal",
      "--add-acceptance",
      "third item",
    ]);

    const out = join(tmp("nf-brief-board-"), "board.json");
    expect((await p.nf(["board", "--json-only", "--out", out, "--json"])).code).toBe(0);
    const views = JSON.parse(readFileSync(out, "utf8")) as {
      title: string;
      goal: string;
      acceptance: { text: string; result: string }[];
    }[];
    expect(views[0]).toMatchObject({
      title: "Board title",
      goal: "Board goal",
      acceptance: [
        { text: "first item", result: "unverified" },
        { text: "second item", result: "unverified" },
        { text: "third item", result: "unverified" },
      ],
    });
  });
});
