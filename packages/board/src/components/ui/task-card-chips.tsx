"use client"

import type { ComponentProps } from "react"
import { PaperclipIcon } from "lucide-react"

import { activeAttempt, needsDecision, taskCost } from "@/lib/agent-task-board-model"
import type { TaskView } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { AcceptanceBar, countAcceptance } from "@/components/ui/acceptance-list"
import { colorIndex } from "@/components/ui/agent-avatar"
import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { DependencyChips } from "@/components/ui/dependency-chips"
import { livenessLabels, livenessTones } from "@/components/ui/liveness-indicator"
import { QuantityValue } from "@/components/ui/quantity-value"
import { StagePill } from "@/components/ui/stage-track"
import { StatusPing, type StatusTone } from "@/components/ui/status-pill"
import { AnalysisModeIcon, TaskBlocker } from "@/components/ui/task-card-parts"
import type { TaskDisplayOptions } from "@/components/ui/task-card"
import { stageOf } from "@/components/ui/task-location"
import { taskStatusTones } from "@/components/ui/task-status"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usageFormatter } from "@/components/ui/usage"

const chipClassName =
  "relative z-10 inline-flex h-5 max-w-full min-w-0 items-center gap-inline rounded-md border px-inset-chip text-xs whitespace-nowrap text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0"

const toneText: Record<StatusTone, string> = {
  neutral: "text-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  violet: "text-violet",
  muted: "text-muted-foreground",
}

const labelDots = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const

function Chip({ className, children, ...props }: ComponentProps<"span">) {
  return (
    <span data-slot="task-card-chip" className={cn(chipClassName, className)} {...props}>
      {children}
    </span>
  )
}

type TaskCardChipsProps = Pick<
  TaskDisplayOptions,
  "now" | "locale" | "timeZone" | "formatCurrency" | "onSelectTask" | "canSelect" | "stages"
> & {
  task: TaskView
  labels: AgentTaskBoardLabels
}

function TaskCardChips({
  task,
  labels,
  now,
  locale,
  timeZone,
  formatCurrency,
  onSelectTask,
  canSelect,
  stages,
}: TaskCardChipsProps) {
  const text = labels.card
  const parts = labels.components
  const attempt = activeAttempt(task)
  const liveness = attempt?.liveness !== "finished" ? attempt?.liveness : undefined
  // Running and idle are routine: a dot is enough. Waiting and stuck need a person, so they say so.
  const livenessShown = liveness === "waiting_input" || liveness === "suspect_dead"
  const livenessName = liveness && (parts.liveness?.[liveness] ?? livenessLabels[liveness])
  const livenessEvidence = livenessShown ? attempt?.livenessEvidence : undefined
  const livenessClassName = liveness
    ? cn("inline-flex min-w-0 items-center gap-inline", toneText[livenessTones[liveness]])
    : undefined
  const livenessMark = liveness && (
    <>
      <span aria-hidden="true" className="relative inline-flex size-1.5 shrink-0">
        <StatusPing pulse={liveness === "running"} restartKey={liveness} />
        <span className="relative size-full rounded-full bg-current" />
      </span>
      <span className={livenessShown ? "truncate" : "sr-only"}>{livenessName}</span>
    </>
  )
  const counts = countAcceptance(task.acceptance)
  const pressable = onSelectTask && task.dependsOn.some((dependency) => canSelect?.(dependency.id) ?? true)
  const attachments = task.attachments?.length ?? 0

  return (
    <div data-slot="task-card-chips" className="flex min-w-0 flex-wrap items-center gap-items">
      {task.location && (
        <StagePill
          stage={stageOf(stages, task.location.stage)}
          href={task.location.href}
          className="relative z-10 max-w-full"
        />
      )}
      {(liveness || task.analysisMode) && (
        <Chip data-slot="task-card-signals">
          {liveness &&
            (livenessEvidence ? (
              <Tooltip type="description">
                <TooltipTrigger
                  render={(part) => <button type="button" {...part} data-slot="task-card-liveness" />}
                  aria-label={livenessName}
                  className="inline-flex min-w-0 cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={livenessClassName}>{livenessMark}</span>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="block font-medium">{livenessName}</span>
                  <span className="block">{livenessEvidence}</span>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span data-slot="task-card-liveness" title={livenessName} className={livenessClassName}>
                {livenessMark}
              </span>
            ))}
          {task.analysisMode && (
            <AnalysisModeIcon mode={task.analysisMode} label={text.analysisMode[task.analysisMode]} />
          )}
        </Chip>
      )}
      {task.profile && <Chip className="text-foreground">{task.profile}</Chip>}
      {task.labels?.map((label) => (
        <Chip key={label} className="text-foreground">
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", labelDots[colorIndex(label, labelDots.length)])}
          />
          <span className="truncate">{label}</span>
        </Chip>
      ))}
      <DependencyChips
        aria-label={text.dependencies(task.id)}
        items={task.dependsOn.map((dependency) => ({
          id: dependency.id,
          label: `${dependency.id} ${dependency.title ?? ""}`.trim(),
          tone: taskStatusTones[dependency.status],
        }))}
        max={1}
        onSelect={pressable ? (id) => (canSelect?.(id) ?? true) && onSelectTask(id) : undefined}
        className="relative z-10 min-w-0"
      />
      {needsDecision(task) && (
        <Chip title={task.decisionNeeded} className="border-warning/40 text-warning">
          {text.decisionNeeded}
        </Chip>
      )}
      {attempt?.blocker && (
        <TaskBlocker blocker={attempt.blocker} retryLabel={text.retry} now={now} locale={locale} timeZone={timeZone} />
      )}
      {(task.attempts.length > 0 || task.usage) && (
        <Chip>
          <span className="sr-only">{text.cost} </span>
          <QuantityValue
            value={taskCost(task)}
            format={usageFormatter("cost", { locale, formatCurrency })}
            labels={parts.usage?.quantity}
            className="text-foreground"
          />
        </Chip>
      )}
      {attachments > 0 && (
        <Chip data-slot="task-card-attachments" title={text.attachments(attachments)}>
          <PaperclipIcon />
          <span aria-hidden="true" className="tabular-nums">
            {attachments}
          </span>
          <span className="sr-only">{text.attachments(attachments)}</span>
        </Chip>
      )}
      {task.acceptance.length > 0 && (
        <Chip>
          <AcceptanceBar
            counts={counts}
            labels={{ bar: text.acceptance(task.id) }}
            formatSummary={parts.acceptanceSummary}
            className="w-5"
          />
          <span aria-hidden="true" className="tabular-nums">
            {counts.pass}/{task.acceptance.length}
          </span>
        </Chip>
      )}
    </div>
  )
}

export { TaskCardChips }
