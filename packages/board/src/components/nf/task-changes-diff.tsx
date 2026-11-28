import { useQuery } from "@tanstack/react-query";

import type { TaskBranch } from "@nf/contracts";
import { CommitPane } from "@/components/nf/git/commit-pane";
import { DiffPane } from "@/components/nf/git/diff-pane";
import { WorktreePane } from "@/components/nf/git/worktree-pane";
import { ALL_CHANGES, WORKTREE } from "@/components/nf/task-change-list";
import { commitViewHref, readCommitDetail } from "@/components/nf/task-git-data";
import type { ChangesData, Failure } from "@/components/nf/task-git-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const PANE = "h-160 narrow:h-120";

const openFullView = (branch: TaskBranch, sha: string): void => {
  window.location.assign(commitViewHref(window.location.href, branch, sha));
};

function FailureNotice({ what, failure }: { what: string; failure: Failure }) {
  return (
    <div role="alert" className="flex min-w-0 flex-1 flex-col items-start gap-inline">
      <p className="text-sm text-destructive">
        Couldn't read {what}: {failure.message}
      </p>
      <Button variant="outline" size="sm" onClick={failure.retry}>
        Retry
      </Button>
    </div>
  );
}

function CommitPatch({
  project,
  branch,
  sha,
}: {
  project: string;
  branch: TaskBranch;
  sha: string;
}) {
  const query = useQuery({
    queryKey: ["task-commit", project, branch.repo, sha],
    queryFn: () => readCommitDetail(project, branch.repo, sha),
    staleTime: Infinity,
  });
  if (query.isPending) return <Spinner label={`Reading commit ${sha.slice(0, 7)}`} />;
  if (query.isError)
    return (
      <FailureNotice
        what="the commit"
        failure={{ message: query.error.message, retry: () => void query.refetch() }}
      />
    );
  return (
    <CommitPane detail={query.data} className={PANE} onOpenFull={() => openFullView(branch, sha)} />
  );
}

function TaskChangesDiff({
  project,
  branch,
  changes,
  selected,
}: {
  project: string;
  branch: TaskBranch;
  changes: ChangesData;
  selected: string;
}) {
  const base = branch.base ?? branch.name;
  if (selected === WORKTREE) {
    const worktree = changes.worktree;
    if (worktree.kind === "ready")
      return <WorktreePane worktree={worktree.worktree} className={PANE} />;
    if (worktree.kind === "error")
      return <FailureNotice what="the uncommitted work" failure={worktree} />;
    return <Spinner label="Reading the uncommitted work" />;
  }
  if (selected !== ALL_CHANGES)
    return <CommitPatch project={project} branch={branch} sha={selected} />;
  if (changes.all !== undefined)
    return (
      <DiffPane
        label={`All changes against ${base}`}
        patch={changes.all.patch}
        truncations={[{ what: `The diff against ${base}`, truncation: changes.all.truncation }]}
        className={PANE}
      />
    );
  if (changes.allError !== undefined)
    return <FailureNotice what="the diff" failure={changes.allError} />;
  if (changes.allLoading) return <Spinner label="Reading the changes" />;
  return <p className="text-sm text-muted-foreground">No diff against the base.</p>;
}

export { TaskChangesDiff };
