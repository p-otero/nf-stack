import { useQuery } from "@tanstack/react-query";

import { ALL_CHANGES, WORKTREE } from "@/components/nf/task-change-list";
import { readCommitDetail, toPatchSet, type WorktreeChanges } from "@/components/nf/task-git-data";
import type { ChangesData, Failure } from "@/components/nf/task-git-state";
import { TruncationNotice } from "@/components/nf/truncation-notice";
import { Button } from "@/components/ui/button";
import { GitDiff, type GitDiffGroup } from "@/components/ui/git-diff";
import { Spinner } from "@/components/ui/spinner";

const DIFF_PROPS = { height: "auto", className: "min-w-0 flex-1" } as const;

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

function CommitPatch({ project, repo, sha }: { project: string; repo: string; sha: string }) {
  const query = useQuery({
    queryKey: ["task-commit", project, repo, sha],
    queryFn: () => readCommitDetail(project, repo, sha),
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
  const set = toPatchSet(query.data);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-items">
      <TruncationNotice what={`Commit ${sha.slice(0, 7)}`} truncation={set.truncation} />
      <GitDiff
        key={sha}
        aria-label={`Changes in ${sha.slice(0, 7)}`}
        patch={set.patch}
        {...DIFF_PROPS}
      />
    </div>
  );
}

function WorktreePatch({ changes }: { changes: WorktreeChanges }) {
  const groups: GitDiffGroup[] = [
    { label: "Staged", patch: changes.staged.patch },
    { label: "Unstaged", patch: changes.unstaged.patch },
  ].filter((group) => group.patch !== "");
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-items">
      <TruncationNotice what="The staged diff" truncation={changes.staged.truncation} />
      <TruncationNotice what="The unstaged diff" truncation={changes.unstaged.truncation} />
      {groups.length > 0 ? (
        <GitDiff key={WORKTREE} aria-label="Uncommitted changes" groups={groups} {...DIFF_PROPS} />
      ) : null}
      {changes.untracked.length > 0 ? (
        <section aria-label="Untracked files" className="flex flex-col gap-inline text-sm">
          <h4 className="text-xs text-muted-foreground">
            Untracked{changes.moreUntracked ? " (first files only)" : ""}
          </h4>
          <ul className="flex flex-col gap-inline font-mono text-xs">
            {changes.untracked.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TaskChangesDiff({
  project,
  repo,
  base,
  changes,
  selected,
}: {
  project: string;
  repo: string;
  base: string;
  changes: ChangesData;
  selected: string;
}) {
  if (selected === WORKTREE) {
    const worktree = changes.worktree;
    if (worktree.kind === "ready") return <WorktreePatch changes={worktree.changes} />;
    if (worktree.kind === "error")
      return <FailureNotice what="the uncommitted work" failure={worktree} />;
    return <Spinner label="Reading the uncommitted work" />;
  }
  if (selected !== ALL_CHANGES) return <CommitPatch project={project} repo={repo} sha={selected} />;
  if (changes.all !== undefined)
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-items">
        <TruncationNotice what={`The diff against ${base}`} truncation={changes.all.truncation} />
        <GitDiff
          aria-label={`All changes against ${base}`}
          patch={changes.all.patch}
          {...DIFF_PROPS}
        />
      </div>
    );
  if (changes.allError !== undefined)
    return <FailureNotice what="the diff" failure={changes.allError} />;
  if (changes.allLoading) return <Spinner label="Reading the changes" />;
  return <p className="text-sm text-muted-foreground">No diff against the base.</p>;
}

export { TaskChangesDiff };
