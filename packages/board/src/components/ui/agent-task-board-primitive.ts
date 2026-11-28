import {
  createChange,
  createController,
  definePrimitive,
  dispatch,
  type ChangeDetails,
  type ChangeOptions,
} from "@ui-sdk/core"

import { settled } from "@/lib/action-refusal"
import { NO_STAGE, filterOptions, type TaskFilters } from "@/lib/agent-task-board-model"
import type { AttemptView, TaskLink, TaskView, ThreadRef } from "@/lib/agent-task-types"
import { isOneOf, isStringArray } from "@/lib/narrow"

type BoardView = "board" | "table" | "backlog"
type BoardMode = "snapshot" | "live"
type AgentApproval = "confirm" | "allow" | "deny"

type ViewChangeReason = "item-press" | "imperative"
type FiltersChangeReason = "item-press" | "input-change" | "clear-press" | "imperative"
type SelectReason = "item-press" | "close-press" | "escape-key" | "outside-press" | "imperative"
type OpenThreadReason = "item-press" | "link-press" | "imperative"
type OpenLinkReason = "link-press" | "imperative"

type AgentTaskBoardOptions = {
  tasks?: readonly TaskView[]
  /** Stage ids the `stage` filter accepts; without it, the stages the tasks' locations name. */
  stageIds?: readonly string[]
  /** The "no stage" choice's label, which the `stage` filter takes as well as `NO_STAGE`. */
  noStageLabel?: string
  view?: BoardView
  defaultView?: BoardView
  onViewChange?: (view: BoardView, details: ChangeDetails<ViewChangeReason>) => void
  filters?: TaskFilters
  defaultFilters?: TaskFilters
  onFiltersChange?: (filters: TaskFilters, details: ChangeDetails<FiltersChangeReason>) => void
  selectedTaskId?: string | null
  defaultSelectedTaskId?: string | null
  /** The contract's `onSelectTask`; the root component maps one onto the other. */
  onSelectedTaskIdChange?: (id: string | null, details: ChangeDetails<SelectReason>) => void
  onOpenThread?: (thread: ThreadRef, details: ChangeDetails<OpenThreadReason> & { attemptId: string }) => void
  onOpenLink?: (link: TaskLink, details: ChangeDetails<OpenLinkReason> & { taskId: string }) => void
  controller?: AgentTaskBoardController
}

interface AgentTaskBoardController {
  setView: (view: BoardView, options?: ChangeOptions<ViewChangeReason>) => boolean | undefined
  filter: (partial: FilterChange, options?: ChangeOptions<FiltersChangeReason>) => boolean | undefined
  selectTask: (id: string | null, options?: ChangeOptions<SelectReason>) => boolean | undefined
  openThread: (attemptId: string, options?: ChangeOptions<OpenThreadReason>) => boolean | undefined
  openLink: (taskId: string, link: string, options?: ChangeOptions<OpenLinkReason>) => boolean | undefined
}

type FilterChange = Partial<Record<Exclude<keyof TaskFilters, "stage">, string | null>> & {
  stage?: readonly string[] | string | null
}

const VIEWS: readonly BoardView[] = ["board", "table", "backlog"]
const FILTER_KEYS = ["project", "profile", "model", "query", "stage"] as const satisfies readonly (keyof TaskFilters)[]
const CHOICE_KEYS = { project: "projects", profile: "profiles", model: "models" } as const

function reasonOf<Reason extends string>(options: unknown): { reason: Reason | "imperative"; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<Reason>
  return { reason, event: event instanceof Event ? event : undefined }
}

const sameText = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" }) === 0

function checkStages(value: unknown, allowed: readonly string[], noStageLabel?: string): string[] | undefined {
  const list = typeof value === "string" ? [value] : value
  if (!isStringArray(list)) {
    throw new TypeError(`Filter "stage" takes a list of stage ids, or null to clear it.`)
  }
  const stages = list.map((stage) =>
    noStageLabel && !allowed.includes(stage) && sameText(stage, noStageLabel) ? NO_STAGE : stage,
  )
  for (const stage of stages) {
    if (stage !== NO_STAGE && !allowed.includes(stage)) {
      const none = noStageLabel ? `${NO_STAGE} ("${noStageLabel}")` : NO_STAGE
      throw new RangeError(`No stage "${stage}". Choices: ${[...allowed, none].join(", ")}.`)
    }
  }
  return stages.length > 0 ? [...new Set(stages)] : undefined
}

function stageChoices(tasks: readonly TaskView[], stageIds: readonly string[] | undefined): string[] {
  return stageIds ? [...stageIds] : [...new Set(tasks.flatMap((task) => (task.location ? [task.location.stage] : [])))]
}

function checkFilters(
  partial: unknown,
  current: TaskFilters,
  tasks: readonly TaskView[],
  stageIds: readonly string[] | undefined,
  noStageLabel?: string,
): TaskFilters {
  if (typeof partial !== "object" || partial === null || Array.isArray(partial)) {
    throw new TypeError(`filter takes an object with any of: ${FILTER_KEYS.join(", ")}.`)
  }
  const choices = filterOptions(tasks)
  const next: TaskFilters = { ...current }
  for (const [key, value] of Object.entries(partial)) {
    if (!isOneOf(FILTER_KEYS, key)) {
      throw new TypeError(`Unknown filter "${key}". Filters: ${FILTER_KEYS.join(", ")}.`)
    }
    const filterKey = key
    if (value === null || value === undefined || value === "") {
      delete next[filterKey]
      continue
    }
    if (filterKey === "stage") {
      const stages = checkStages(value, stageChoices(tasks, stageIds), noStageLabel)
      if (stages) next.stage = stages
      else delete next.stage
      continue
    }
    if (typeof value !== "string") throw new TypeError(`Filter "${key}" takes text, or null to clear it.`)
    if (filterKey !== "query") {
      const allowed = choices[CHOICE_KEYS[filterKey]]
      if (!allowed.includes(value)) throw new RangeError(`No ${key} "${value}". Choices: ${allowed.join(", ")}.`)
    }
    next[filterKey] = value
  }
  return next
}

