import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import {
  DEFAULT_UI_REVIEW,
  attachArtifact,
  boardViews,
  classifyUiChange,
  isUiPath,
  loadProjectConfig,
  parseProjectConfig,
  taskUiChange,
  uiChangeOf,
} from "../src/index.ts";
import type { Attempt, ChangedFile, UiChange, UiReviewPolicy } from "../src/index.ts";
import { addTask, cleanupAll, fixture, passAll, rejection, startImpl, tempDir } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

afterEach(cleanupAll);

const AT = "2026-01-01T12:00:00.000Z";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

const BOARD_PATHS = ["packages/board/src/**", "!packages/board/src/components/ui/**"];

const policy = (over: Partial<UiReviewPolicy> = {}): UiReviewPolicy => ({
  ...DEFAULT_UI_REVIEW,
  paths: BOARD_PATHS,
  ...over,
});

const changed = (path: string, lines: number, added = false): ChangedFile => ({
  path,
  lines,
  added,
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

const numbered = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${String(index)}\n`).join("");

function commit(repo: string, files: Readonly<Record<string, string>>, message: string): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), text, "utf8");
    git(repo, ["add", path]);
  }
  git(repo, [
    "-c",
    "user.name=nf",
    "-c",
    "user.email=nf@example.test",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/** The fixture's project root as a git repo: `main` at the base, a feature branch on top. */
function uiBranch(
  f: Fixture,
  baseFiles: Record<string, string>,
  branchFiles: Record<string, string>,
): { base: string; head: string } {
  git(f.root, ["init", "-q", "-b", "main"]);
  const base = commit(f.root, baseFiles, "base");
  git(f.root, ["checkout", "-q", "-b", "feature/ui"]);
  const head = commit(f.root, branchFiles, "ui change");
  git(f.root, ["checkout", "-q", "main"]);
  return { base, head };
}

function writeConfig(f: Fixture, text: string): void {
  mkdirSync(join(f.home, "projects"), { recursive: true });
  writeFileSync(join(f.home, "projects", "T.yaml"), text, "utf8");
}

const parseConfig = (text: string) =>
  Effect.runPromise(parseProjectConfig(text, "T.yaml")).then((config) => config.uiReview);

const configError = async (text: string): Promise<string> =>
  (await rejection(parseConfig(text))).message;

const rejectionMessage = async (promise: Promise<unknown>): Promise<string> =>
  (await rejection(promise)).message;

const review = async (f: Fixture) =>
  (await Effect.runPromise(loadProjectConfig(f.home, "T"))).uiReview;

async function attachScreenshots(f: Fixture, attemptKey: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const file = join(tempDir("nf-screen-"), `${theme}.png`);
    writeFileSync(file, Buffer.concat([PNG, Buffer.from(theme)]));
    await f.run(
      attachArtifact(f.projectId, attemptKey, {
        home: f.home,
        file,
        kind: "screenshot",
        theme,
        name: "checkout",
      }),
    );
  }
}

async function inReview(f: Fixture, taskKey: string, attemptKey: string): Promise<void> {
  await passAll(f, taskKey);
  await f.store.finishAttempt(f.projectId, attemptKey, { status: "succeeded" });
  await f.store.setStatus(f.projectId, taskKey, "working");
  await f.store.setStatus(f.projectId, taskKey, "review");
}

/** A `ui` task whose attempt recorded a base commit and the feature head on its branch. */
async function uiTaskWithChange(f: Fixture, code: { base: string; head: string }) {
  const task = await addTask(f, { ui: true });
  const attempt = await startImpl(f, task.key, { baseCommit: code.base });
  const updated = await f.store.updateAttempt(f.projectId, attempt.key, {
    branch: "feature/ui",
    addCommits: [code.head],
  });
  return { task, attempt: updated };
}

const changeOf = (f: Fixture, attempts: readonly Attempt[], reviewPolicy: UiReviewPolicy | null) =>
  f.run(uiChangeOf({ root: f.root, attempts, review: reviewPolicy }));

describe("classifying a UI change", () => {
  test("lines and files over the UI paths decide small or large", () => {
    const small = classifyUiChange(
      [
        changed("packages/board/src/App.tsx", 20),
        changed("packages/board/src/Chart.tsx", 22),
        changed("packages/board/src/components/ui/button.tsx", 400),
        changed("README.md", 30),
      ],
      policy(),
    );
    expect(small).toMatchObject({ size: "small", lines: 42, files: 2, reasons: [] });
    expect(small.text).toBe("small (42 lines, 2 files)");

    const overLines = classifyUiChange(
      [changed("packages/board/src/App.tsx", 120), changed("packages/board/src/Chart.tsx", 40)],
      policy({ maxChangedLines: 150 }),
    );
    expect(overLines.text).toBe("large (160 lines over maxChangedLines 150)");

    const overFiles = classifyUiChange(
      Array.from({ length: 7 }, (_, index) =>
        changed(`packages/board/src/part${String(index)}.tsx`, 2),
      ),
      policy({ maxChangedFiles: 6 }),
    );
    expect(overFiles.text).toBe("large (7 files over maxChangedFiles 6)");
  });

  test("a new route, page, screen, tab or dialog is large", () => {
    const route = classifyUiChange(
      [changed("packages/board/src/routes/settings.tsx", 4, true)],
      policy(),
    );
    expect(route.text).toBe("large (new screen packages/board/src/routes/settings.tsx)");
    const dialog = classifyUiChange(
      [changed("packages/board/src/components/confirm-dialog.tsx", 9, true)],
      policy(),
    );
    expect(dialog.text).toBe("large (new screen packages/board/src/components/confirm-dialog.tsx)");

    expect(
      classifyUiChange([changed("packages/board/src/components/confirm-dialog.tsx", 9)], policy())
        .size,
    ).toBe("small");
    expect(
      classifyUiChange([changed("packages/board/src/table.tsx", 9, true)], policy()).size,
    ).toBe("small");
    expect(
      classifyUiChange([changed("packages/board/src/routes.ts", 9, true)], policy()).size,
    ).toBe("small");
  });

  test("a theme or design-token style is large, and both triggers can be lowered", () => {
    const theme = classifyUiChange([changed("packages/board/src/styles/theme.css", 3)], policy());
    expect(theme.text).toBe("large (theme or tokens packages/board/src/styles/theme.css)");
    const globals = classifyUiChange([changed("packages/board/src/globals.css", 3)], policy());
    expect(globals.text).toBe("large (theme or tokens packages/board/src/globals.css)");

    expect(
      classifyUiChange(
        [changed("packages/board/src/styles/tokens.css", 3)],
        policy({ themeOrTokens: "coordinator" }),
      ).size,
    ).toBe("small");
  });

  test("the path globs apply in order, so a ! glob removes a match", () => {
    expect(isUiPath("packages/board/src/App.tsx", BOARD_PATHS)).toBe(true);
    expect(isUiPath("packages/board/src/components/ui/button.tsx", BOARD_PATHS)).toBe(false);
    expect(isUiPath("README.md", BOARD_PATHS)).toBe(false);
  });

  test("a change with no UI path at all is still small", () => {
    expect(classifyUiChange([changed("README.md", 40)], policy()).text).toBe(
      "small (0 lines, 0 files)",
    );
  });
});

describe("the UI change of an accepted attempt", () => {
  test("is the git diff from base_commit to its last commit over the UI paths", async () => {
    const f = await fixture();
    const code = uiBranch(
      f,
      {
        "packages/board/src/App.tsx": numbered(10),
        "packages/board/src/lib/format.ts": numbered(5),
        "README.md": "readme\n",
      },
      {
        "packages/board/src/App.tsx": numbered(30),
        "packages/board/src/lib/format.ts": numbered(90),
        "README.md": "readme\n\nmore\n",
      },
    );
    const { attempt } = await uiTaskWithChange(f, code);
    const change = await changeOf(
      f,
      [attempt],
      policy({ paths: [...BOARD_PATHS, "!packages/board/src/lib/**"] }),
    );
    expect(change).toMatchObject({ size: "small", lines: 20, files: 1 });
    expect(change?.text).toBe("small (20 lines, 1 file)");
  });

  test("falls back to the recorded branch, and is null without ui.review", async () => {
    const f = await fixture();
    const code = uiBranch(
      f,
      { "packages/board/src/App.tsx": numbered(10) },
      { "packages/board/src/App.tsx": numbered(60) },
    );
    const task = await addTask(f, { ui: true });
    const attempt = await startImpl(f, task.key, { baseCommit: code.base });
    const branchOnly = await f.store.updateAttempt(f.projectId, attempt.key, {
      branch: "feature/ui",
    });
    expect((await changeOf(f, [branchOnly], policy()))?.text).toBe("small (50 lines, 1 file)");
    expect(await changeOf(f, [branchOnly], null)).toBeNull();
  });
});

describe("ui.review in the project config", () => {
  test("is absent by default, which keeps every UI acceptance on the user", async () => {
    const f = await fixture();
    expect(await Effect.runPromise(loadProjectConfig(f.home, "T"))).toMatchObject({
      uiReview: null,
    });
    expect(await parseConfig("ui: { themes: [light] }\n")).toBeNull();
  });

  test("fills the thresholds it leaves out", async () => {
    expect(
      await parseConfig("ui:\n  review:\n    maxChangedLines: 20\n    newScreens: coordinator\n"),
    ).toEqual({
      paths: ["**"],
      maxChangedLines: 20,
      maxChangedFiles: 6,
      newScreens: "coordinator",
      themeOrTokens: "human",
    });
    expect(await parseConfig("ui:\n  review:\n    paths: ['src/**', '!src/vendor/**']\n")).toEqual(
      policy({ paths: ["src/**", "!src/vendor/**"] }),
    );
  });

  test("rejects a negative threshold, an empty path list and an unknown key", async () => {
    expect(await configError("ui:\n  review:\n    maxChangedLines: -1\n")).toMatch(
      /ui\.review\.maxChangedLines: must not be negative/,
    );
    expect(await configError("ui:\n  review:\n    maxChangedFiles: -2\n")).toMatch(
      /ui\.review\.maxChangedFiles: must not be negative/,
    );
    expect(await configError("ui:\n  review:\n    paths: []\n")).toMatch(
      /ui\.review\.paths: list at least one path glob/,
    );
    expect(await configError("ui:\n  review:\n    paths: ['!']\n")).toMatch(
      /ui\.review\.paths: a path glob must not be empty/,
    );
    expect(await configError("ui:\n  review:\n    maxChangedLine: 3\n")).toMatch(
      /ui\.review\.maxChangedLine: unknown key/,
    );
    expect(await configError("ui:\n  review:\n    newScreens: maybe\n")).toMatch(
      /ui\.review\.newScreens/,
    );
  });
});

/** The change both accept tests use: 20 added lines in one board file. */
const smallBranch = (f: Fixture) =>
  uiBranch(
    f,
    { "packages/board/src/App.tsx": numbered(10), "README.md": "readme\n" },
    { "packages/board/src/App.tsx": numbered(30), "README.md": "readme\n\nmore\n" },
  );

describe("accepting a UI change", () => {
  const CONFIG = [
    "ui:",
    "  themes: [light, dark]",
    "  review:",
    "    paths: ['packages/board/src/**']",
    "    maxChangedLines: 100",
    "    maxChangedFiles: 4",
    "",
  ].join("\n");

  test("a small change accepts without the user and records its size", async () => {
    const f = await fixture();
    writeConfig(f, CONFIG);
    const { task, attempt } = await uiTaskWithChange(f, smallBranch(f));
    await inReview(f, task.key, attempt.key);
    const change = await changeOf(f, [attempt], await review(f));

    const noEvidence = await rejectionMessage(
      f.store.acceptTask(f.projectId, task.key, { themes: ["light", "dark"], uiChange: change }),
    );
    expect(noEvidence).toContain("a light screenshot on T-001-A1");
    expect(noEvidence).not.toContain("--approved-by-user");

    await attachScreenshots(f, attempt.key);
    const done = await f.store.acceptTask(f.projectId, task.key, {
      themes: ["light", "dark"],
      uiChange: change,
    });
    expect(done.status).toBe("done");
    const events = await f.store.listEvents(f.projectId, task.key);
    expect(events.find((event) => event.kind === "ui_change")?.note).toBe(
      "small (20 lines, 1 file)",
    );

    const [view] = await f.run(boardViews(f.projectId, AT, { home: f.home }));
    expect(view?.uiChange).toBe("small (20 lines, 1 file)");
  });

  test("a large change refuses without the user and names the reason", async () => {
    const f = await fixture();
    writeConfig(f, CONFIG);
    const code = uiBranch(
      f,
      { "packages/board/src/App.tsx": numbered(10) },
      {
        "packages/board/src/App.tsx": numbered(12),
        "packages/board/src/components/confirm-dialog.tsx": numbered(20),
      },
    );
    const { task, attempt } = await uiTaskWithChange(f, code);
    await attachScreenshots(f, attempt.key);
    await inReview(f, task.key, attempt.key);

    const attempted = await rejectionMessage(
      f.store.acceptTask(f.projectId, task.key, {
        themes: ["light", "dark"],
        uiChange: await changeOf(f, [attempt], await review(f)),
      }),
    );
    expect(attempted).toContain(
      "--approved-by-user (UI change: large (new screen packages/board/src/components/confirm-dialog.tsx))",
    );

    const done = await f.store.acceptTask(f.projectId, task.key, {
      themes: ["light", "dark"],
      approvedByUser: true,
      uiChange: await changeOf(f, [attempt], await review(f)),
    });
    expect(done.status).toBe("done");
    const events = await f.store.listEvents(f.projectId, task.key);
    expect(events.find((event) => event.kind === "ui_change")?.note).toContain("large (new screen");
  });

  test("a UI task without ui.review still needs the user", async () => {
    const f = await fixture();
    writeConfig(f, "ui: { themes: [light, dark] }\n");
    const { task, attempt } = await uiTaskWithChange(f, smallBranch(f));
    await attachScreenshots(f, attempt.key);
    await inReview(f, task.key, attempt.key);
    expect(await changeOf(f, [attempt], await review(f))).toBeNull();
    expect(
      await rejectionMessage(
        f.store.acceptTask(f.projectId, task.key, { themes: ["light", "dark"] }),
      ),
    ).toMatch(/--approved-by-user/);
  });

  test("a change NF cannot measure still needs the user", async () => {
    const f = await fixture();
    writeConfig(f, CONFIG);
    const task = await addTask(f, { ui: true });
    const attempt = await startImpl(f, task.key);
    await attachScreenshots(f, attempt.key);
    await inReview(f, task.key, attempt.key);
    expect(await changeOf(f, [attempt], await review(f))).toBeNull();
    expect(
      await rejectionMessage(
        f.store.acceptTask(f.projectId, task.key, { themes: ["light", "dark"] }),
      ),
    ).toMatch(/--approved-by-user/);
  });

  test("the reported text prefers the recorded verdict over a fresh diff", async () => {
    const f = await fixture();
    writeConfig(f, CONFIG);
    const { task, attempt } = await uiTaskWithChange(f, smallBranch(f));
    await attachScreenshots(f, attempt.key);
    await inReview(f, task.key, attempt.key);
    const recorded: UiChange = {
      size: "small",
      lines: 1,
      files: 1,
      reasons: [],
      text: "small (1 line, 1 file)",
    };
    expect((await changeOf(f, [attempt], await review(f)))?.text).toBe("small (20 lines, 1 file)");
    await f.store.acceptTask(f.projectId, task.key, {
      themes: ["light", "dark"],
      uiChange: recorded,
    });
    expect(
      await f.run(
        taskUiChange({
          root: f.root,
          attempts: [attempt],
          review: await review(f),
          events: await f.store.listEvents(f.projectId, task.key),
        }),
      ),
    ).toBe(recorded.text);
  });
});
