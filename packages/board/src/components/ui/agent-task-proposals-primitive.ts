import { definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import type { TaskView } from "@/lib/agent-task-types"
import type { AgentApproval, BoardMode } from "@/components/ui/agent-task-board-primitive"

type ProposalReason = "item-press" | "imperative"
type ProposalAction = (id: string, details: ChangeDetails<ProposalReason>) => void | Promise<void>

type AgentTaskProposalsOptions = {
  tasks?: readonly TaskView[]
  mode?: BoardMode
  agentApproval?: AgentApproval
  /** Required with `agentApproval` "confirm": what an agent asks a person before it approves or rejects. */
  agentConfirm?: string
  onApproveProposal?: ProposalAction
  onRejectProposal?: ProposalAction
}

type ProposalItem = { value: string; label: string }

function proposalsOf(tasks: readonly TaskView[] = []): ProposalItem[] {
  return tasks
    .filter((task) => task.status === "proposed")
    .map((task) => ({ value: task.id, label: `${task.id} ${task.title}` }))
}

function stateOf(options: AgentTaskProposalsOptions) {
  const approval = options.agentApproval ?? "confirm"
  const agentConfirm = approval === "confirm" ? options.agentConfirm || undefined : undefined
  const agentRunAllowedOrAskable = approval === "allow" || agentConfirm !== undefined
  const handled = Boolean(options.onApproveProposal || options.onRejectProposal)
  return {
    proposals: proposalsOf(options.tasks),
    available: options.mode === "live" && agentRunAllowedOrAskable && handled,
    agentConfirm,
  }
}

function dispatchKeepingCallbackResult(
  options: () => AgentTaskProposalsOptions,
  name: "onApproveProposal" | "onRejectProposal",
  id: string,
  details: ChangeOptions<ProposalReason>,
) {
  const callback = options()[name]
  let result: unknown
  const canceled = dispatch(
    {
      options: () => ({
        [name]: (value: string, given: ChangeDetails<ProposalReason>) => (result = callback?.(value, given)),
      }),
    },
    name,
    id,
    { reason: details.reason ?? "imperative", event: details.event },
  )
  return canceled ? false : (result ?? true)
}

const agentTaskProposals = definePrimitive({
  name: "agent-task-proposals",
  options: {
    tasks: "list",
    mode: "string",
    agentApproval: "string",
    agentConfirm: "string",
    onApproveProposal: "action",
    onRejectProposal: "action",
  },
  state: stateOf,
  sync: stateOf,
  api: (context) => {
    const act = (
      name: "onApproveProposal" | "onRejectProposal",
      id: unknown,
      options?: ChangeOptions<ProposalReason>,
    ) => {
      const state = context.store.get()
      if (!state.available || !context.options()[name]) throw new Error("Proposals can't be decided on this board now.")
      const found = state.proposals.find((candidate) => candidate.value === id)
      if (!found) {
        const ids = state.proposals.map((proposal) => proposal.value).join(", ") || "none"
        throw new RangeError(`No proposal "${String(id)}". Proposals: ${ids}.`)
      }
      const call = { reason: options?.reason ?? "imperative", event: options?.event }
      const action = name === "onApproveProposal" ? "approveProposal" : "rejectProposal"
      return settled(dispatchKeepingCallbackResult(context.options, name, found.value, call), action, call)
    }
    return {
      approveProposal: (id: unknown, options?: ChangeOptions<ProposalReason>) => act("onApproveProposal", id, options),
      rejectProposal: (id: unknown, options?: ChangeOptions<ProposalReason>) => act("onRejectProposal", id, options),
      proposals: () => context.store.get().proposals,
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "group",
      attrs: (state) => ({
        "data-agent-confirm": state.agentConfirm,
        "data-available": state.available ? "" : undefined,
      }),
    }),
  }),
  agent: {
    actions: ["approveProposal", "rejectProposal"],
    items: (api) => api.proposals(),
    shown: (state) => state.available,
  },
})

export { agentTaskProposals }
export type { AgentTaskProposalsOptions, ProposalAction }
