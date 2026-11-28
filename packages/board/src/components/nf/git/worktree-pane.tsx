import type { GitWorktree } from "@nf/contracts";
import { DiffPane } from "@/components/nf/git/diff-pane";
import { shortWorktreePath, worktreeCounts } from "@/components/nf/git/git-model";
import { truncationOf } from "@/components/nf/git/patch-set";
import { GitBranchChip } from "@/components/ui/git-chip";
import type { GitDiffGroup } from "@/components/ui/git-diff";
import { cn } from "@/lib/utils";

const worktreeGroups = (worktree: GitWorktree): GitDiffGroup[] =>
  [
    { label: "Staged", patch: worktree.staged.patch },
    { label: "Unstaged", patch: worktree.unstaged.patch },
    { label: "Untracked", patch: worktree.untracked.patch },
  ].filter((group) => group.patch !== "");

const worktreeTruncations = (worktree: GitWorktree) => [
  { what: "The staged diff", truncation: truncationOf(worktree.staged) },
  { what: "The unstaged diff", truncation: truncationOf(worktree.unstaged) },
  { what: "The untracked diff", truncation: truncationOf(worktree.untracked) },
];

function WorktreePane({
  worktree,
  className,
}: {
  worktree: GitWorktree;
  /** The pane's box: it fills the height its parent gives it. */
  className?: string;
}) {
  const counts = worktreeCounts(worktree);
  const groups = worktreeGroups(worktree);
  return (
    <section
      aria-label="Uncommitted changes"
      className={cn("flex min-h-0 min-w-0 flex-col gap-items", className)}
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
        </div>
      </header>
      {groups.length === 0 ? (
        <p className="flex flex-1 items-center justify-center rounded-surface border px-inset-item text-caption text-muted-foreground">
          Git returned no patch for these changes.
        </p>
      ) : (
        <DiffPane
          key={worktree.path}
          label="Uncommitted changes"
          groups={groups}
          truncations={worktreeTruncations(worktree)}
          className="min-h-0 flex-1"
        />
      )}
    </section>
  );
}

export { WorktreePane };
