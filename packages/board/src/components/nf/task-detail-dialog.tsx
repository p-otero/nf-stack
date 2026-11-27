import { useState } from "react";

import type { TaskBranch } from "@nf/contracts";
import type { TaskView } from "@/lib/agent-task-types";
import { resolveLabels, type AgentTaskBoardLabelsInput } from "@/components/ui/agent-task-labels";
import { TaskDetailDialog, type TaskDetailDialogProps } from "@/components/ui/task-detail-dialog";
import { useNow } from "@/components/ui/use-now";
import { TaskChangesSection } from "@/components/nf/task-changes-section";
import { branchHistoryHref, projectOfTask } from "@/components/nf/task-git-data";
import { TaskGitLine } from "@/components/nf/task-git-line";
import { useBranchState, useChanges } from "@/components/nf/task-git-state";
import { TaskStatsStrip } from "@/components/nf/task-stats-strip";

const HIDDEN_SECTIONS = ["status", "cost", "attemptsSummary", "acceptance"] as const;

type NfTaskDetailDialogProps = Omit<TaskDetailDialogProps, "task" | "onClose" | "labels"> & {
  task: TaskView | undefined;
  live: boolean;
  onClose: () => void;
  labels?: AgentTaskBoardLabelsInput;
};

const openHistory = (branch: TaskBranch) => {
  window.location.assign(branchHistoryHref(window.location.href, branch));
};

function NfTaskDetailDialog({ task, live, onClose, ...props }: NfTaskDetailDialogProps) {
  const [shown, setShown] = useState(task);
  if (task !== undefined && task !== shown) setShown(task);
  const current = task ?? shown;
  const labels = resolveLabels(props.labels);
  const now = useNow({ now: props.now });
  const state = useBranchState(current, live);
  const changes = useChanges(current, state);
  const project = current === undefined ? "" : projectOfTask(current.id);
  return (
    <TaskDetailDialog
      task={task}
      onClose={onClose}
      {...props}
      labels={labels}
      now={now}
      hide={HIDDEN_SECTIONS}
      renderHeader={(shownTask) => (
        <>
          <TaskStatsStrip task={shownTask} labels={labels} />
          <TaskGitLine state={state} changes={changes} onOpenHistory={openHistory} />
        </>
      )}
      renderBeforeBody={() => (
        <TaskChangesSection state={state} changes={changes} project={project} now={now} />
      )}
    />
  );
}

export { NfTaskDetailDialog };
export type { NfTaskDetailDialogProps };
