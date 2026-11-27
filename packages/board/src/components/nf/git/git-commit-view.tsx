import { useMemo, useState } from "react";
import { ArrowLeftIcon, CopyIcon, GitCommitHorizontalIcon, ListIcon } from "lucide-react";
import type { GitCommitDetail } from "@nf/contracts";
import type { Writable } from "@/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranchChip } from "@/components/ui/git-chip";
import { createDiffViewController, GitDiff } from "@/components/ui/git-diff";
import { GitTree } from "@/components/ui/git-tree";
import { firstDiffPath, toTreeFiles } from "@/components/nf/git/git-model";
import { formatInstant } from "@/lib/time";

function GitCommitView({
  detail,
  repoPath,
  branch,
  timeZone,
  onBack,
}: {
  detail: Writable<GitCommitDetail>;
  repoPath: string;
  branch: string | null;
  timeZone?: string;
  onBack: () => void;
}) {
  const [controller] = useState(createDiffViewController);
  const [current, setCurrent] = useState<string | null>(null);
  const [unchanged, setUnchanged] = useState<string | null>(null);
  const { commit } = detail;
  const hash = commit.sha.slice(0, 7);
  const changed = new Set(detail.files.map((file) => file.path));
  const files = toTreeFiles(detail.tree, detail.files);
  const firstDiffFile = useMemo(() => firstDiffPath(detail.patch), [detail.patch]);
  return (
    <div className="flex flex-col gap-group">
      <div className="flex flex-wrap items-center gap-items">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeftIcon />
          History
        </Button>
        <nav
          aria-label="Location"
          className="flex min-w-0 items-center gap-inline text-sm text-muted-foreground"
        >
          <span>{repoPath}</span>
          {branch === null ? null : (
            <>
              <span aria-hidden="true">/</span>
              <GitBranchChip name={branch} />
            </>
          )}
          <span aria-hidden="true">/</span>
          <span className="font-mono text-foreground">{hash}</span>
        </nav>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{commit.subject}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-items">
            {commit.body.length > 0 ? (
              <p className="max-w-3xl text-sm whitespace-pre-line text-muted-foreground">
                {commit.body}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-group gap-y-inline text-sm">
              <span>
                <span className="font-medium">{commit.author}</span>{" "}
                <span className="text-muted-foreground">
                  committed {formatInstant(commit.date, { timeZone })}
                </span>
              </span>
              <span className="inline-flex items-center gap-inline">
                <GitCommitHorizontalIcon
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="font-mono">{hash}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy the full hash"
                  className="size-control-sm"
                  onClick={() => void navigator.clipboard?.writeText(commit.sha)}
                >
                  <CopyIcon />
                </Button>
              </span>
              <span className="text-muted-foreground">
                {commit.parents.length > 1
                  ? "Merge of "
                  : commit.parents.length === 0
                    ? "Root commit"
                    : "Parent "}
                {commit.parents.map((parent) => (
                  <span key={parent} className="font-mono text-foreground">
                    {parent.slice(0, 7)}
                  </span>
                ))}
              </span>
              {detail.truncated ? <Badge tone="warning">patch truncated</Badge> : null}
              {commit.refs
                .filter((ref) => ref.startsWith("tag: "))
                .map((ref) => (
                  <Badge key={ref}>{ref.slice(5)}</Badge>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex h-200 min-h-0 gap-group">
        <div className="flex w-72 shrink-0 flex-col gap-items">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            disabled={firstDiffFile === undefined}
            onClick={() => {
              setUnchanged(null);
              if (firstDiffFile !== undefined) controller.openFile(firstDiffFile);
            }}
          >
            <ListIcon />
            All changes
            <span className="ms-auto text-caption text-muted-foreground tabular-nums">
              {detail.files.length} files
            </span>
          </Button>
          <GitTree
            aria-label={`Files at ${hash}`}
            files={files}
            current={current}
            onOpenFile={(path) => {
              if (changed.has(path)) {
                setUnchanged(null);
                setCurrent(path);
              } else setUnchanged(path);
            }}
            className="min-h-0 flex-1"
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-items">
          {unchanged === null ? null : (
            <p className="flex items-center gap-inline text-sm text-muted-foreground">
              <span className="font-mono">{unchanged}</span> is unchanged in {hash}.
            </p>
          )}
          <GitDiff
            aria-label={`Changes in ${hash}`}
            patch={detail.patch}
            fileTree={false}
            controller={controller}
            currentFile={current}
            onCurrentFileChange={setCurrent}
            className="min-h-0 min-w-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}

export { GitCommitView };
