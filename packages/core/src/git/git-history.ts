import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { GitBranchList, GitCommitDetail, GitCompare, GitLogPage, NfError } from "@nf/contracts";
import type { GitBranch, GitCommit } from "@nf/contracts";
import { COMMIT_FORMAT, changeSet, parseCommits } from "./git-diff.ts";
import { gitText, gitTextOrNull, nulFields, readGit } from "./git-read.ts";

const REPO_CONCURRENCY = 4;
const BRANCH_LIMIT = 200;
const TREE_BYTES = 4 * 1024 * 1024;
const COMPARE_COMMIT_LIMIT = 300;
export const LOG_PAGE_DEFAULT = 100;
const LOG_PAGE_MAX = 500;

const decodeBranches = Schema.decodeEffect(GitBranchList);
const decodeLogPage = Schema.decodeEffect(GitLogPage);
const decodeCommitDetail = Schema.decodeEffect(GitCommitDetail);
const decodeCompare = Schema.decodeEffect(GitCompare);

const invalid = (message: string) => new NfError({ code: "invalid_value", message });

export const count = (text: string | null): number | null => {
  if (text === null) return null;
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? null : value;
};

/** A ref, a sha or `HEAD`, with `~`/`^` suffixes; never an option, a range or a path. */
const validRef = (ref: string): boolean =>
  ref.length > 0 &&
  ref.length <= 256 &&
  !ref.startsWith("-") &&
  !ref.includes("..") &&
  !/[\s:\\?*[\]\p{Cc}]/u.test(ref);

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const isSha = (text: string): boolean => SHA.test(text);

/**
 * A ref name can read like an option (`refs/heads/--output=x` is a valid branch), so a name only
 * ever reaches git here, after `--end-of-options`; every other command gets the resolved sha.
 */
export const commitOf = (cwd: string, ref: string) =>
  gitTextOrNull(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).pipe(Effect.map((sha) => (sha !== null && isSha(sha) ? sha : null)));

/** Revisions for a git command line: resolved shas only. */
export const shas = (values: readonly string[]): string[] => {
  for (const value of values) {
    if (!isSha(value)) throw new Error(`a revision must be a resolved sha, got '${value}'`);
  }
  return [...values];
};

/** The commit a requested ref names, or a failure. */
export const resolveCommit = Effect.fn("GitHistory.resolveCommit")(function* (
  cwd: string,
  ref: string,
) {
  if (!validRef(ref)) return yield* invalid(`'${ref}' is not a branch, tag or commit`);
  const sha = yield* commitOf(cwd, ref);
  if (sha === null) {
    return yield* new NfError({ code: "not_found", message: `'${ref}' is not a commit here` });
  }
  return sha;
});

export interface BaseBranch {
  /** As shown: `main`, or `origin/main` when only the remote copy exists. */
  readonly name: string;
  readonly sha: string;
}

/**
 * The branch merges land on: the configured name, else `origin/HEAD`, else `main` or `master`;
 * the local branch first, then its `origin/` copy.
 */
export const defaultBranch = Effect.fn("GitHistory.defaultBranch")(function* (
  cwd: string,
  configured: string | null,
) {
  const names: string[] = [];
  if (configured !== null) names.push(configured);
  const originHead = yield* gitTextOrNull(cwd, [
    "symbolic-ref",
    "--quiet",
    "refs/remotes/origin/HEAD",
  ]);
  const remotePrefix = "refs/remotes/origin/";
  if (originHead?.startsWith(remotePrefix) === true) {
    names.push(originHead.slice(remotePrefix.length));
  }
  names.push("main", "master");
  for (const name of names) {
    if (!validRef(name)) continue;
    const local = yield* commitOf(cwd, `refs/heads/${name}`);
    if (local !== null) return { name, sha: local } satisfies BaseBranch;
    const remote = yield* commitOf(cwd, `${remotePrefix}${name}`);
    if (remote !== null) return { name: `origin/${name}`, sha: remote } satisfies BaseBranch;
  }
  return null;
});

/** Commits only in `left` and only in `right`. */
export const leftRight = Effect.fnUntraced(function* (cwd: string, left: string, right: string) {
  const [from, to] = shas([left, right]);
  const text = yield* gitTextOrNull(cwd, [
    "rev-list",
    "--left-right",
    "--count",
    "--end-of-options",
    `${from}...${to}`,
    "--",
  ]);
  const [only = "", other = ""] = (text ?? "").split(/\s+/);
  return [count(text === null ? null : only), count(text === null ? null : other)] as const;
});

