import type { TaskView } from "@/lib/agent-task-types";
import { agentTaskBoardLabels } from "@/lib/agent-task-board-labels";
import { AttachmentStrip } from "@/components/ui/attachments";
import { ReviewActions, awaitsApproval, type ReviewLive } from "@/components/nf/review-actions";

/** NF's `uiChange`; the board's own view type predates the field. */
const uiChangeOf = (task: TaskView): string | null =>
  "uiChange" in task && typeof task.uiChange === "string" ? task.uiChange : null;

/**
 * The detail's evidence block: the size of a UI change, the attachments the review is about, and
 * the verdict under them once the task waits for a person's approval.
 */
function TaskEvidence({ task, live }: { task: TaskView; live?: ReviewLive | undefined }) {
  const attachments = task.attachments ?? [];
  const uiChange = uiChangeOf(task);
  const review = awaitsApproval(task) ? <ReviewActions taskId={task.id} live={live} /> : null;
  const strip =
    attachments.length === 0 ? null : (
      <AttachmentStrip
        attachments={attachments}
        aria-label={agentTaskBoardLabels.panel.attachmentsOf(task.id)}
        labels={agentTaskBoardLabels.components.attachments}
      />
    );
  if (review === null && strip === null && uiChange === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-inline">
      {uiChange === null ? null : (
        <p data-slot="nf-ui-change" className="text-sm text-muted-foreground">
          UI change: {uiChange}
        </p>
      )}
      {strip}
      {review}
    </div>
  );
}

export { TaskEvidence };
