import { GitBranchIcon } from "lucide-react";

import { BranchBadges } from "@/components/nf/branch-badges";
import { PatchTotals } from "@/components/nf/patch-totals";
import { TaskChangesBody } from "@/components/nf/task-changes-body";
import { stateText, type BranchState, type ChangesData } from "@/components/nf/task-git-state";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleIcon,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";

function EmptyChanges() {
  return (
    <div className="flex flex-col items-center justify-center gap-items rounded-surface border border-dashed p-section text-center">
      <GitBranchIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">No changes to show</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This task has no branch. When an attempt creates one, its commits, uncommitted work and diff
        against the base show here.
      </p>
    </div>
  );
}

function ChangesSummary({ changes }: { changes: ChangesData }) {
  return (
    <span className="flex flex-wrap items-center gap-inline text-sm text-muted-foreground tabular-nums">
      {changes.all ? <PatchTotals set={changes.all} /> : null}
      <BranchBadges unpushed={changes.unpushed} worktree={changes.worktree} />
      {changes.all ? null : changes.allLoading ? (
        <Spinner size="sm" label="Reading the changes" />
      ) : changes.allError ? (
        <span className="text-destructive">Couldn't read the diff</span>
      ) : null}
    </span>
  );
}

function ChangesPanel({
  state,
  changes,
  project,
  now,
}: {
  state: BranchState;
  changes: ChangesData | undefined;
  project: string;
  now: string | number | undefined;
}) {
  if (state.kind === "branch" && changes !== undefined)
    return <TaskChangesBody branch={state.branch} changes={changes} project={project} now={now} />;
  if (state.kind === "error")
    return (
      <div className="flex flex-col items-start gap-inline">
        <p className="text-sm text-destructive">Couldn't read git: {state.message}</p>
        <Button variant="outline" size="sm" onClick={state.retry}>
          Retry
        </Button>
      </div>
    );
  if (state.kind === "loading") return <Spinner label="Reading this task's branch" />;
  return <EmptyChanges />;
}

function TaskChangesSection({
  state,
  changes,
  project,
  now,
}: {
  state: BranchState;
  changes: ChangesData | undefined;
  project: string;
  now: string | number | undefined;
}) {
  return (
    <Collapsible className="flex flex-col gap-items rounded-surface border bg-card/(--glass-opacity) px-inset-item py-inset-item">
      <CollapsibleTrigger className="flex w-full items-center gap-items text-start">
        <span className="shrink-0 text-sm font-medium">Changes</span>
        {state.kind !== "branch" ? (
          <span className="text-sm text-muted-foreground">{stateText(state)}</span>
        ) : changes === undefined ? null : (
          <ChangesSummary changes={changes} />
        )}
        <CollapsibleIcon className="ms-auto" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="pt-items">
          <ChangesPanel state={state} changes={changes} project={project} now={now} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export { TaskChangesSection };
