import { ArrowRightIcon, GitBranchIcon, HistoryIcon } from "lucide-react";

import type { TaskBranch } from "@nf/contracts";
import { BranchBadges } from "@/components/nf/branch-badges";
import { PatchTotals } from "@/components/nf/patch-totals";
import { stateText, type BranchState, type ChangesData } from "@/components/nf/task-git-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranchChip } from "@/components/ui/git-chip";
import { Spinner } from "@/components/ui/spinner";

const NO_WORKTREE = { kind: "none" } as const;

function BranchSummary({
  branch,
  changes,
}: {
  branch: TaskBranch;
  changes: ChangesData | undefined;
}) {
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-inline">
        <GitBranchChip name={branch.name} />
        {branch.base === null ? null : (
          <>
            <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-label="into" />
            <GitBranchChip name={branch.base} />
          </>
        )}
      </span>
      {branch.ahead === null && branch.behind === null ? null : (
        <span className="text-muted-foreground tabular-nums">
          {branch.ahead ?? 0} ahead · {branch.behind ?? 0} behind
        </span>
      )}
      {branch.upstream === null ? (
        <Badge tone="warning">Local only</Badge>
      ) : (
        <Badge tone="success">Pushed</Badge>
      )}
      {changes?.all ? <PatchTotals set={changes.all} /> : null}
      <BranchBadges unpushed={changes?.unpushed ?? 0} worktree={changes?.worktree ?? NO_WORKTREE} />
      <PullRequestLink branch={branch} />
    </>
  );
}

function PullRequestLink({ branch }: { branch: TaskBranch }) {
  const pr = branch.pullRequest;
  if (pr === null) return <span className="text-muted-foreground">No pull request</span>;
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto min-w-0 px-0 py-inline"
      render={<a href={pr.url} target="_blank" rel="noopener noreferrer" />}
    >
      Pull request{pr.number === null ? "" : ` #${pr.number}`}
    </Button>
  );
}

function TaskGitLine({
  state,
  changes,
  onOpenHistory,
}: {
  state: BranchState;
  changes: ChangesData | undefined;
  onOpenHistory: (branch: TaskBranch) => void;
}) {
  return (
    <div
      data-slot="task-git"
      className="flex min-h-control flex-wrap items-center gap-items text-sm"
    >
      {state.kind === "branch" ? (
        <BranchSummary branch={state.branch} changes={changes} />
      ) : (
        <span className="inline-flex min-w-0 items-center gap-inline text-muted-foreground">
          <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
          {stateText(state)}
        </span>
      )}
      <span className="ms-auto flex items-center gap-inline">
        {state.kind === "loading" ? <Spinner size="sm" label="Reading this task's branch" /> : null}
        {state.kind === "error" ? (
          <Button variant="outline" size="sm" onClick={state.retry}>
            Retry
          </Button>
        ) : null}
        {changes?.worktree.kind === "error" ? (
          <Button variant="outline" size="sm" onClick={changes.worktree.retry}>
            Retry uncommitted
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={state.kind !== "branch"}
          onClick={() => state.kind === "branch" && onOpenHistory(state.branch)}
        >
          <HistoryIcon />
          Branch history
        </Button>
      </span>
    </div>
  );
}

export { TaskGitLine };
