import { afterEach, describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { ghPullRequestSource, githubRepository } from "../src/index.ts";
import type { PullRequestFact, PullRequestSource } from "../src/index.ts";
import { cleanupAll, fakeGh } from "./helpers.ts";

afterEach(cleanupAll);

const REMOTE = "https://github.com/acme/demo.git";
const PR_URL = "https://github.com/acme/demo/pull/7";
const OTHER_URL = "https://github.com/acme/demo/pull/9";

const read = (
  source: PullRequestSource,
  repository: ReturnType<typeof githubRepository>,
  question: { href: string } | { branch: string },
): Promise<PullRequestFact | null> =>
  Effect.runPromise(
    "href" in question
      ? source.byHref(repository, question.href)
      : source.byHead(repository, question.branch),
  );

const LIST_ARGS = [
  "pr",
  "list",
  "--repo",
  "acme/demo",
  "--state",
  "all",
  "--limit",
  "100",
  "--json",
  "number,url,state,isDraft,baseRefName,headRefName,mergedAt",
];

const pull = (over: Record<string, unknown>) => ({
  number: 7,
  url: PR_URL,
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feature/x",
  mergedAt: null,
  ...over,
});

describe("gh pull request source", () => {
  test("one query per repository answers every href and branch of it", async () => {
    const gh = fakeGh();
    gh.configure({
      tokens: { acme: "owner-token" },
      list: [
        pull({}),
        pull({
          number: 9,
          url: OTHER_URL,
          state: "MERGED",
          headRefName: "feature/y",
          mergedAt: "2026-11-16T10:00:00Z",
        }),
        pull({ number: 8, url: "https://github.com/acme/demo/pull/8", isDraft: true }),
      ],
    });
    const source = ghPullRequestSource({ command: gh.command });
    const repository = githubRepository(REMOTE);

    expect(await read(source, repository, { href: PR_URL })).toEqual({
      href: PR_URL,
      state: "open",
      baseBranch: "main",
    });
    expect(await read(source, repository, { href: OTHER_URL })).toEqual({
      href: OTHER_URL,
      state: "merged",
      baseBranch: "main",
    });
    expect(await read(source, repository, { branch: "feature/x" })).toEqual({
      href: "https://github.com/acme/demo/pull/8",
      state: "draft",
      baseBranch: "main",
    });
    expect(await read(source, repository, { branch: "feature/y" })).toEqual({
      href: OTHER_URL,
      state: "merged",
      baseBranch: "main",
    });
    expect(await read(source, repository, { branch: "feature/missing" })).toBeNull();

    const lists = gh.calls().filter((call) => call.args[1] === "list");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toEqual({ args: LIST_ARGS, token: "owner-token" });
    expect(gh.calls().map((call) => call.args[0])).toEqual(["--version", "auth", "pr"]);
    expect(gh.calls().some((call) => call.args[1] === "switch")).toBe(false);
  });

  test("the batch's newest pull request answers a branch with several", async () => {
    const gh = fakeGh();
    gh.configure({
      list: [
        pull({ number: 3, url: "https://github.com/acme/demo/pull/3", state: "CLOSED" }),
        pull({ number: 11, url: "https://github.com/acme/demo/pull/11", state: "OPEN" }),
      ],
    });
    const source = ghPullRequestSource({ command: gh.command });
    expect((await read(source, githubRepository(REMOTE), { branch: "feature/x" }))?.href).toBe(
      "https://github.com/acme/demo/pull/11",
    );
  });

  test("an href older than the batch costs one lookup", async () => {
    const gh = fakeGh();
    gh.configure({
      tokens: { older: "older-token" },
      list: [pull({})],
      view: { state: "MERGED", isDraft: false, baseRefName: "release" },
    });
    const source = ghPullRequestSource({ command: gh.command });
    expect(
      await read(source, githubRepository("https://github.com/older/demo.git"), {
        href: "https://github.com/older/demo/pull/1",
      }),
    ).toEqual({
      href: "https://github.com/older/demo/pull/1",
      state: "merged",
      baseBranch: "release",
    });
    const lookup = gh.calls().find((call) => call.args[1] === "view");
    expect(lookup).toEqual({
      args: [
        "pr",
        "view",
        "https://github.com/older/demo/pull/1",
        "--json",
        "state,isDraft,baseRefName",
      ],
      token: "older-token",
    });
    expect(await read(source, githubRepository(REMOTE), { href: PR_URL })).toEqual({
      href: PR_URL,
      state: "open",
      baseBranch: "main",
    });
  });

  test("falls back to the default auth when the owner has no token", async () => {
    const gh = fakeGh();
    gh.configure({ list: [pull({ isDraft: true })] });
    const source = ghPullRequestSource({ command: gh.command });
    expect(
      await read(source, githubRepository("https://github.com/other-owner/demo.git"), {
        href: PR_URL,
      }),
    ).toEqual({ href: PR_URL, state: "draft", baseBranch: "main" });
    const auth = gh.calls().find((call) => call.args[1] === "token");
    expect(auth?.args).toEqual(["auth", "token", "--user", "other-owner"]);
    expect(auth?.token).toBeNull();
    expect(gh.calls().find((call) => call.args[1] === "list")?.token).toBeNull();
  });

  test("an owner's token is read once for the whole process", async () => {
    const gh = fakeGh();
    gh.configure({ tokens: { cached: "cached-token" }, list: [pull({})] });
    const repository = githubRepository("https://github.com/cached/demo.git");
    await read(ghPullRequestSource({ command: gh.command }), repository, { href: PR_URL });
    await read(ghPullRequestSource({ command: gh.command }), repository, { href: PR_URL });
    expect(gh.calls().filter((call) => call.args[1] === "token")).toHaveLength(1);
  });

  test("a missing gh yields no facts and no authentication attempt", async () => {
    const source = ghPullRequestSource({ command: ["nf-gh-does-not-exist"] });
    const repository = githubRepository(REMOTE);
    expect(await read(source, repository, { href: PR_URL })).toBeNull();
    expect(await read(source, repository, { branch: "feature/x" })).toBeNull();
  });

  test("an unauthenticated or offline gh yields null facts, never a throw", async () => {
    const gh = fakeGh();
    gh.configure({
      view: { state: "OPEN", isDraft: false, baseRefName: "main" },
    });
    const source = ghPullRequestSource({ command: gh.command });
    const repository = githubRepository(REMOTE);
    expect(await read(source, repository, { href: PR_URL })).toBeNull();
    expect(await read(source, repository, { branch: "feature/x" })).toBeNull();
    expect(gh.calls().some((call) => call.args[1] === "view")).toBe(false);
  });

  test("a repository that is not GitHub is never looked up by branch", async () => {
    const gh = fakeGh();
    gh.configure({ list: [pull({})] });
    const source = ghPullRequestSource({ command: gh.command });
    expect(
      await read(source, githubRepository("https://example.test/acme/demo.git"), {
        branch: "feature/x",
      }),
    ).toBeNull();
    expect(gh.calls()).toEqual([]);
  });
});
