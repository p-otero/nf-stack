import { useCallback, useState } from "react";

import type { ReviewChannel } from "@/board-data";
import { reviewTask } from "@/board-data";
import type { TaskView } from "@/lib/agent-task-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CopyCommand } from "@/components/nf/copy-command";
import { RejectDialog } from "@/components/nf/reject-dialog";

/** What a live board needs to post a decision, and what it refetches once one is recorded. */
interface ReviewLive {
  readonly channel: ReviewChannel;
  readonly onDecided: () => void;
}

/** NF's `awaitingApproval`; the board's own view type predates the flag. */
const awaitsApproval = (task: TaskView): boolean =>
  "awaitingApproval" in task && task.awaitingApproval === true;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function ReviewCommands({ taskId }: { taskId: string }) {
  return (
    <div data-slot="nf-review-commands" className="flex min-w-0 flex-col gap-inline">
      <CopyCommand command={`nf task accept ${taskId} --approved-by-user`} />
      <CopyCommand command={`nf task reject ${taskId} --comment "<what to fix>"`} />
    </div>
  );
}

/**
 * A review task's verdict: Approve and Reject on a live board, the copyable CLI commands in a
 * snapshot, which writes nothing.
 */
function ReviewActions({
  taskId,
  live,
  className,
}: {
  taskId: string;
  live?: ReviewLive | undefined;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(() => {
    if (live === undefined) return;
    setPending(true);
    setError(null);
    void reviewTask(live.channel, taskId, "accept", null)
      .then(() => {
        setPending(false);
        live.onDecided();
      })
      .catch((failure: unknown) => {
        setPending(false);
        setError(messageOf(failure));
      });
  }, [live, taskId]);

  if (live === undefined) return <ReviewCommands taskId={taskId} />;
  return (
    <div
      data-slot="nf-review-actions"
      className={cn("flex min-w-0 flex-col gap-inline", className)}
    >
      <div className="flex flex-wrap items-center gap-inline">
        <Button size="sm" aria-label={`Approve ${taskId}`} loading={pending} onClick={approve}>
          Approve
        </Button>
        <RejectDialog taskId={taskId} live={live} />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { ReviewActions, awaitsApproval };
export type { ReviewLive };
