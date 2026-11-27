import { useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CommitHistory, WORKING_TREE } from "@/components/ui/commit-history";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { RepositorySelect } from "@/components/ui/repository-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  branchNamesOf,
  repoName,
  toHistoryCommits,
  toRepository,
  upstreamHeadOf,
  worktreeCounts,
  type GitTabLocation,
} from "@/components/nf/git/git-model";
import {
  gitApiBase,
  readGitBranches,
  readGitCommit,
  readGitLog,
  readGitRepos,
  readGitWorktree,
} from "@/components/nf/git/git-client";
import { CheckoutStatus } from "@/components/nf/git/checkout-status";
import { CommitPane } from "@/components/nf/git/commit-pane";
import { GitCommitView } from "@/components/nf/git/git-commit-view";
import { useWide } from "@/components/nf/git/hooks/use-wide";
import { WorktreePane } from "@/components/nf/git/worktree-pane";
import { cn } from "@/lib/utils";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function GitReadError({
  what,
  error,
  onRetry,
  className,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Alert
      role="alert"
      tone="destructive"
      className={cn("h-fit", className)}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <AlertTitle>The Git tab could not read {what}</AlertTitle>
      <AlertDescription>{messageOf(error)}</AlertDescription>
    </Alert>
  );
}

function GitLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-items rounded-surface border bg-card px-inset-item py-inset-item"
    >
      <p className="sr-only">{label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-control-sm" />
      ))}
    </div>
  );
}

function PickProject() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Pick a project</EmptyTitle>
        <EmptyDescription>
          The Git tab reads one project's workspace. Choose a project above; “All projects” spans
          several and has no repositories of its own.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type Choice = { key: string; id: string | null };

const READS = { refetchOnWindowFocus: false, staleTime: 15_000 } as const;

function SelectedCommit({
  base,
  project,
  repo,
  sha,
  timeZone,
  onOpenFull,
}: {
  base: string;
  project: string;
  repo: string;
  sha: string;
  timeZone?: string;
  onOpenFull: () => void;
}) {
  const query = useQuery({
    queryKey: ["git", "commit", project, repo, sha],
    queryFn: () => readGitCommit(base, project, repo, sha),
    ...READS,
  });
  if (query.isPending) return <GitLoading label="Reading the commit…" rows={5} />;
  if (query.isError) {
    return (
      <GitReadError
        what="the commit"
        error={query.error}
        onRetry={() => void query.refetch()}
        className="min-w-0 flex-1"
      />
    );
  }
  return <CommitPane detail={query.data} timeZone={timeZone} onOpenFull={onOpenFull} />;
}

