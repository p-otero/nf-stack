import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { GitRepoList } from "@nf/contracts";
import type { GitRepo } from "@nf/contracts";
import { count, isSha, listCommits } from "./git-history.ts";
import { gitTextOrNull } from "./git-read.ts";
import { readStatus } from "./git-status.ts";
import { repoGitDirInside, repoId, scanRepositories } from "./git-workspace.ts";

const REPO_CONCURRENCY = 4;

const decodeRepos = Schema.decodeEffect(GitRepoList);

const remoteUrls = Effect.fnUntraced(function* (cwd: string) {
  const text = yield* gitTextOrNull(cwd, ["config", "--get-regexp", "^remote\\..*\\.url$"]);
  const urls = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    const match = /^remote\.(.+)\.url (.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) urls.set(match[1], match[2]);
  }
  return urls;
});

const repoSummary = Effect.fnUntraced(function* (workspaceRoot: string, path: string) {
  const status = yield* readStatus(path);
  const urls = yield* remoteUrls(path);
  const upstreamRemote = status.upstream === null ? null : yield* trackedRemote(path);
  const commits =
    status.head === null || !isSha(status.head)
      ? status.head === null
        ? 0
        : null
      : count(yield* listCommits(path, status.head, [], "count"));
  const repo: GitRepo = {
    id: repoId(workspaceRoot, path),
    path: path.split("\\").join("/"),
    branch: status.branch,
    head: status.head,
    dirty: status.uncommitted > 0,
    uncommitted: status.uncommitted,
    ahead: status.ahead,
    behind: status.behind,
    upstream: status.upstream,
    remote: urls.get(upstreamRemote ?? "origin") ?? null,
    commits,
  };
  return repo;
});

/** The remote of the checked-out branch's upstream, read without naming the branch. */
const trackedRemote = (cwd: string) =>
  gitTextOrNull(cwd, ["symbolic-ref", "--quiet", "HEAD"]).pipe(
    Effect.flatMap((ref) =>
      ref === null || !ref.startsWith("refs/heads/")
        ? Effect.succeed(null)
        : gitTextOrNull(cwd, [
            "for-each-ref",
            "--format=%(refname)%00%(upstream:remotename)",
            ref,
          ]).pipe(
            Effect.map((text) => {
              for (const line of (text ?? "").split("\n")) {
                const [name = "", remote = ""] = line.split("\0");
                if (name === ref && remote.length > 0) return remote;
              }
              return null;
            }),
          ),
    ),
  );

/** Every repository of the workspace with its branch, HEAD, changes and upstream counts. */
export const listRepos = Effect.fn("GitRepos.list")(function* (workspaceRoot: string) {
  const found = yield* Effect.promise(() => scanRepositories(workspaceRoot));
  const repos = yield* Effect.forEach(
    found,
    (path) =>
      repoGitDirInside(workspaceRoot, path).pipe(
        Effect.flatMap((inside) =>
          inside ? repoSummary(workspaceRoot, path) : Effect.succeed(null),
        ),
        Effect.catchTags({ NfError: () => Effect.succeed(null) }),
      ),
    { concurrency: REPO_CONCURRENCY },
  );
  return yield* decodeRepos(repos.filter((repo) => repo !== null));
});
