import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// `nf` runs under *node*, the same way it ships, so the flags, messages and exit codes are the real ones.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");

setDefaultTimeout(60_000);

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
  const dir = tmp("nf-ui-repo-");
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["remote", "add", "origin", "https://example.test/ui.git"], { cwd: dir });
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const numbered = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${String(index)}\n`).join("");

function commit(cwd: string, name: string, text: string): string {
  mkdirSync(join(cwd, dirname(name)), { recursive: true });
  writeFileSync(join(cwd, name), text, "utf8");
  git(cwd, ["add", name]);
  git(cwd, [
    "-c",
    "user.name=nf",
    "-c",
    "user.email=nf@example.test",
    "commit",
    "-q",
    "-m",
    `change ${name}`,
  ]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

/** A 1x1 PNG; the CLI only checks the extension and the size. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function run(home: string, cwd: string, args: string[]) {
  const r = spawnSync(NODE, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function nf(home: string, cwd: string, args: string[]): string {
  const r = run(home, cwd, args);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  return r.out.trim();
}

function project(): { home: string; cwd: string } {
  const home = tmp("nf-ui-home-");
  const cwd = repo();
  nf(home, cwd, ["init", "--json", "--prefix", "T"]);
  return { home, cwd };
}

function writeConfig(home: string, text: string): void {
  mkdirSync(join(home, "projects"), { recursive: true });
  writeFileSync(join(home, "projects", "T.yaml"), text, "utf8");
}

/** `nf attempt start` on a ui task puts the evidence hint on stderr and the key line on stdout. */
function startUi(home: string, cwd: string, extra: string[] = []) {
  const r = run(home, cwd, [
    "attempt",
    "start",
    "T-001",
    "--kind",
    "implementation",
    "--mechanism",
    "delegate_task",
    ...extra,
  ]);
  expect(r.code).toBe(0);
  expect(r.out.trim().split(/\s+/)[0]).toBe("T-001-A1");
  return r.err;
}

/** A light and a dark screenshot of the same screen on the task's accepted attempt. */
function attachThemes(home: string, cwd: string): void {
  for (const theme of ["light", "dark"]) {
    writeFileSync(join(cwd, `${theme}.png`), Buffer.concat([PNG, Buffer.from(theme)]));
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
      "board",
    ]);
  }
}

describe("nf ui tasks", () => {
  test("--ui and --no-ui show in json, task list and task show", () => {
    const { home, cwd } = project();
    const created = JSON.parse(
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
        "--json",
      ]),
    ) as { ui: boolean };
    expect(created.ui).toBe(true);
    expect(nf(home, cwd, ["task", "list"])).toContain("A screen  [ui]");
    expect(nf(home, cwd, ["task", "show", "T-001"])).toContain("ui: yes");

    const unset = JSON.parse(nf(home, cwd, ["task", "set", "T-001", "--no-ui", "--json"])) as {
      ui: boolean;
    };
    expect(unset.ui).toBe(false);
    expect(nf(home, cwd, ["task", "list"])).not.toContain("[ui]");

    const conflict = run(home, cwd, ["task", "set", "T-001", "--ui", "--no-ui"]);
    expect(conflict.code).toBe(2);
    expect(conflict.err).toContain("either --ui or --no-ui");
  });

  test("attempt attach copies the file, reports the row and refuses bad evidence", () => {
    const { home, cwd } = project();
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
    const hint = startUi(home, cwd);
    expect(hint).toContain("every changed screen, state and component");
    expect(hint).toContain("once per project theme (light, dark)");
    expect(hint).toContain("nf attempt attach T-001-A1");
    expect(hint).toContain("--theme light");
    writeFileSync(join(cwd, "light.png"), PNG);
    const attached = nf(home, cwd, [
      "attempt",
      "attach",
      "T-001-A1",
      "--file",
      "light.png",
      "--kind",
      "screenshot",
      "--theme",
      "light",
      "--name",
      "checkout",
    ]);
    expect(attached).toContain("screenshot light  checkout");
    expect(attached).toContain("artifacts");

    const shown = JSON.parse(
      nf(home, cwd, ["attempt", "show", "T-001-A1", "--attachments", "--json"]),
    ) as { attachments: { name: string; theme: string; kind: string; path: string }[] };
    expect(shown.attachments).toHaveLength(1);
    expect(shown.attachments[0]).toMatchObject({
      name: "checkout",
      theme: "light",
      kind: "screenshot",
    });
    expect(shown.attachments[0]?.path.startsWith(home)).toBe(true);
    const plain = JSON.parse(nf(home, cwd, ["attempt", "show", "T-001-A1", "--json"])) as {
      attachments?: unknown;
    };
    expect(plain.attachments).toBeUndefined();

    writeFileSync(join(cwd, "notes.txt"), "not an image");
    const notMedia = run(home, cwd, [
      "attempt",
      "attach",
      "T-001-A1",
      "--file",
      "notes.txt",
      "--kind",
      "screenshot",
      "--theme",
      "light",
    ]);
    expect(notMedia.code).toBe(1);
    expect(notMedia.err).toContain("needs an image");

    const noTheme = run(home, cwd, [
      "attempt",
      "attach",
      "T-001-A1",
      "--file",
      "light.png",
      "--kind",
      "screenshot",
    ]);
    expect(noTheme.code).toBe(1);
    expect(noTheme.err).toContain("--theme light|dark");
  });

  test("task accept refuses a ui task until screenshots and --approved-by-user are there", () => {
    const { home, cwd } = project();
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
    startUi(home, cwd);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);
    nf(home, cwd, [
      "task",
      "check",
      "T-001",
      "--item",
      "1",
      "--result",
      "pass",
      "--evidence",
      "ok",
    ]);

    const denied = run(home, cwd, ["task", "accept", "T-001"]);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("light screenshot");
    expect(denied.err).toContain("dark screenshot");
    expect(denied.err).toContain("--approved-by-user");

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
    const unapproved = run(home, cwd, ["task", "accept", "T-001"]);
    expect(unapproved.code).toBe(1);
    expect(unapproved.err).toContain("--approved-by-user");

    expect(nf(home, cwd, ["task", "accept", "T-001", "--approved-by-user"])).toContain(
      "T-001  done",
    );
  });

  test("a project with only the light theme asks for and accepts one screenshot", () => {
    const { home, cwd } = project();
    writeConfig(home, "ui: { themes: [light] }\n");
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
    const hint = startUi(home, cwd);
    expect(hint).toContain("once per project theme (light)");
    expect(hint).not.toContain("--theme dark");
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);
    nf(home, cwd, ["task", "check", "T-001", "--item", "1", "--result", "pass"]);

    writeFileSync(join(cwd, "light.png"), PNG);
    nf(home, cwd, [
      "attempt",
      "attach",
      "T-001-A1",
      "--file",
      "light.png",
      "--kind",
      "screenshot",
      "--theme",
      "light",
      "--name",
      "checkout",
    ]);
    const undeclared = run(home, cwd, [
      "attempt",
      "attach",
      "T-001-A1",
      "--file",
      "light.png",
      "--kind",
      "screenshot",
      "--theme",
      "dark",
      "--name",
      "checkout",
    ]);
    expect(undeclared.code).toBe(1);
    expect(undeclared.err).toContain("--theme dark is not declared for this project");
    expect(undeclared.err).toContain(join(home, "projects", "T.yaml"));

    expect(nf(home, cwd, ["task", "accept", "T-001", "--approved-by-user"])).toContain(
      "T-001  done",
    );
  });

  test("task reject needs a comment and sends the review back to working", () => {
    const { home, cwd } = project();
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
    startUi(home, cwd);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);

    const missing = run(home, cwd, ["task", "reject", "T-001"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("missing --comment");

    const blank = run(home, cwd, ["task", "reject", "T-001", "--comment", "   "]);
    expect(blank.code).toBe(1);
    expect(blank.err).toContain("rejection comment must not be empty");

    const comment = "The dialog overlaps the footer";
    expect(nf(home, cwd, ["task", "reject", "T-001", "--comment", comment])).toContain(
      "T-001  working",
    );
    const shown = JSON.parse(nf(home, cwd, ["task", "show", "T-001", "--events", "--json"])) as {
      decision_needed: string | null;
      events: {
        kind: string;
        actor_role: string;
        from_status: string | null;
        to_status: string | null;
        note: string | null;
      }[];
    };
    expect(shown.decision_needed).toBe(comment);
    expect(shown.events.at(-1)).toMatchObject({
      kind: "review_rejected",
      actor_role: "user",
      from_status: "review",
      to_status: "working",
      note: comment,
    });

    const again = run(home, cwd, ["task", "reject", "T-001", "--comment", "again"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("working -> working is not allowed");
  });

  test("a small ui change accepts without --approved-by-user and shows its size", () => {
    const { home, cwd } = project();
    writeConfig(
      home,
      [
        "ui:",
        "  themes: [light, dark]",
        "  review:",
        "    paths: ['packages/board/src/**']",
        "    maxChangedLines: 100",
        "",
      ].join("\n"),
    );
    const base = commit(cwd, "packages/board/src/App.tsx", numbered(10));
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
    startUi(home, cwd, ["--base-commit", base]);
    git(cwd, ["checkout", "-q", "-b", "feature/ui"]);
    const head = commit(cwd, "packages/board/src/App.tsx", numbered(30));
    nf(home, cwd, ["attempt", "update", "T-001-A1", "--add-commit", head]);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);
    nf(home, cwd, ["task", "check", "T-001", "--item", "1", "--result", "pass"]);
    attachThemes(home, cwd);

    expect(nf(home, cwd, ["task", "show", "T-001"])).toContain(
      "ui change: small (20 lines, 1 file)",
    );
    const shown = JSON.parse(nf(home, cwd, ["task", "show", "T-001", "--json"])) as {
      ui_change?: string;
    };
    expect(shown.ui_change).toBe("small (20 lines, 1 file)");

    expect(nf(home, cwd, ["task", "accept", "T-001"])).toContain("T-001  done");
    const events = nf(home, cwd, ["task", "show", "T-001", "--events"]);
    expect(events).toContain("ui_change");
    expect(events).toContain("small (20 lines, 1 file)");
  });

  test("a large ui change still needs --approved-by-user and names the reason", () => {
    const { home, cwd } = project();
    writeConfig(
      home,
      [
        "ui:",
        "  themes: [light, dark]",
        "  review:",
        "    paths: ['packages/board/src/**']",
        "    maxChangedLines: 100",
        "",
      ].join("\n"),
    );
    const base = commit(cwd, "packages/board/src/App.tsx", numbered(10));
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
    startUi(home, cwd, ["--base-commit", base]);
    git(cwd, ["checkout", "-q", "-b", "feature/ui"]);
    commit(cwd, "packages/board/src/App.tsx", numbered(12));
    const head = commit(cwd, "packages/board/src/components/confirm-dialog.tsx", numbered(20));
    nf(home, cwd, ["attempt", "update", "T-001-A1", "--add-commit", head]);
    nf(home, cwd, ["attempt", "finish", "T-001-A1", "--status", "succeeded"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "working"]);
    nf(home, cwd, ["task", "set", "T-001", "--status", "review"]);
    nf(home, cwd, ["task", "check", "T-001", "--item", "1", "--result", "pass"]);
    attachThemes(home, cwd);

    const denied = run(home, cwd, ["task", "accept", "T-001"]);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain(
      "--approved-by-user (UI change: large (new screen packages/board/src/components/confirm-dialog.tsx))",
    );
    expect(nf(home, cwd, ["task", "accept", "T-001", "--approved-by-user"])).toContain(
      "T-001  done",
    );
  });
});
