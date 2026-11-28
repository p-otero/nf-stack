import type { PatchSet } from "@/components/nf/git/patch-set";

function PatchTotals({ set }: { set: PatchSet }) {
  return (
    <span className="inline-flex items-center gap-inline tabular-nums">
      <span>{set.files} files</span>
      <span className="text-success">+{set.additions}</span>
      <span className="text-destructive">−{set.deletions}</span>
    </span>
  );
}

export { PatchTotals };
