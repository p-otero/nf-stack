import { execFile } from "node:child_process";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { TASK_LINK_STATE } from "@nf/contracts";
import type { TaskLinkState } from "@nf/contracts";
import type { GitHubRepository } from "../domain/pull-request.ts";
import { effectMemo } from "./effect-memo.ts";

export interface PullRequestFact {
  readonly href: string;
  readonly state: TaskLinkState;
  readonly baseBranch: string | null;
}

/** GitHub's PR facts for a project, or null when `gh` is missing, unauthenticated or offline. */
export interface PullRequestSource {
  byHref(repository: GitHubRepository | null, href: string): Effect.Effect<PullRequestFact | null>;
  byHead(
    repository: GitHubRepository | null,
    branch: string,
  ): Effect.Effect<PullRequestFact | null>;
}

/**
 * How many of a repository's newest pull requests one query reads: the recorded PRs and branches
 * of a project sit well inside that window, and an older href costs one lookup of its own.
 */
const BATCH_LIMIT = 100;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const GhState = Schema.Literals(["OPEN", "CLOSED", "MERGED"]);
const GhPullRequestView = Schema.Struct({
  state: GhState,
  isDraft: Schema.Boolean,
  baseRefName: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const GhPullRequest = Schema.Struct({
  number: Schema.Finite,
  url: Schema.String,
  state: GhState,
  isDraft: Schema.Boolean,
  baseRefName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  headRefName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
type GhPullRequestView = typeof GhPullRequestView.Type;
type GhPullRequest = typeof GhPullRequest.Type;

const decodeGhView = Schema.decodeUnknownOption(Schema.fromJsonString(GhPullRequestView));
const decodeGhList = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(GhPullRequest)));

const GH_STATE: Record<"OPEN" | "CLOSED" | "MERGED", TaskLinkState> = {
  OPEN: TASK_LINK_STATE.OPEN,
  CLOSED: TASK_LINK_STATE.CLOSED,
  MERGED: TASK_LINK_STATE.MERGED,
};

const factOf = (pull: GhPullRequestView & { readonly url: string }): PullRequestFact => ({
  href: pull.url,
  state: pull.isDraft && pull.state === "OPEN" ? TASK_LINK_STATE.DRAFT : GH_STATE[pull.state],
  baseBranch: pull.baseRefName ?? null,
});

interface RepositoryFacts {
  readonly byHref: ReadonlyMap<string, PullRequestFact>;
  readonly byHead: ReadonlyMap<string, PullRequestFact>;
}

/** One repository's pull requests indexed both ways: by their url and by their head branch. */
function repositoryFacts(pulls: readonly GhPullRequest[]): RepositoryFacts {
  const byHref = new Map<string, PullRequestFact>();
  const byHead = new Map<string, PullRequestFact>();
  for (const pull of pulls.toSorted((left, right) => left.number - right.number)) {
    const fact = factOf(pull);
    byHref.set(pull.url, fact);
    const head = pull.headRefName ?? null;
    if (head !== null) byHead.set(head, fact);
  }
  return { byHref, byHead };
}

const runGh = (
  command: readonly string[],
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly token: string | null },
): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    const [executable = "gh", ...prefix] = command;
    const child = execFile(
      executable,
      [...prefix, ...args],
      {
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: options.token === null ? process.env : { ...process.env, GH_TOKEN: options.token },
      },
      (error, stdout) => resume(Effect.succeed(error === null ? stdout : null)),
    );
    return Effect.sync(() => {
      child.kill();
    });
  });

/** Owners whose `gh auth token` answer is known, for this process only. */
const ownerTokens = new Map<string, string>();

/**
 * Read PR facts with `gh`, authenticating as the repository owner's signed-in account when there
 * is one: `GH_TOKEN` scopes that token to one call and leaves gh's own config alone. One
 * `gh pr list` per repository answers every attempt of its project.
 */
export function ghPullRequestSource(
  options: { command?: readonly string[]; timeoutMs?: number } = {},
): PullRequestSource {
  const command = options.command ?? ["gh"];
  const timeoutMs = options.timeoutMs ?? 4_000;
  const batches = effectMemo<RepositoryFacts | null>();
  const single = effectMemo<PullRequestFact | null>();
  const tokens = effectMemo<string | null>();
  let versionCheck: Effect.Effect<boolean> | null = null;

  const available = Effect.fn("GhPullRequest.available")(function* () {
    if (versionCheck === null) {
      versionCheck = yield* Effect.cached(
        runGh(command, ["--version"], { timeoutMs, token: null }).pipe(
          Effect.map((printed) => printed !== null),
        ),
      );
    }
    return yield* versionCheck;
  });

  const ownerToken = Effect.fn("GhPullRequest.ownerToken")(function* (
    repository: GitHubRepository | null,
  ) {
    if (repository === null) return null;
    const owner = repository.owner;
    const known = ownerTokens.get(owner);
    if (known !== undefined) return known;
    const token = yield* tokens.read(owner, () =>
      runGh(command, ["auth", "token", "--user", owner], { timeoutMs, token: null }).pipe(
        Effect.map((printed) => {
          const value = printed?.trim() ?? "";
          return value.length === 0 ? null : value;
        }),
      ),
    );
    if (token !== null) ownerTokens.set(owner, token);
    return token;
  });

  const loadBatch = Effect.fn("GhPullRequest.batch")(function* (repository: GitHubRepository) {
    if (!(yield* available())) return null;
    const output = yield* runGh(
      command,
      [
        "pr",
        "list",
        "--repo",
        `${repository.owner}/${repository.name}`,
        "--state",
        "all",
        "--limit",
        String(BATCH_LIMIT),
        "--json",
        "number,url,state,isDraft,baseRefName,headRefName,mergedAt",
      ],
      { timeoutMs, token: yield* ownerToken(repository) },
    );
    if (output === null) return null;
    const decoded = decodeGhList(output);
    return Option.isSome(decoded) ? repositoryFacts(decoded.value) : null;
  });

  const batchOf = (repository: GitHubRepository): Effect.Effect<RepositoryFacts | null> =>
    batches.read(`${repository.owner}/${repository.name}`, () => loadBatch(repository));

  const readSingle = Effect.fn("GhPullRequest.single")(function* (
    repository: GitHubRepository | null,
    href: string,
  ) {
    if (!(yield* available())) return null;
    const output = yield* runGh(
      command,
      ["pr", "view", href, "--json", "state,isDraft,baseRefName"],
      { timeoutMs, token: yield* ownerToken(repository) },
    );
    if (output === null) return null;
    const decoded = decodeGhView(output);
    return Option.isSome(decoded) ? factOf({ ...decoded.value, url: href }) : null;
  });

  const byHref = Effect.fn("GhPullRequest.byHref")(function* (
    repository: GitHubRepository | null,
    href: string,
  ) {
    if (repository !== null) {
      const facts = yield* batchOf(repository);
      if (facts === null) return null;
      const known = facts.byHref.get(href);
      if (known !== undefined) return known;
    }
    return yield* single.read(href, () => readSingle(repository, href));
  });

  const byHead = Effect.fn("GhPullRequest.byHead")(function* (
    repository: GitHubRepository | null,
    branch: string,
  ) {
    if (repository === null) return null;
    const facts = yield* batchOf(repository);
    return facts?.byHead.get(branch) ?? null;
  });

  return { byHref, byHead };
}