function findAttempt(tasks: readonly TaskView[], attemptId: string): AttemptView | undefined {
  for (const task of tasks) {
    const attempt = task.attempts.find((candidate) => candidate.id === attemptId)
    if (attempt) return attempt
  }
  return undefined
}

const agentTaskBoard = definePrimitive({
  name: "agent-task-board",
  options: {
    tasks: "list",
    stageIds: "list",
    noStageLabel: "string",
    view: "string",
    defaultView: "string",
    onViewChange: "callback",
    filters: "value",
    defaultFilters: "value",
    onFiltersChange: "callback",
    selectedTaskId: "value",
    defaultSelectedTaskId: "value",
    onSelectedTaskIdChange: "callback",
    onOpenThread: "callback",
    onOpenLink: "callback",
    controller: "value",
  },
  state: (options: AgentTaskBoardOptions) => ({
    view: options.view ?? options.defaultView ?? ("board" as BoardView),
    filters: options.filters ?? options.defaultFilters ?? {},
    selectedTaskId:
      options.selectedTaskId !== undefined ? options.selectedTaskId : (options.defaultSelectedTaskId ?? null),
  }),
  sync: (options) => ({
    ...(options.view === undefined ? {} : { view: options.view }),
    ...(options.filters === undefined ? {} : { filters: options.filters }),
    ...(options.selectedTaskId === undefined ? {} : { selectedTaskId: options.selectedTaskId }),
  }),
  controlled: ["view", "filters", "selectedTaskId"],
  api: (context) => {
    const change = createChange(context)
    const tasks = () => context.options().tasks ?? []
    return {
      setView(view: unknown, options?: ChangeOptions<ViewChangeReason>) {
        if (!isOneOf(VIEWS, view)) throw new TypeError(`setView takes one of: ${VIEWS.join(", ")}.`)
        const call = reasonOf<ViewChangeReason>(options)
        return settled(change("view", view, call), "setView", call)
      },
      filter(partial: unknown, options?: ChangeOptions<FiltersChangeReason>) {
        const { stageIds, noStageLabel } = context.options()
        const next = checkFilters(partial, context.store.get().filters, tasks(), stageIds, noStageLabel)
        const call = reasonOf<FiltersChangeReason>(options)
        return settled(change("filters", next, call), "filter", call)
      },
      selectTask(id: unknown, options?: ChangeOptions<SelectReason>) {
        const selected = id === null ? null : tasks().find((task) => task.id === id)?.id
        if (selected === undefined) {
          throw new RangeError(`No task "${String(id)}". Pass a task id from the board, or null to close it.`)
        }
        const call = reasonOf<SelectReason>(options)
        return settled(change("selectedTaskId", selected, call), "selectTask", call)
      },
      openThread(attemptId: unknown, options?: ChangeOptions<OpenThreadReason>) {
        const attempt = typeof attemptId === "string" ? findAttempt(tasks(), attemptId) : undefined
        if (!attempt) throw new RangeError(`No attempt "${String(attemptId)}" on the board.`)
        if (!attempt.thread) throw new RangeError(`Attempt "${attempt.id}" has no thread.`)
        if (!context.options().onOpenThread) throw new Error("This board doesn't open threads.")
        const details = { ...reasonOf(options), attemptId: attempt.id }
        return settled(!dispatch(context, "onOpenThread", attempt.thread, details), "openThread", details)
      },
      openLink(taskId: unknown, link: unknown, options?: ChangeOptions<OpenLinkReason>) {
        const task = tasks().find((candidate) => candidate.id === taskId)
        if (!task) throw new RangeError(`No task "${String(taskId)}" on the board.`)
        const links = task.links ?? []
        const found = links.find((candidate) => candidate.href === link || candidate.label === link)
        if (!found) {
          const choices = links.map((candidate) => candidate.label).join(", ") || "none"
          throw new RangeError(`Task "${task.id}" has no link "${String(link)}". Links: ${choices}.`)
        }
        if (!context.options().onOpenLink) throw new Error("This board doesn't open links.")
        const details = { ...reasonOf<OpenLinkReason>(options), taskId: task.id }
        return settled(!dispatch(context, "onOpenLink", found, details), "openLink", details)
      },
      tasks: () => tasks().map((task) => ({ value: task.id, label: `${task.id} ${task.title}` })),
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "region",
      attrs: (state) => ({ "data-view": state.view, "data-selected": state.selectedTaskId === null ? undefined : "" }),
    }),
  }),
  agent: { actions: ["selectTask", "openThread", "openLink", "setView", "filter"], items: (api) => api.tasks() },
})

function createAgentTaskBoardController() {
  return createController<AgentTaskBoardController>()
}

export { agentTaskBoard, createAgentTaskBoardController }
export type {
  AgentApproval,
  AgentTaskBoardController,
  AgentTaskBoardOptions,
  BoardMode,
  BoardView,
  FilterChange,
  OpenLinkReason,
}
