import { CopyIcon, Maximize2Icon } from "lucide-react";
import type { GitCommitDetail } from "@nf/contracts";
import { DiffPane } from "@/components/nf/git/diff-pane";
import { toPatchSet } from "@/components/nf/git/patch-set";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

const copyHash = (sha: string): void => {
  void navigator.clipboard?.writeText(sha);
};

function CommitPane({
  detail,
  timeZone,
  onOpenFull,
  className,
}: {
  detail: GitCommitDetail;
  timeZone?: string;
  onOpenFull?: () => void;
  /** The pane's box: it fills the height its parent gives it. */
  className?: string;
}) {
  const { commit } = detail;
  const hash = commit.sha.slice(0, 7);
  const parents =
    commit.parents.length > 1
      ? "Merge of "
      : commit.parents.length === 0
        ? "Root commit"
        : "Parent ";
  return (
    <section
      aria-label={`Commit ${hash}`}
      className={cn("flex min-h-0 min-w-0 flex-col gap-items", className)}
    >
      <header className="flex flex-col gap-inline rounded-surface border bg-card px-inset-item py-inset-item">
        <div className="flex items-start gap-items">
          <h2 className="min-w-0 flex-1 text-body font-medium">{commit.subject}</h2>
          {onOpenFull ? (
            <Button variant="ghost" size="sm" onClick={onOpenFull}>
              <Maximize2Icon />
              Full view
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-group gap-y-inline text-caption text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{commit.author}</span>{" "}
            <RelativeTime value={commit.date} timeZone={timeZone} />
          </span>
          <span className="inline-flex items-center gap-inline">
            <span className="font-mono text-foreground">{hash}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy the full hash"
              className="size-control-sm"
              onClick={() => copyHash(commit.sha)}
            >
              <CopyIcon />
            </Button>
          </span>
          <span>
            {parents}
            {commit.parents.map((parent, index) => (
              <span key={parent} className="font-mono text-foreground">
                {index > 0 ? " + " : ""}
                {parent.slice(0, 7)}
              </span>
            ))}
          </span>
          {commit.refs
            .filter((ref) => ref.startsWith("tag: "))
            .map((ref) => (
              <Badge key={ref}>{ref.slice(5)}</Badge>
            ))}
        </div>
      </header>
      <DiffPane
        key={commit.sha}
        label={`Changes in ${hash}`}
        patch={detail.patch}
        truncations={[{ what: `Commit ${hash}`, truncation: toPatchSet(detail).truncation }]}
        className="min-h-0 flex-1"
      />
    </section>
  );
}

export { CommitPane };
