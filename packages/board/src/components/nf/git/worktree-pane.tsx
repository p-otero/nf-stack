import { useState } from "react";
import type { GitRepo, GitWorktree } from "@nf/contracts";
import type { Writable } from "@/contract";
import { GitBranchChip } from "@/components/ui/git-chip";
import { GitDiff } from "@/components/ui/git-diff";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import { repoName, worktreeCounts } from "@/components/nf/git/git-model";

type WorktreeGroup = "staged" | "unstaged" | "untracked";

function UntrackedFiles({ worktree }: { worktree: Writable<GitWorktree> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-items rounded-surface border bg-card px-inset-item py-inset-item">
      <p className="text-caption text-muted-foreground">
        Untracked files have no diff until they are added.
        {worktree.untrackedTruncated ? " The list stops at the API's limit." : ""}
      </p>
      <ul aria-label="Untracked files" className="flex min-h-0 flex-col gap-inline overflow-auto">
        {worktree.untracked.map((path) => (
          <li key={path} className="font-mono text-sm">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorktreePane({
  repo,
  worktree,
  fill,
}: {
  repo: Writable<GitRepo>;
  worktree: Writable<GitWorktree>;
  fill?: boolean;
}) {
  const counts = worktreeCounts(worktree);
  const sizes: Record<WorktreeGroup, number> = {
    staged: worktree.staged.files.length,
    unstaged: worktree.unstaged.files.length,
    untracked: counts.untracked,
  };
  const [group, setGroup] = useState<WorktreeGroup>(
    sizes.staged > 0 ? "staged" : sizes.unstaged > 0 ? "unstaged" : "untracked",
  );
  return (
    <section
      aria-label="Uncommitted changes"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-items"
    >
      <header className="flex flex-row flex-wrap items-center gap-inline rounded-surface border bg-card px-inset-item py-inset-item">
        <span className="flex min-w-0 flex-1 flex-col gap-inline">
          <span className="text-body font-medium">Uncommitted changes</span>
          <span className="flex flex-wrap items-center gap-inline text-caption text-muted-foreground">
            {counts.files} file{counts.files === 1 ? "" : "s"} on{" "}
            {repo.branch === null ? (
              <span>detached HEAD</span>
            ) : (
              <GitBranchChip name={repo.branch} />
            )}{" "}
            in <span className="font-mono">{repoName(repo)}</span> · read-only
            {worktree.head === null ? null : (
              <>
                {" · at "}
                <span className="font-mono">{worktree.head.slice(0, 7)}</span>
              </>
            )}
          </span>
        </span>
        <SegmentedControl<WorktreeGroup>
          aria-label="Which changes"
          value={group}
          onValueChange={(next) => {
            if (next) setGroup(next);
          }}
        >
          <SegmentedControlIndicator />
          <SegmentedControlItem value="staged">Staged · {sizes.staged}</SegmentedControlItem>
          <SegmentedControlItem value="unstaged">Unstaged · {sizes.unstaged}</SegmentedControlItem>
          {sizes.untracked > 0 ? (
            <SegmentedControlItem value="untracked">
              Untracked · {sizes.untracked}
            </SegmentedControlItem>
          ) : null}
        </SegmentedControl>
      </header>
      {group === "untracked" ? (
        <UntrackedFiles worktree={worktree} />
      ) : (
        <GitDiff
          key={group}
          aria-label={group === "staged" ? "Staged changes" : "Unstaged changes"}
          patch={worktree[group].patch}
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
