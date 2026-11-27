import { CircleCheckIcon } from "lucide-react";
import type { GitRepo } from "@nf/contracts";
import type { Writable } from "@/contract";
import { GitBranchChip } from "@/components/ui/git-chip";

const upstreamText = (repo: Writable<GitRepo>): string => {
  if (repo.upstream === null) return repo.remote === null ? "no remote" : "no upstream";
  const { ahead, behind } = repo;
  if (ahead === 0 && behind === 0) return `up to date with ${repo.upstream}`;
  const drift = [
    ahead !== null && ahead > 0 ? `${String(ahead)} ahead` : null,
    behind !== null && behind > 0 ? `${String(behind)} behind` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return drift.length > 0 ? `${drift} of ${repo.upstream}` : repo.upstream;
};

function CheckoutStatus({
  repo,
  branch,
  commits,
}: {
  repo: Writable<GitRepo>;
  branch: string | null;
  commits: number;
}) {
  if (commits === 0) {
    return (
      <p className="flex items-center gap-inline px-inset-item text-caption text-muted-foreground">
        {branch === null ? "No commit yet" : `No commit on ${branch} yet`}
        {repo.dirty ? " · the working tree has uncommitted changes" : ""}
      </p>
    );
  }
  if (repo.dirty) return null;
  return (
    <p className="flex items-center gap-inline px-inset-item text-caption text-muted-foreground">
      <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
      Working tree clean on{" "}
      {repo.branch === null ? (
        <span>detached HEAD</span>
      ) : (
        <GitBranchChip name={repo.branch} />
      )} · {upstreamText(repo)}
    </p>
  );
}

export { CheckoutStatus };
