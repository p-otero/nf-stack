import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { GitWorktree } from "@nf/contracts";
import type { Writable } from "@/contract";
import { Button } from "@/components/ui/button";
import { CommitHistory, WORKING_TREE } from "@/components/ui/commit-history";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { RepositorySelect } from "@/components/ui/repository-select";
import {
  repoName,
  shortWorktreePath,
  toRepository,
  upstreamHeadOf,
  worktreeCounts,
  type GitTabLocation,
} from "@/components/nf/git/git-model";
import { readGitCommit } from "@/components/nf/git/git-client";
import { CheckoutStatus } from "@/components/nf/git/checkout-status";
import { CommitPane } from "@/components/nf/git/commit-pane";
import { GitCommitView } from "@/components/nf/git/git-commit-view";
import { GitLoading } from "@/components/nf/git/git-loading";
import { GitReadError } from "@/components/nf/git/git-read-error";
import { PickProject } from "@/components/nf/git/pick-project";
import { GIT_READS, useGitTabReads } from "@/components/nf/git/hooks/use-git-tab";
import { useWide } from "@/components/nf/git/hooks/use-wide";
import { WorktreePane } from "@/components/nf/git/worktree-pane";
import { WorktreeSelect } from "@/components/nf/git/worktree-select";
import { cn } from "@/lib/utils";

type Choice = { key: string; id: string | null };

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
    ...GIT_READS,
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

function WorktreeChangesPane({
  worktree,
  error,
  onRetry,
  fill,
}: {
  worktree: Writable<GitWorktree> | undefined;
  error: unknown;
  onRetry: () => void;
  fill: boolean;
}) {
  if (error !== null) {
    return (
      <GitReadError
        what="the working tree"
        error={error}
        onRetry={onRetry}
        className="min-w-0 flex-1"
      />
    );
  }
  if (worktree === undefined) return <GitLoading label="Reading the working tree…" rows={5} />;
  if (worktreeCounts(worktree).files === 0) {
    return (
      <p className="flex flex-1 items-center justify-center rounded-surface border px-inset-item text-caption text-muted-foreground">
        No uncommitted changes in {shortWorktreePath(worktree.path)}.
      </p>
    );
  }
  return <WorktreePane key={worktree.path} worktree={worktree} fill={fill} />;
}

