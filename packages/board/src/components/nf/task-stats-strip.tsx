import type { ReactNode } from "react";

import { taskCost } from "@/lib/agent-task-board-model";
import type { TaskView } from "@/lib/agent-task-types";
import type { resolveLabels } from "@/components/ui/agent-task-labels";
import { AcceptancePopover } from "@/components/ui/acceptance-list";
import { TaskStatusIcon } from "@/components/ui/task-status";
import { UsageQuantity } from "@/components/ui/usage";

function Stat({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-inline">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
    </div>
  );
}

const tokenParts = (usage: TaskView["usage"]) =>
  usage === undefined
    ? [null]
    : [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens].map(
        (part) => part.value,
      );

const sumTokens = (task: TaskView) => {
  const usages = task.usage ? [task.usage] : task.attempts.map((attempt) => attempt.usage);
  const parts = usages.flatMap(tokenParts);
  return parts.length > 0 && parts.every((part) => part !== null)
    ? { value: parts.reduce((sum, part) => sum + part, 0), quality: "measured" as const }
    : { value: null, quality: "unknown" as const };
};

function TaskStatsStrip({
  task,
  labels,
}: {
  task: TaskView;
  labels: ReturnType<typeof resolveLabels>;
}) {
  const status = labels.components.taskStatus?.[task.status] ?? labels.columns[task.status];
  const counts = task.counts;
  return (
    <div className="flex flex-wrap items-center gap-x-section gap-y-items">
      <dl className="flex flex-wrap items-start gap-x-section gap-y-items">
        <Stat term="Status">
          <span className="inline-flex items-center gap-inline">
            <TaskStatusIcon status={task.status} />
            {status}
          </span>
        </Stat>
        <Stat term="Cost">
          <UsageQuantity
            value={taskCost(task)}
            kind="cost"
            locale="en"
            className="text-sm font-medium"
          />
        </Stat>
        <Stat term="Tokens">
          <UsageQuantity
            value={sumTokens(task)}
            kind="tokens"
            locale="en"
            className="text-sm font-medium"
          />
        </Stat>
        <Stat term="Attempts">{counts?.attempts ?? task.attempts.length}</Stat>
        <Stat term="Repairs">{counts?.repairs ?? "—"}</Stat>
        <Stat term="Reviews">{counts?.reviews ?? "—"}</Stat>
        <Stat term="People">{counts?.humanInterventions ?? "—"}</Stat>
        <Stat term="First pass">
          {task.acceptedFirstPass === undefined ? "—" : task.acceptedFirstPass ? "Yes" : "No"}
        </Stat>
      </dl>
      <AcceptancePopover criteria={task.acceptance} />
    </div>
  );
}

export { TaskStatsStrip };
