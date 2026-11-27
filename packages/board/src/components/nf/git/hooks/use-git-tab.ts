import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type { GitTabLocation } from "@/components/nf/git/git-model";
import {
  branchNamesOf,
  toHistoryCommits,
  worktreeOf,
  worktreeCounts,
} from "@/components/nf/git/git-model";
import {
  gitApiBase,
  readGitBranches,
  readGitCommit,
  readGitLog,
  readGitRepos,
  readGitWorktree,
  readGitWorktrees,
} from "@/components/nf/git/git-client";

const GIT_READS = { refetchOnWindowFocus: false, staleTime: 15_000 } as const;

/** What the Git tab reads: the repositories, the chosen checkout's branches, history and changes. */
function useGitTabReads(api: string, project: string | null, location: GitTabLocation) {
  const base = gitApiBase(api);
  const reposQuery = useQuery({
    queryKey: ["git", "repos", project],
    queryFn: () => readGitRepos(base, project ?? ""),
    enabled: project !== null,
    ...GIT_READS,
  });
  const repos = reposQuery.data;
  const repo = repos?.find((entry) => entry.id === location.repo) ?? repos?.[0];

  const worktreesQuery = useQuery({
    queryKey: ["git", "worktrees", project, repo?.id],
    queryFn: () => readGitWorktrees(base, project ?? "", repo?.id ?? ""),
    enabled: project !== null && repo !== undefined,
    ...GIT_READS,
  });
  const worktrees = worktreesQuery.data;
  const picked = worktreeOf(worktrees ?? [], location.worktree);
  const ownCheckout = picked === undefined || picked.main;
  const worktreePath = ownCheckout ? null : (picked?.path ?? null);
  const branch = location.branch ?? picked?.branch ?? repo?.branch ?? null;
  // A worktree in the URL reads nothing until git has told which worktrees exist.
  const awaitingCheckout = location.worktree !== null && worktreesQuery.isPending;

  const branchesQuery = useQuery({
    queryKey: ["git", "branches", project, repo?.id, worktreePath],
    queryFn: () => readGitBranches(base, project ?? "", repo?.id ?? "", worktreePath),
    enabled: project !== null && repo !== undefined && !awaitingCheckout,
    ...GIT_READS,
  });
  const branchNames = useMemo(
    () => (branchesQuery.data ? branchNamesOf(branchesQuery.data) : undefined),
    [branchesQuery.data],
  );

  const logQuery = useInfiniteQuery({
    queryKey: ["git", "log", project, repo?.id, worktreePath, branch],
    queryFn: ({ pageParam }) =>
      readGitLog(base, project ?? "", repo?.id ?? "", worktreePath, branch, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: project !== null && repo !== undefined && !awaitingCheckout,
    ...GIT_READS,
  });
  const commits = useMemo(
    () => logQuery.data?.pages.flatMap((page) => page.commits) ?? [],
    [logQuery.data],
  );
  const history = useMemo(() => toHistoryCommits(commits), [commits]);

  const changesQuery = useQuery({
    queryKey: ["git", "worktree", project, repo?.id, worktreePath],
    queryFn: () => readGitWorktree(base, project ?? "", repo?.id ?? "", worktreePath),
    enabled:
      project !== null && repo !== undefined && !awaitingCheckout && (repo.dirty || !ownCheckout),
    ...GIT_READS,
  });
  const changes = changesQuery.data;
  const counts = changes === undefined ? null : worktreeCounts(changes);

  const commitQuery = useQuery({
    queryKey: ["git", "commit", project, repo?.id, location.commit],
    queryFn: () => readGitCommit(base, project ?? "", repo?.id ?? "", location.commit ?? ""),
    enabled: location.commit !== null && repo !== undefined,
    ...GIT_READS,
  });

  return {
    base,
    repos: { query: reposQuery, list: repos, repo },
    checkout: {
      query: worktreesQuery,
      worktrees,
      picked,
      path: worktreePath,
      ownCheckout,
      branch,
    },
    branches: { query: branchesQuery, names: branchNames },
    history: {
      query: logQuery,
      commits,
      rows: history,
      total: logQuery.data?.pages[0]?.total ?? undefined,
      /** Changes the default selection when another checkout or a refetch changes the data. */
      selectionKey: `${project ?? ""}·${repo?.id ?? ""}·${worktreePath ?? ""}·${branch ?? ""}`,
      newest: commits[0]?.sha ?? null,
    },
    changes: {
      query: changesQuery,
      worktree: changes,
      counts,
      /** A checkout whose changes are still unknown counts as one that may have some. */
      maybeDirty:
        (repo?.dirty === true || !ownCheckout) &&
        (changes === undefined || (counts?.files ?? 0) > 0),
    },
    commitQuery,
  };
}

export { GIT_READS, useGitTabReads };
