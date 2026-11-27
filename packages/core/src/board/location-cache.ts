import * as Effect from "effect/Effect";
import { gitProbe } from "./code-location.ts";
import type { GitProbe } from "./code-location.ts";
import { ghPullRequestSource } from "./pull-request-source.ts";
import type { PullRequestFact, PullRequestSource } from "./pull-request-source.ts";

/** GitHub and git answers older than this are replaced, while the stale ones keep answering. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const WARM_CONCURRENCY = 8;

interface Replay<T> {
  (target: T): Effect.Effect<void>;
}

export interface LocationCacheOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly pullRequests?: () => PullRequestSource;
  readonly probe?: (root: string) => GitProbe;
}

export interface LocationCache {
  readonly readPullRequest: PullRequestSource;
  readonly gitProbe: (root: string) => GitProbe;
  /**
   * Replace what this cache answered with when it is older than the TTL. A caller runs it after
   * responding: the stale facts stay in use until the replacement is warm, and a second call while
   * that runs is a no-op.
   */
  readonly refresh: Effect.Effect<void>;
}

interface PullRequestGeneration {
  readonly at: number;
  readonly source: PullRequestSource;
}

interface ProbeGeneration {
  readonly at: number;
  readonly probe: GitProbe;
  due: boolean;
  readonly asks: Map<string, Replay<GitProbe>>;
}

const repositoryKey = (repository: { owner: string; name: string } | null): string =>
  repository === null ? "" : `${repository.owner}/${repository.name}`;

/**
 * The PR facts and git answers the board derives from, kept between polls and refreshed in the
 * background: a poll answers from the facts already read, and the next one uses their
 * replacement. Every question is remembered, so a replacement is warmed with the same questions
 * instead of waiting for a build to ask them again.
 */
export function locationCache(options: LocationCacheOptions = {}): LocationCache {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const createPullRequests = options.pullRequests ?? (() => ghPullRequestSource());
  const createProbe = options.probe ?? ((root: string) => gitProbe(root));

  const pullRequestAsks = new Map<string, Replay<PullRequestSource>>();
  const probes = new Map<string, ProbeGeneration>();
  let pullRequests: PullRequestGeneration = { at: now(), source: createPullRequests() };
  let pullRequestsDue = false;
  let refreshing = false;

  const answerPullRequest = (
    key: string,
    replay: Replay<PullRequestSource>,
    generation: PullRequestGeneration,
    answer: Effect.Effect<PullRequestFact | null>,
  ): Effect.Effect<PullRequestFact | null> => {
    pullRequestAsks.set(key, replay);
    if (now() - generation.at >= ttlMs) pullRequestsDue = true;
    return answer;
  };

  const readPullRequest: PullRequestSource = {
    byHref: (repository, href) => {
      const generation = pullRequests;
      return answerPullRequest(
        `href\u0000${repositoryKey(repository)}\u0000${href}`,
        (target) => Effect.asVoid(target.byHref(repository, href)),
        generation,
        generation.source.byHref(repository, href),
      );
    },
    byHead: (repository, branch) => {
      const generation = pullRequests;
      return answerPullRequest(
        `head\u0000${repositoryKey(repository)}\u0000${branch}`,
        (target) => Effect.asVoid(target.byHead(repository, branch)),
        generation,
        generation.source.byHead(repository, branch),
      );
    },
  };

  const probeGeneration = (root: string): ProbeGeneration => {
    const known = probes.get(root);
    if (known !== undefined) return known;
    const created: ProbeGeneration = {
      at: now(),
      probe: createProbe(root),
      due: false,
      asks: new Map(),
    };
    probes.set(root, created);
    return created;
  };

  const gitProbeFor = (root: string): GitProbe => {
    const generation = probeGeneration(root);
    const answer = <A>(
      key: string,
      replay: Replay<GitProbe>,
      read: Effect.Effect<A>,
    ): Effect.Effect<A> => {
      generation.asks.set(key, replay);
      if (now() - generation.at >= ttlMs) generation.due = true;
      return read;
    };
    return {
      root,
      ref: (name) =>
        answer(
          `ref\u0000${name}`,
          (target) => Effect.asVoid(target.ref(name)),
          generation.probe.ref(name),
        ),
      contains: (commit, ref) =>
        answer(
          `contains\u0000${commit}\u0000${ref}`,
          (target) => Effect.asVoid(target.contains(commit, ref)),
          generation.probe.contains(commit, ref),
        ),
      tags: (pattern, commit) =>
        answer(
          `tags\u0000${pattern}\u0000${commit}`,
          (target) => Effect.asVoid(target.tags(pattern, commit)),
          generation.probe.tags(pattern, commit),
        ),
    };
  };

  const warmPullRequests = Effect.gen(function* () {
    const next = createPullRequests();
    yield* Effect.forEach([...pullRequestAsks.values()], (ask) => ask(next), {
      concurrency: WARM_CONCURRENCY,
      discard: true,
    });
    pullRequests = { at: now(), source: next };
    pullRequestsDue = false;
  });

  const warmProbes = Effect.gen(function* () {
    for (const [root, generation] of probes) {
      if (!generation.due) continue;
      const next = createProbe(root);
      yield* Effect.forEach([...generation.asks.values()], (ask) => ask(next), {
        concurrency: WARM_CONCURRENCY,
        discard: true,
      });
      const replacement: ProbeGeneration = {
        at: now(),
        probe: next,
        due: false,
        asks: generation.asks,
      };
      probes.set(root, replacement);
    }
  });

  const refresh: Effect.Effect<void> = Effect.gen(function* () {
    if (refreshing) return;
    if (!pullRequestsDue && ![...probes.values()].some((generation) => generation.due)) return;
    refreshing = true;
    yield* Effect.ensuring(
      Effect.andThen(warmPullRequests, warmProbes),
      Effect.sync(() => {
        refreshing = false;
      }),
    );
  });

  return { readPullRequest, gitProbe: gitProbeFor, refresh };
}