function GitWorktreeSelect({
  worktrees,
  value,
  onPick,
}: {
  worktrees: Parameters<typeof WorktreeSelect>[0]["worktrees"];
  value: string;
  onPick: (path: string) => void;
}) {
  return (
    <WorktreeSelect
      worktrees={worktrees}
      size="sm"
      value={value}
      onValueChange={onPick}
      triggerProps={{
        className:
          "w-auto max-w-56 border-transparent bg-transparent px-(--item-padding-x) font-medium shadow-none hover:bg-accent",
      }}
    />
  );
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
  const reads = useGitTabReads(api, project, location);
  const { repo, list: repos } = reads.repos;
  const { branch, picked, path: worktreePath, ownCheckout } = reads.checkout;
  const { selectionKey, newest } = reads.history;

  const [choice, setChoice] = useState<Choice | null>(null);
  const chosen =
    choice !== null && choice.key === selectionKey
      ? choice.id
      : reads.changes.maybeDirty
        ? WORKING_TREE
        : newest;

  const routed = location.commit !== null;
  const paneSha = routed || !wide || chosen === WORKING_TREE ? null : chosen;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["git"] });
  const changeLocation = (next: Omit<GitTabLocation, "repo">) =>
    onLocationChange({ repo: repo?.id ?? null, ...next });
  const openCommit = (sha: string) =>
    changeLocation({ branch, commit: sha, worktree: worktreePath });
  const select = (id: string | null) => {
    if (id === WORKING_TREE || wide) setChoice({ key: selectionKey, id });
    else if (id !== null) openCommit(id);
  };

  if (project === null) return <PickProject />;
  if (reads.repos.query.isPending) {
    return <GitLoading label="Reading the repositories…" rows={5} />;
  }
  if (reads.repos.query.isError) {
    return (
      <GitReadError
        what="the repositories"
        error={reads.repos.query.error}
        onRetry={() => void reads.repos.query.refetch()}
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
    if (reads.commitQuery.isPending) return <GitLoading label="Reading the commit…" rows={5} />;
    if (reads.commitQuery.isError) {
      return (
        <GitReadError
          what="the commit"
          error={reads.commitQuery.error}
          onRetry={() => void reads.commitQuery.refetch()}
        />
      );
    }
    return (
      <GitCommitView
        detail={reads.commitQuery.data}
        repoPath={repoName(repo)}
        branch={branch}
        timeZone={timeZone}
        onBack={() => changeLocation({ branch, commit: null, worktree: worktreePath })}
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
        if (next !== null)
          onLocationChange({ repo: next, branch: null, commit: null, worktree: null });
      }}
      triggerProps={{
        className:
          "-ms-(--item-padding-x) w-auto border-transparent bg-transparent px-(--item-padding-x) font-medium shadow-none hover:bg-accent",
      }}
    />
  );

  const worktrees = reads.checkout.worktrees;
  const headerStart =
    picked === undefined || worktrees === undefined || worktrees.length < 2 ? (
      repoSelect
    ) : (
      <span className="flex min-w-0 items-center gap-inline">
        {repoSelect}
        <GitWorktreeSelect
          worktrees={worktrees}
          value={picked.path}
          onPick={(path) => {
            const entry = worktrees.find((candidate) => candidate.path === path);
            if (entry === undefined) return;
            changeLocation({
              branch: null,
              commit: null,
              worktree: entry.main ? null : entry.path,
            });
          }}
        />
      </span>
    );

  const switcher =
    branch !== null && reads.branches.names?.includes(branch) === true
      ? reads.branches.names
      : undefined;

  const pane =
    chosen === WORKING_TREE ? (
      <WorktreeChangesPane
        worktree={reads.changes.worktree}
        error={reads.changes.query.isError ? reads.changes.query.error : null}
        onRetry={() => void reads.changes.query.refetch()}
        fill={wide}
      />
    ) : paneSha !== null && project !== null ? (
      <SelectedCommit
        base={reads.base}
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

  const counts = reads.changes.counts;
  return (
    <div data-slot="nf-git-tab" className="flex min-w-0 flex-col gap-group">
      {reads.history.query.isSuccess && ownCheckout ? (
        <CheckoutStatus repo={repo} branch={branch} commits={reads.history.rows.length} />
      ) : null}
      {reads.checkout.query.isError ? (
        <GitReadError
          what="the worktrees"
          error={reads.checkout.query.error}
          onRetry={() => void reads.checkout.query.refetch()}
        />
      ) : null}
      {reads.branches.query.isError ? (
        <GitReadError
          what="the branches"
          error={reads.branches.query.error}
          onRetry={() => void reads.branches.query.refetch()}
        />
      ) : null}
      <div className={cn("flex min-h-0 min-w-0 gap-group", wide ? "h-200" : "flex-col")}>
        {reads.history.query.isError ? (
          <div
            className={cn(
              "flex flex-col items-start gap-items",
              wide && "w-2/5 min-w-136 shrink-0",
            )}
          >
            {repoSelect}
            <GitReadError
              what="the history"
              error={reads.history.query.error}
              onRetry={() => void reads.history.query.refetch()}
            />
          </div>
        ) : reads.history.query.isPending ? (
          <GitLoading label="Reading the history…" rows={8} />
        ) : (
          <CommitHistory
            aria-label={`History of ${repoName(repo)}`}
            className={cn("min-h-0 flex-1", wide ? "w-2/5 min-w-136 shrink-0" : "max-h-160")}
            commits={reads.history.rows}
            count={reads.history.total}
            branch={branch ?? undefined}
            branches={switcher}
            onBranchChange={
              switcher === undefined
                ? undefined
                : (next) => changeLocation({ branch: next, commit: null, worktree: worktreePath })
            }
            headerStart={headerStart}
            workingTree={
              counts !== null && counts.files > 0
                ? { staged: counts.staged, unstaged: counts.unstaged }
                : undefined
            }
            upstreamHead={upstreamHeadOf(reads.history.commits, repo.upstream)}
            selected={chosen}
            onSelect={select}
            hasMore={reads.history.query.hasNextPage}
            loadingMore={reads.history.query.isFetchingNextPage}
            onLoadMore={() => void reads.history.query.fetchNextPage()}
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
