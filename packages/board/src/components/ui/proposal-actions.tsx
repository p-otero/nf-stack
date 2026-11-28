"use client"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Spinner } from "@/components/ui/spinner"
import type { AgentApproval, BoardMode } from "@/components/ui/agent-task-board-primitive"
import { agentTaskBoardLabels, type ProposalLabels } from "@/lib/agent-task-board-labels"
import { cn } from "@/lib/utils"

type ProposalActionsProps = {
  taskId: string
  mode: BoardMode
  /** A returned Promise keeps the button pending; a rejection shows its message. */
  onApprove?: (id: string) => void | Promise<void>
  /** Runs after the on-screen confirmation, with the same pending and error handling. */
  onReject?: (id: string) => void | Promise<void>
  agentApproval?: AgentApproval
  labels?: Partial<ProposalLabels>
  renderError?: (error: unknown) => string
  className?: string
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function ProposalActions({
  taskId,
  mode,
  onApprove,
  onReject,
  agentApproval = "confirm",
  labels,
  renderError = messageOf,
  className,
}: ProposalActionsProps) {
  if (mode !== "live" || (!onApprove && !onReject)) return null
  const text = { ...agentTaskBoardLabels.proposals, ...labels }
  const confirm = agentApproval === "confirm"

  return (
    <div
      data-slot="proposal-actions"
      data-agent-hidden={agentApproval === "deny" ? "" : undefined}
      className={cn("flex flex-wrap items-start gap-items", className)}
    >
      {onApprove ? (
        <Button
          size="sm"
          aria-label={text.approveName(taskId)}
          data-agent-confirm={confirm ? text.approveAgentConfirm(taskId) : undefined}
          pendingAnnouncement={text.approving}
          onClick={() => onApprove(taskId)}
          render={(props, state) => (
            <span className="flex flex-col items-start gap-inline">
              <button {...props}>
                <Spinner data-show="pending" />
                {text.approve}
              </button>
              <span role="alert" className="text-sm text-destructive empty:hidden">
                {state.error === undefined || state.error === null ? null : renderError(state.error)}
              </span>
            </span>
          )}
        />
      ) : null}
      {onReject ? (
        <ConfirmDialog
          trigger={
            <>
              <span aria-hidden="true">{text.reject}</span>
              <span className="sr-only">{text.rejectName(taskId)}</span>
            </>
          }
          triggerVariant="outline"
          title={text.rejectTitle(taskId)}
          description={text.rejectDescription}
          confirmLabel={text.rejectConfirm}
          labels={{ cancel: text.cancel }}
          {...(confirm ? { tone: "destructive", agentConfirm: text.rejectAgentConfirm(taskId) } : { tone: "default" })}
          pendingAnnouncement={text.rejecting}
          renderError={renderError}
          onConfirm={() => onReject(taskId)}
        />
      ) : null}
    </div>
  )
}

export { ProposalActions }
export type { ProposalActionsProps }
