import { FolderGit2Icon } from "lucide-react";
import type { GitWorktreeEntry } from "@nf/contracts";
import type { Writable } from "@/contract";
import { Badge } from "@/components/ui/badge";
import { GitBranchChip } from "@/components/ui/git-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  type SelectSize,
  type SelectTriggerProps,
} from "@/components/ui/select";
import { shortWorktreePath, worktreeBranchLabel } from "@/components/nf/git/git-model";

const labelOf = (worktree: Pick<Writable<GitWorktreeEntry>, "path" | "branch" | "head">): string =>
  `${worktreeBranchLabel(worktree)} · ${shortWorktreePath(worktree.path)}`;

function WorktreeSelect({
  worktrees,
  value,
  onValueChange,
  size,
  triggerProps,
}: {
  worktrees: readonly Writable<GitWorktreeEntry>[];
  /** The chosen worktree's path. */
  value: string;
  onValueChange: (path: string) => void;
  size?: SelectSize;
  triggerProps?: Omit<SelectTriggerProps, "children">;
}) {
  const chosen = worktrees.find((worktree) => worktree.path === value) ?? worktrees[0];
  return (
    <Select
      aria-label="Worktree"
      size={size}
      items={worktrees.map((worktree) => ({ value: worktree.path, label: labelOf(worktree) }))}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectTrigger aria-label="Worktree" size={size} {...triggerProps}>
        {chosen === undefined ? null : (
          <span className="flex min-w-0 items-center gap-inline">
            <FolderGit2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{worktreeBranchLabel(chosen)}</span>
          </span>
        )}
      </SelectTrigger>
      <SelectContent className="min-w-96">
        {worktrees.map((worktree) => (
          <SelectItem
            key={worktree.path}
            value={worktree.path}
            label={labelOf(worktree)}
            disabled={worktree.prunable}
            className="items-start py-inset-item"
          >
            <span data-slot="worktree-option" className="flex min-w-0 flex-1 flex-col gap-inline">
              <span className="flex min-w-0 items-center gap-inline">
                {worktree.branch === null ? (
                  <span className="font-medium">{worktreeBranchLabel(worktree)}</span>
                ) : (
                  <GitBranchChip name={worktree.branch} />
                )}
                {worktree.main ? <Badge variant="secondary">main worktree</Badge> : null}
                {worktree.locked ? <Badge variant="outline">locked</Badge> : null}
                {worktree.prunable ? <Badge tone="warning">prunable</Badge> : null}
              </span>
              <span
                title={worktree.path}
                className="truncate font-mono text-caption text-muted-foreground"
              >
                {shortWorktreePath(worktree.path)}
              </span>
            </span>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { WorktreeSelect };
