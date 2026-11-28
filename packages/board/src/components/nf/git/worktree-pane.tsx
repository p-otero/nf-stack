import type { GitWorktree } from "@nf/contracts";
import type { Writable } from "@/contract";
import { Badge } from "@/components/ui/badge";
import { GitBranchChip } from "@/components/ui/git-chip";
import { GitDiff, type GitDiffGroup } from "@/components/ui/git-diff";
import { shortWorktreePath, worktreeCounts } from "@/components/nf/git/git-model";

function WorktreePane({ worktree, fill }: { worktree: Writable<GitWorktree>; fill?: boolean }) {
  const counts = worktreeCounts(worktree);
  const groups: GitDiffGroup[] = [
    { label: "Staged", patch: worktree.staged.patch },
    { label: "Unstaged", patch: worktree.unstaged.patch },
    { label: "Untracked", patch: worktree.untracked.patch },
  ].filter((group) => group.patch !== "");
  const truncated =
    worktree.staged.truncated || worktree.unstaged.truncated || worktree.untracked.truncated;
  return (
    <section
      aria-label="Uncommitted changes"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-items"
    >
      <header className="flex flex-col gap-inline rounded-surface border bg-card px-inset-item py-inset-item">
        <div className="flex items-start gap-items">
          <span className="flex min-w-0 flex-1 flex-col gap-inline">
            <span className="text-body font-medium">Uncommitted changes</span>
            <span className="flex flex-wrap items-center gap-inline text-caption text-muted-foreground">
              {counts.files} file{counts.files === 1 ? "" : "s"} on{" "}
              {worktree.branch === null ? (
                <span>detached HEAD</span>
              ) : (
                <GitBranchChip name={worktree.branch} />
              )}{" "}
              in <span className="font-mono">{shortWorktreePath(worktree.path)}</span> · read-only
              {worktree.head === null ? null : (
                <>
                  {" · at "}
                  <span className="font-mono">{worktree.head.slice(0, 7)}</span>
                </>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-inline text-caption text-muted-foreground tabular-nums">
              <span>{worktree.staged.files.length} staged</span>
              <span aria-hidden="true">·</span>
              <span>{worktree.unstaged.files.length} unstaged</span>
              <span aria-hidden="true">·</span>
              <span>{worktree.untracked.files.length} untracked</span>
              {worktree.untrackedTruncated ? (
                <span>· the untracked list stops at the API's limit</span>
              ) : null}
            </span>
          </span>
          {truncated ? <Badge tone="warning">patch truncated</Badge> : null}
        </div>
      </header>
      {groups.length === 0 ? (
        <p className="flex flex-1 items-center justify-center rounded-surface border px-inset-item text-caption text-muted-foreground">
          Git returned no patch for these changes.
        </p>
      ) : (
        <GitDiff
          key={worktree.path}
          aria-label="Uncommitted changes"
          groups={groups}
          fileTree="collapsible"
          height={fill === false ? "auto" : undefined}
          /*
           * Stacked under the history there is no bounded pane to fill, so `auto` grows the diff in
           * the page; the same 40rem cap the diff's file tree uses keeps the page its own size and
           * the diff scrolling inside it.
           */
          className={fill === false ? "[--diff-max-height:40rem]" : "min-h-0 flex-1"}
        />
      )}
    </section>
  );
}

export { WorktreePane };