/** Commits reachable from `include` and from none of `exclude` (nor any remote branch). */
export const listCommits = Effect.fnUntraced(function* (
  cwd: string,
  include: string,
  exclude: readonly string[],
  mode: "count" | "list",
  options: { readonly excludeRemotes?: boolean } = {},
) {
  return yield* gitTextOrNull(cwd, [
    "rev-list",
    ...(mode === "count" ? ["--count"] : []),
    ...(options.excludeRemotes === true ? ["--not", "--remotes", "--not"] : []),
    "--end-of-options",
    ...shas([include]),
    ...shas(exclude).map((sha) => `^${sha}`),
    "--",
  ]);
});

const BRANCH_FORMAT =
  "--format=%(refname:short)%00%(objectname)%00%(upstream)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:iso-strict)%00%(authorname)%00%(HEAD)";

/** Local branches, most recently committed first, with their distance from the default branch. */
export const listBranches = Effect.fn("GitHistory.listBranches")(function* (
  cwd: string,
  configuredBase: string | null,
) {
  const base = yield* defaultBranch(cwd, configuredBase);
  const text = yield* gitText(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    `--count=${BRANCH_LIMIT}`,
    BRANCH_FORMAT,
    "refs/heads",
  ]);
  const rows = text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\0"));
  const branches = yield* Effect.forEach(
    rows,
    Effect.fnUntraced(function* (row) {
      const [
        name = "",
        head = "",
        upstreamRef = "",
        upstreamName = "",
        track = "",
        updatedAt = "",
        author = "",
        current = "",
      ] = row;
      if (!isSha(head)) return null;
      const upstreamSha =
        upstreamRef.length > 0 && track !== "gone" ? yield* commitOf(cwd, upstreamRef) : null;
      const [ahead, behind] = base === null ? [null, null] : yield* leftRight(cwd, head, base.sha);
      const unpushed =
        upstreamSha === null ? null : count(yield* listCommits(cwd, head, [upstreamSha], "count"));
      const branch: GitBranch = {
        name,
        head,
        current: current === "*",
        upstream: upstreamSha === null ? null : upstreamName,
        ahead,
        behind,
        unpushed,
        base: base?.name ?? null,
        updatedAt: updatedAt.length > 0 ? updatedAt : null,
        author: author.length > 0 ? author : null,
      };
      return branch;
    }),
    { concurrency: REPO_CONCURRENCY },
  );
  return yield* decodeBranches(branches.filter((branch) => branch !== null));
});

const ALL_REFS = ["--branches", "--remotes", "--tags"] as const;

/** The log's commits: one, or HEAD with every branch, remote branch and tag (`ALL_REFS`). */
const logRevisions = Effect.fnUntraced(function* (cwd: string, branch: string | null) {
  if (branch !== null) return [yield* resolveCommit(cwd, branch)];
  const head = yield* commitOf(cwd, "HEAD");
  return head === null ? [] : [head];
});

export interface LogQuery {
  readonly branch: string | null;
  readonly all: boolean;
  readonly cursor: string | null;
  readonly limit: string | null;
}

const DIGITS = /^\d{1,9}$/;

