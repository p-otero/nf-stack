import type { WorktreeState } from "@/components/nf/task-git-state";
import { Badge } from "@/components/ui/badge";

const uncommittedText = (worktree: WorktreeState): string | null => {
  if (worktree.kind !== "ready" || worktree.changes.uncommitted === 0) return null;
  return `${worktree.changes.uncommitted}${worktree.changes.moreUntracked ? "+" : ""} uncommitted`;
};

function BranchBadges({ unpushed, worktree }: { unpushed: number; worktree: WorktreeState }) {
  const uncommitted = uncommittedText(worktree);
  return (
    <>
      {unpushed > 0 ? <Badge tone="warning">{unpushed} not pushed</Badge> : null}
      {uncommitted === null ? null : <Badge tone="warning">{uncommitted}</Badge>}
      {worktree.kind === "error" ? (
        <Badge tone="destructive">Couldn't read uncommitted work</Badge>
      ) : null}
    </>
  );
}

export { BranchBadges, uncommittedText };
