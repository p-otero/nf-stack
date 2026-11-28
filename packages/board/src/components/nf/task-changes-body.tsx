import { useState } from "react";

import type { TaskBranch } from "@nf/contracts";
import {
  ALL_CHANGES,
  TaskChangeList,
  WORKTREE,
  showsWorktree,
} from "@/components/nf/task-change-list";
import { TaskChangesDiff } from "@/components/nf/task-changes-diff";
import type { ChangesData } from "@/components/nf/task-git-state";
import { Badge } from "@/components/ui/badge";

const selectable = (changes: ChangesData, id: string): boolean =>
  id === ALL_CHANGES ||
  (id === WORKTREE && showsWorktree(changes.worktree)) ||
  changes.commits.some((commit) => commit.sha === id);

function TaskChangesBody({
  branch,
  changes,
  project,
  now,
}: {
  branch: TaskBranch;
  changes: ChangesData;
  project: string;
  now: string | number | undefined;
}) {
  const [selected, setSelected] = useState(ALL_CHANGES);
  const shown = selectable(changes, selected) ? selected : ALL_CHANGES;
  const base = branch.base ?? branch.name;
  return (
    <div className="flex flex-col gap-items">
      {branch.commitsTruncated ? (
        <Badge tone="neutral">Only the newest commits are listed</Badge>
      ) : null}
      <div className="flex items-start gap-group narrow:flex-col narrow:items-stretch">
        <TaskChangeList
          base={base}
          changes={changes}
          value={shown}
          onChange={setSelected}
          now={now}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TaskChangesDiff project={project} branch={branch} changes={changes} selected={shown} />
        </div>
      </div>
    </div>
  );
}

export { TaskChangesBody };
