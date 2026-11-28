import { PanelLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { diffFiles } from "@/components/nf/git/diff-files";
import { useNarrow } from "@/components/nf/git/hooks/use-narrow";
import type { Truncation } from "@/components/nf/git/patch-set";
import { TruncationNotice } from "@/components/nf/truncation-notice";
import {
  Collapsible,
  CollapsibleIcon,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { diffLabels } from "@/components/ui/diff-labels";
import { GitDiff, type GitDiffGroup } from "@/components/ui/git-diff";
import { GitDiffTree } from "@/components/ui/git-diff-tree";
import { cn } from "@/lib/utils";

type DiffTruncation = { what: string; truncation: Truncation | null };

type DiffPaneProps = {
  /** Names the diff for screen readers, like "Uncommitted changes". */
  label: string;
  /** A unified diff as git prints it, or `groups` for one tree section and one diff section each. */
  patch?: string;
  groups?: readonly GitDiffGroup[];
  /** What the git API cut, each named for the patch it belongs to ("The staged diff"). */
  truncations?: readonly DiffTruncation[];
  /** The pane's box: it fills the height its parent gives it, beside the file tree. */
  className?: string;
};

const NO_TRUNCATIONS: readonly DiffTruncation[] = [];

function DiffPane({
  label,
  patch,
  groups,
  truncations = NO_TRUNCATIONS,
  className,
}: DiffPaneProps) {
  const narrow = useNarrow();
  const tree = useMemo(() => (narrow ? diffFiles(patch, groups) : null), [narrow, patch, groups]);
  const [current, setCurrent] = useState<string | null>(null);
  const hasTree = tree !== null && (tree.files.length > 1 || tree.groups !== undefined);
  return (
    <div data-slot="diff-pane" className={cn("flex min-h-0 min-w-0 flex-col gap-items", className)}>
      {truncations.map((entry) => (
        <TruncationNotice key={entry.what} what={entry.what} truncation={entry.truncation} />
      ))}
      {tree === null || !hasTree ? null : (
        <div data-slot="diff-files" className="shrink-0 rounded-surface border bg-card">
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="w-full gap-inline px-inset-item">
              <PanelLeftIcon aria-hidden="true" className="shrink-0 text-muted-foreground" />
              {diffLabels.files}
              <span className="text-caption font-normal text-muted-foreground tabular-nums">
                {diffLabels.fileCount(tree.files.length)}
              </span>
              <CollapsibleIcon className="ms-auto" />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <GitDiffTree
                files={tree.files}
                groups={tree.groups}
                value={current}
                onOpen={setCurrent}
                labels={diffLabels}
                className="max-h-48"
              />
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
      <GitDiff
        aria-label={label}
        patch={patch}
        groups={groups}
        fileTree={narrow ? false : "collapsible"}
        currentFile={narrow ? current : undefined}
        onCurrentFileChange={narrow ? setCurrent : undefined}
        className="min-h-0 min-w-0 flex-1"
      />
    </div>
  );
}

export { DiffPane };
export type { DiffPaneProps, DiffTruncation };