function GitTab({
  api,
  project,
  timeZone,
  location,
  onLocationChange,
}: {
  api: string;
  project: string | null;
  timeZone?: string;
  location: GitTabLocation;
  onLocationChange: (location: GitTabLocation) => void;
}) {
  const wide = useWide();
  const queryClient = useQueryClient();
  const base = gitApiBase(api);

  const reposQuery = useQuery({
    queryKey: ["git", "repos", project],
    queryFn: () => readGitRepos(base, project ?? ""),
    enabled: project !== null,
    ...READS,
  });
  const repos = reposQuery.data;
  const repo = repos?.find((entry) => entry.id === location.repo) ?? repos?.[0];
  const branch = location.branch ?? repo?.branch ?? null;
  const selectionKey = `${project ?? ""}·${repo?.id ?? ""}·${branch ?? ""}`;

  const branchesQuery = useQuery({
    queryKey: ["git", "branches", project, repo?.id],
    queryFn: () => readGitBranches(base, project ?? "", repo?.id ?? ""),
    enabled: project !== null && repo !== undefined,
    ...READS,
  });
  const branchNames = useMemo(
    () => (branchesQuery.data ? branchNamesOf(branchesQuery.data) : undefined),
    [branchesQuery.data],
  );

  const logQuery = useInfiniteQuery({
    queryKey: ["git", "log", project, repo?.id, branch],
    queryFn: ({ pageParam }) => readGitLog(base, project ?? "", repo?.id ?? "", branch, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: project !== null && repo !== undefined,
    ...READS,
  });
  const commits = useMemo(
    () => logQuery.data?.pages.flatMap((page) => page.commits) ?? [],
    [logQuery.data],
  );
  const history = useMemo(() => toHistoryCommits(commits), [commits]);
  const total = logQuery.data?.pages[0]?.total ?? undefined;

  const worktreeQuery = useQuery({
    queryKey: ["git", "worktree", project, repo?.id],
    queryFn: () => readGitWorktree(base, project ?? "", repo?.id ?? ""),
    enabled: project !== null && repo?.dirty === true,
    ...READS,
  });
  const worktree = worktreeQuery.data;
  const counts = worktree === undefined ? null : worktreeCounts(worktree);
  const hasChanges = counts !== null && counts.files > 0;

  const [choice, setChoice] = useState<Choice | null>(null);
  const defaultSelected =
    repo?.dirty === true && (worktree === undefined || hasChanges)
      ? WORKING_TREE
      : (commits[0]?.sha ?? null);
  const chosen = choice !== null && choice.key === selectionKey ? choice.id : defaultSelected;

  const routed = location.commit !== null;
  const paneSha = routed || !wide || chosen === WORKING_TREE ? null : chosen;
  const routeQuery = useQuery({
    queryKey: ["git", "commit", project, repo?.id, location.commit],
    queryFn: () => readGitCommit(base, project ?? "", repo?.id ?? "", location.commit ?? ""),
    enabled: routed && repo !== undefined,
    ...READS,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["git"] });
  const openCommit = (sha: string) =>
    onLocationChange({ repo: repo?.id ?? null, branch, commit: sha });
  const select = (id: string | null) => {
    if (id === WORKING_TREE || wide) setChoice({ key: selectionKey, id });
    else if (id !== null) openCommit(id);
  };

  if (project === null) return <PickProject />;
  if (reposQuery.isPending) return <GitLoading label="Reading the repositories…" rows={5} />;
  if (reposQuery.isError) {
    return (
      <GitReadError
        what="the repositories"
        error={reposQuery.error}
        onRetry={() => void reposQuery.refetch()}
      />
    );
  }
  if (repos === undefined) return <PickProject />;
  if (repo === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No repositories</EmptyTitle>
          <EmptyDescription>
            No git repository was found under this project's workspace folder.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (routed) {
    if (routeQuery.isPending) return <GitLoading label="Reading the commit…" rows={5} />;
    if (routeQuery.isError) {
      return (
        <GitReadError
          what="the commit"
          error={routeQuery.error}
          onRetry={() => void routeQuery.refetch()}
        />
      );
    }
    return (
      <GitCommitView
        detail={routeQuery.data}
        repoPath={repoName(repo)}
        branch={branch}
        timeZone={timeZone}
        onBack={() => onLocationChange({ repo: repo.id, branch, commit: null })}
      />
    );
  }

  const repoSelect = (
    <RepositorySelect
      aria-label="Repository"
      size="sm"
      repositories={repos.map(toRepository)}
      value={repo.id}
      onValueChange={(next) => {
        if (next !== null) onLocationChange({ repo: next, branch: null, commit: null });
      }}
      triggerProps={{
        className:
          "-ms-(--item-padding-x) w-auto border-transparent bg-transparent px-(--item-padding-x) font-medium shadow-none hover:bg-accent",
      }}
    />
  );

  const switcher =
    branch !== null && branchNames?.includes(branch) === true ? branchNames : undefined;

  const pane =
    chosen === WORKING_TREE ? (
      worktreeQuery.isError ? (
        <GitReadError
          what="the working tree"
          error={worktreeQuery.error}
          onRetry={() => void worktreeQuery.refetch()}
          className="min-w-0 flex-1"
        />
      ) : worktree !== undefined && hasChanges ? (
        <WorktreePane key={repo.id} repo={repo} worktree={worktree} fill={wide} />
      ) : (
        <GitLoading label="Reading the working tree…" rows={5} />
      )
    ) : paneSha !== null && project !== null ? (
      <SelectedCommit
        base={base}
        project={project}
        repo={repo.id}
        sha={paneSha}
        timeZone={timeZone}
        onOpenFull={() => openCommit(paneSha)}
      />
    ) : wide ? (
      <p className="flex flex-1 items-center justify-center rounded-surface border px-inset-item text-caption text-muted-foreground">
        No commit selected
      </p>
    ) : null;

  return (
    <div data-slot="nf-git-tab" className="flex min-w-0 flex-col gap-group">
      {logQuery.isSuccess ? (
        <CheckoutStatus repo={repo} branch={branch} commits={commits.length} />
      ) : null}
      {branchesQuery.isError ? (
        <GitReadError
          what="the branches"
          error={branchesQuery.error}
          onRetry={() => void branchesQuery.refetch()}
        />
      ) : null}
      <div className={cn("flex min-h-0 min-w-0 gap-group", wide ? "h-200" : "flex-col")}>
        {logQuery.isError ? (
          <div
            className={cn(
              "flex flex-col items-start gap-items",
              wide && "w-2/5 min-w-136 shrink-0",
            )}
          >
            {repoSelect}
            <GitReadError
              what="the history"
              error={logQuery.error}
              onRetry={() => void logQuery.refetch()}
            />
          </div>
        ) : logQuery.isPending ? (
          <GitLoading label="Reading the history…" rows={8} />
        ) : (
          <CommitHistory
            aria-label={`History of ${repoName(repo)}`}
            className={cn("min-h-0 flex-1", wide ? "w-2/5 min-w-136 shrink-0" : "max-h-160")}
            commits={history}
            count={total}
            branch={branch ?? undefined}
            branches={switcher}
            onBranchChange={
              switcher === undefined
                ? undefined
                : (next) => onLocationChange({ repo: repo.id, branch: next, commit: null })
            }
            headerStart={repoSelect}
            workingTree={
              counts !== null && hasChanges
                ? { staged: counts.staged, unstaged: counts.unstaged }
                : undefined
            }
            upstreamHead={upstreamHeadOf(commits, repo.upstream)}
            selected={chosen}
            onSelect={select}
            hasMore={logQuery.hasNextPage}
            loadingMore={logQuery.isFetchingNextPage}
            onLoadMore={() => void logQuery.fetchNextPage()}
            timeZone={timeZone}
            actions={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Read the repositories again"
                onClick={refresh}
              >
                <RefreshCwIcon />
              </Button>
            }
          />
        )}
        {wide ? pane : null}
      </div>
      {wide ? null : pane}
    </div>
  );
}

export { GitTab };
export type { GitTabLocation };
