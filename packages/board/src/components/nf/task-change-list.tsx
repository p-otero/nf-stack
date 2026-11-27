import { CircleDotIcon, GitCommitHorizontalIcon, LayersIcon } from "lucide-react";

import type { GitBranchCommit } from "@nf/contracts";
import type { ChangesData, WorktreeState } from "@/components/nf/task-git-state";
import { Badge } from "@/components/ui/badge";
import { List, ListGroup, ListItem } from "@/components/ui/list-item";
import { RelativeTime } from "@/components/ui/relative-time";

const ALL_CHANGES = "all";
const WORKTREE = "worktree";

function AllChangesItem({ base, changes }: { base: string; changes: ChangesData }) {
  const all = changes.all;
  return (
    <ListItem
      id={ALL_CHANGES}
      title={`All changes vs ${base}`}
      leading={<LayersIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
      subtitle={
        all !== undefined
          ? `${all.files} files`
          : changes.allError !== undefined
            ? "Couldn't read the diff"
            : "Reading…"
      }
      trailing={
        all === undefined ? null : (
          <span className="text-caption tabular-nums">
            <span className="text-success">+{all.additions}</span>{" "}
            <span className="text-destructive">−{all.deletions}</span>
          </span>
        )
      }
    />
  );
}

function WorktreeMeta({ worktree }: { worktree: WorktreeState }) {
  if (worktree.kind === "error") return <Badge tone="destructive">Couldn't read</Badge>;
  if (worktree.kind !== "ready") return null;
  const { staged, unstaged, untracked } = worktree.changes;
  return (
    <span className="flex flex-wrap items-center gap-inline">
      {staged.files > 0 ? <Badge tone="success">{staged.files} staged</Badge> : null}
      {unstaged.files > 0 ? <Badge tone="warning">{unstaged.files} unstaged</Badge> : null}
      {untracked.length > 0 ? <Badge tone="neutral">{untracked.length} untracked</Badge> : null}
    </span>
  );
}

const worktreeSubtitle = (worktree: WorktreeState): string =>
  worktree.kind === "ready"
    ? `${worktree.changes.uncommitted}${worktree.changes.moreUntracked ? "+" : ""} files`
    : worktree.kind === "error"
      ? worktree.message
      : "Reading…";

const showsWorktree = (worktree: WorktreeState): boolean =>
  worktree.kind === "loading" ||
  worktree.kind === "error" ||
  (worktree.kind === "ready" && worktree.changes.uncommitted > 0);

function CommitItem({
  commit,
  now,
}: {
  commit: GitBranchCommit;
  now: string | number | undefined;
}) {
  return (
    <ListItem
      id={commit.sha}
      title={commit.subject}
      leading={
        <GitCommitHorizontalIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      }
      subtitle={
        <span className="flex items-center gap-inline">
          <span className="font-mono">{commit.sha.slice(0, 7)}</span>
          <RelativeTime value={commit.date} now={now} locale="en" formatStyle="short" />
        </span>
      }
      meta={commit.pushed ? null : <Badge tone="warning">not pushed</Badge>}
    />
  );
}

function TaskChangeList({
  base,
  changes,
  value,
  onChange,
  now,
}: {
  base: string;
  changes: ChangesData;
  value: string;
  onChange: (id: string) => void;
  now: string | number | undefined;
}) {
  return (
    <List
      aria-label="Changes"
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      className="w-80 shrink-0 narrow:w-full"
    >
      <AllChangesItem base={base} changes={changes} />
      {showsWorktree(changes.worktree) ? (
        <ListItem
          id={WORKTREE}
          title="Uncommitted in worktree"
          leading={<CircleDotIcon className="size-4 text-warning" aria-hidden="true" />}
          subtitle={worktreeSubtitle(changes.worktree)}
          meta={<WorktreeMeta worktree={changes.worktree} />}
        />
      ) : null}
      <ListGroup label="Commits" count={changes.commits.length}>
        {changes.commits.map((commit) => (
          <CommitItem key={commit.sha} commit={commit} now={now} />
        ))}
      </ListGroup>
    </List>
  );
}

export { ALL_CHANGES, TaskChangeList, WORKTREE, showsWorktree };