/** One page of history in topological order; the cursor is the number of commits already read. */
export const commitLog = Effect.fn("GitHistory.commitLog")(function* (
  cwd: string,
  query: LogQuery,
) {
  if (query.cursor !== null && !DIGITS.test(query.cursor)) {
    return yield* invalid(`cursor '${query.cursor}' is not one this log returned`);
  }
  const skip = query.cursor === null ? 0 : Number.parseInt(query.cursor, 10);
  const limit = query.limit === null ? LOG_PAGE_DEFAULT : Number.parseInt(query.limit, 10);
  if ((query.limit !== null && !DIGITS.test(query.limit)) || limit < 1 || limit > LOG_PAGE_MAX) {
    return yield* invalid(`limit must be a whole number from 1 to ${LOG_PAGE_MAX}`);
  }
  const revs = yield* logRevisions(cwd, query.all ? null : query.branch);
  const selection = query.all ? [...ALL_REFS] : [];
  if (revs.length === 0 && !query.all)
    return yield* decodeLogPage({ commits: [], total: 0, next: null });
  const [logged, total] = yield* Effect.all(
    [
      gitText(cwd, [
        "log",
        "--topo-order",
        "--shortstat",
        COMMIT_FORMAT,
        `--skip=${skip}`,
        `--max-count=${limit + 1}`,
        ...selection,
        "--end-of-options",
        ...shas(revs),
        "--",
      ]),
      gitTextOrNull(cwd, [
        "rev-list",
        "--count",
        ...selection,
        "--end-of-options",
        ...shas(revs),
        "--",
      ]),
    ],
    { concurrency: "unbounded" },
  );
  const commits = parseCommits(logged);
  const more = commits.length > limit;
  return yield* decodeLogPage({
    commits: commits.slice(0, limit),
    total: count(total),
    next: more ? String(skip + limit) : null,
  });
});

const commitMetadata = Effect.fnUntraced(function* (cwd: string, sha: string) {
  const [commit] = parseCommits(
    yield* gitText(cwd, [
      "log",
      "-1",
      "--shortstat",
      COMMIT_FORMAT,
      "--end-of-options",
      ...shas([sha]),
      "--",
    ]),
  );
  if (commit === undefined) {
    return yield* new NfError({ code: "not_found", message: `'${sha}' is not a commit here` });
  }
  return commit;
});

/** The diff command between two commits, or of a root commit against nothing. */
export const diffCommand = (from: string | null, to: string): string[] =>
  from === null
    ? ["diff-tree", "-r", "--root", "--no-commit-id", ...shas([to])]
    : ["diff-tree", "-r", ...shas([from, to])];

/** A commit, its change against its first parent, and every path in its tree. */
export const commitDetail = Effect.fn("GitHistory.commitDetail")(function* (
  cwd: string,
  ref: string,
) {
  const sha = yield* resolveCommit(cwd, ref);
  const commit = yield* commitMetadata(cwd, sha);
  const parent = commit.parents[0] ?? null;
  const [changes, tree] = yield* Effect.all(
    [
      changeSet(cwd, diffCommand(parent, sha)),
      readGit(cwd, ["ls-tree", "-r", "--name-only", "-z", ...shas([sha])], {
        maxBytes: TREE_BYTES,
      }),
    ],
    { concurrency: "unbounded" },
  );
  const paths = nulFields(tree.stdout);
  if (tree.cut) paths.pop();
  return yield* decodeCommitDetail({
    commit,
    parent,
    files: changes.files,
    patch: changes.patch,
    truncated: changes.truncated,
    tree: paths,
    treeTruncated: tree.cut,
  });
});

/** What `head` adds over `base`: its commits and the diff from their merge base. */
export const compareRefs = Effect.fn("GitHistory.compareRefs")(function* (
  cwd: string,
  base: string,
  head: string,
) {
  const [baseSha, headSha] = yield* Effect.all([
    resolveCommit(cwd, base),
    resolveCommit(cwd, head),
  ]);
  const mergeBase = yield* readGit(cwd, ["merge-base", ...shas([baseSha, headSha])], {
    okCodes: [0, 1],
  }).pipe(
    Effect.map((output) => {
      const sha = output.stdout.trim();
      return isSha(sha) ? sha : null;
    }),
  );
  const [behind, ahead] = yield* leftRight(cwd, baseSha, headSha);
  const logged = yield* gitText(cwd, [
    "log",
    "--topo-order",
    "--shortstat",
    COMMIT_FORMAT,
    `--max-count=${COMPARE_COMMIT_LIMIT + 1}`,
    "--end-of-options",
    `${baseSha}..${headSha}`,
    "--",
  ]);
  const commits: GitCommit[] = parseCommits(logged);
  const changes = yield* changeSet(cwd, diffCommand(mergeBase ?? baseSha, headSha));
  return yield* decodeCompare({
    base,
    head,
    mergeBase,
    ahead,
    behind,
    commits: commits.slice(0, COMPARE_COMMIT_LIMIT),
    commitsTruncated: commits.length > COMPARE_COMMIT_LIMIT,
    files: changes.files,
    patch: changes.patch,
    truncated: changes.truncated,
  });
});
