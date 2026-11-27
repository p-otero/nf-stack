import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { ghPullRequestSource, locationCache } from "../src/index.ts";
import type { GitProbe, PullRequestFact, PullRequestSource } from "../src/index.ts";

const REPOSITORY = { owner: "o", name: "demo" };
const PR_URL = "https://github.com/o/demo/pull/1";

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect);

const NO_FACTS: PullRequestSource = {
  byHref: () => Effect.succeed(null),
  byHead: () => Effect.succeed(null),
};

const NO_PROBES = (root: string): GitProbe => ({
  root,
  ref: () => Effect.succeed(null),
  contains: () => Effect.succeed(false),
  tags: () => Effect.succeed([]),
});

/** Sources that name their own generation in every answer and record what each one was asked. */
function generations() {
  const asked: { generation: number; question: string }[] = [];
  let created = 0;
  const create = (): PullRequestSource => {
    created += 1;
    const generation = created;
    const answer = (question: string, fact: PullRequestFact) =>
      Effect.andThen(Effect.sleep("2 millis"), () =>
        Effect.sync(() => {
          asked.push({ generation, question });
          return fact;
        }),
      );
    return {
      byHref: (_repository, href) =>
        answer(`href ${href}`, {
          href: `${href}#${generation}`,
          state: "open",
          baseBranch: null,
        }),
      byHead: (_repository, branch) =>
        answer(`head ${branch}`, {
          href: `https://github.com/o/demo/pull/${generation}`,
          state: "open",
          baseBranch: null,
        }),
    };
  };
  return { asked, create, generationsSeen: () => created };
}

describe("location cache", () => {
  test("answers from the facts it already read and refreshes nothing while they are fresh", async () => {
    let now = 0;
    const sources = generations();
    const cache = locationCache({
      ttlMs: 1_000,
      now: () => now,
      pullRequests: sources.create,
      probe: NO_PROBES,
    });

    expect((await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL)))?.href).toBe(`${PR_URL}#1`);
    now = 999;
    expect((await run(cache.readPullRequest.byHead(REPOSITORY, "feature/x")))?.href).toBe(
      "https://github.com/o/demo/pull/1",
    );
    await run(cache.refresh);
    expect(sources.generationsSeen()).toBe(1);
    expect(sources.asked.map((entry) => entry.question)).toEqual([
      `href ${PR_URL}`,
      "head feature/x",
    ]);
  });

  test("a stale answer is served and one refresh reads the replacement", async () => {
    let now = 0;
    const sources = generations();
    const cache = locationCache({
      ttlMs: 1_000,
      now: () => now,
      pullRequests: sources.create,
      probe: NO_PROBES,
    });

    await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL));
    now = 1_000;
    expect((await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL)))?.href).toBe(`${PR_URL}#1`);
    await run(cache.refresh);
    expect(sources.generationsSeen()).toBe(2);
    expect(sources.asked.filter((entry) => entry.generation === 2)).toContainEqual({
      generation: 2,
      question: `href ${PR_URL}`,
    });
    expect((await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL)))?.href).toBe(`${PR_URL}#2`);
    await run(cache.refresh);
    expect(sources.generationsSeen()).toBe(2);
  });

  test("two refreshes at once read the replacement once", async () => {
    let now = 0;
    const sources = generations();
    const cache = locationCache({
      ttlMs: 1_000,
      now: () => now,
      pullRequests: sources.create,
      probe: NO_PROBES,
    });

    await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL));
    now = 1_000;
    await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL));
    await run(Effect.all([cache.refresh, cache.refresh], { concurrency: "unbounded" }));
    expect(sources.generationsSeen()).toBe(2);
  });

  test("git answers are served stale and replaced only after the refresh", async () => {
    let now = 0;
    const probed: string[] = [];
    const cache = locationCache({
      ttlMs: 1_000,
      now: () => now,
      pullRequests: () => NO_FACTS,
      probe: (root) => {
        const generation = probed.length + 1;
        probed.push(root);
        return {
          root,
          ref: (name) => Effect.succeed(`${name}#${generation}`),
          contains: () => Effect.succeed(generation === 2),
          tags: () => Effect.succeed([]),
        };
      },
    });

    const stale = cache.gitProbe("/repo");
    expect(await run(stale.ref("refs/heads/main"))).toBe("refs/heads/main#1");
    now = 1_000;
    expect(await run(stale.ref("refs/heads/main"))).toBe("refs/heads/main#1");
    expect(await run(stale.contains("abc", "refs/heads/main"))).toBe(false);
    await run(cache.refresh);
    expect(probed).toEqual(["/repo", "/repo"]);
    expect(await run(cache.gitProbe("/repo").contains("abc", "refs/heads/main"))).toBe(true);
  });

  test("PR facts stay null when gh is missing, and a refresh never throws", async () => {
    let now = 0;
    const cache = locationCache({
      ttlMs: 1_000,
      now: () => now,
      pullRequests: () => ghPullRequestSource({ command: ["nf-gh-does-not-exist"] }),
      probe: NO_PROBES,
    });

    expect(await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL))).toBeNull();
    expect(await run(cache.readPullRequest.byHead(REPOSITORY, "feature/x"))).toBeNull();
    now = 1_000;
    await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL));
    await run(cache.refresh);
    expect(await run(cache.readPullRequest.byHref(REPOSITORY, PR_URL))).toBeNull();
  });
});
