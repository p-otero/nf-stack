import { definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { TASK_STATUSES, type TaskMove } from "@/lib/agent-task-board-model"
import type { TaskStatus, TaskView } from "@/lib/agent-task-types"
import type { AgentApproval } from "@/components/ui/agent-task-board-primitive"
import { isOneOf } from "@/lib/narrow"

type TaskMoveReason = "drag" | "move-key" | "imperative"

type AgentTaskMovesOptions = {
  /** The tasks the board shows, in their order. */
  tasks?: readonly TaskView[]
  /** The columns shown, by status. */
  statuses?: readonly TaskStatus[]
  canMove?: (task: TaskView, to: TaskStatus) => boolean
  agentApproval?: AgentApproval
  /** Required with `agentApproval` "confirm": what an agent asks a person before it moves a task. */
  agentConfirm?: string
  onMoveTask?: (move: TaskMove, details: ChangeDetails<TaskMoveReason>) => void
}

function stateOf(options: AgentTaskMovesOptions) {
  const approval = options.agentApproval ?? "confirm"
  const agentConfirm = approval === "confirm" ? options.agentConfirm || undefined : undefined
  const askable = approval === "allow" || agentConfirm !== undefined
  return {
    available: askable && Boolean(options.onMoveTask) && (options.statuses?.length ?? 0) > 0,
    agentConfirm,
  }
}

const agentTaskMoves = definePrimitive({
  name: "agent-task-moves",
  options: {
    tasks: "list",
    statuses: "list",
    canMove: "value",
    agentApproval: "string",
    agentConfirm: "string",
    onMoveTask: "callback",
  },
  state: stateOf,
  sync: stateOf,
  api: (context) => {
    const tasks = () => context.options().tasks ?? []
    return {
      moveTask(id: unknown, status: unknown, index?: unknown, options?: ChangeOptions<TaskMoveReason>) {
        if (!context.store.get().available) throw new Error("Tasks can't be moved on this board now.")
        const task = tasks().find((candidate) => candidate.id === id)
        if (!task) throw new RangeError(`No task "${String(id)}" on the board.`)
        const statuses = context.options().statuses ?? []
        if (!isOneOf(statuses, status)) {
          const known = isOneOf(TASK_STATUSES, status) ? " isn't shown" : " isn't a status"
          throw new RangeError(`"${String(status)}"${known}. Columns: ${statuses.join(", ")}.`)
        }
        const to = status
        const canMove = context.options().canMove
        if (canMove && !canMove(task, to)) throw new Error(`Task "${task.id}" can't move to "${to}".`)
        const column = tasks().filter((candidate) => candidate.status === to && candidate.id !== task.id)
        const at = index === undefined || index === null ? column.length : index
        if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at > column.length) {
          throw new RangeError(`moveTask takes an index from 0 to ${String(column.length)} in "${to}".`)
        }
        const move: TaskMove = {
          id: task.id,
          from: task.status,
          to,
          index: at,
          before: column[at]?.id ?? null,
        }
        const details = { reason: options?.reason ?? "imperative", event: options?.event }
        return settled(!dispatch(context, "onMoveTask", move, details), "moveTask", details)
      },
      tasks: () => tasks().map((task) => ({ value: task.id, label: `${task.id} ${task.title} (${task.status})` })),
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
  agent: { actions: ["moveTask"], items: (api) => api.tasks(), shown: (state) => state.available },
})

export { agentTaskMoves }
export type { AgentTaskMovesOptions, TaskMoveReason }
