import { definePrimitive, dispatch, type ChangeDetails, type ChangeOptions } from "@ui-sdk/core"

import { settled, unavailable } from "@/lib/action-refusal"

/** How a row action was asked for: a press on its button or link, or a call (an agent's step, app code). */
type ListRowActionReason = "item-press" | "imperative"

/** A row that offers the action; `disabled` says why it can't run there now (empty when there is no reason). */
type ListRowActionRow = { value: string; label: string; disabled?: string }

type ListRowActionOptions = {
  /** The rows that offer the action, rendered or not. */
  rows?: readonly ListRowActionRow[]
  /** Asks a person before an agent runs it: the `data-agent-confirm` sentence. */
  confirm?: string
  /** Runs the action for a row, before anything else; `details.cancel()` refuses it. */
  onRun?: (id: string, details: ChangeDetails<ListRowActionReason>) => void
  /** What running it does once `onRun` allowed it, when no press will do it natively, like following a link. */
  perform?: (id: string) => void
}

function reasonOf(options: unknown): { reason: ListRowActionReason; event?: Event } {
  if (typeof options !== "object" || options === null) return { reason: "imperative" }
  const { reason = "imperative", event } = options as ChangeOptions<ListRowActionReason>
  return { reason, event: event instanceof Event ? event : undefined }
}

function stateOf(options: ListRowActionOptions) {
  return { count: options.rows?.length ?? 0, confirm: options.confirm || undefined }
}

/**
 * One action that rows of a List offer, like "Copy URL", for agents: `run(id)` runs it on the row with that id,
 * rendered or not, as a press on that row's button does. A row that doesn't offer it, or offers it disabled,
 * fails the step with why.
 */
const listRowAction = definePrimitive({
  name: "list-row-action",
  options: { rows: "value", confirm: "string", onRun: "callback", perform: "callback" },
  state: stateOf,
  sync: stateOf,
  api: (context) => {
    const rows = () => context.options().rows ?? []
    return {
      run(id: unknown, options?: ChangeOptions<ListRowActionReason>) {
        const row = rows().find((candidate) => candidate.value === id)
        if (!row) {
          const ids = rows().map((candidate) => candidate.value)
          throw new RangeError(`No row "${String(id)}" offers this action. Rows: ${ids.join(", ")}.`)
        }
        const details = reasonOf(options)
        if (row.disabled !== undefined) {
          const why = row.disabled ? `: ${row.disabled}` : ""
          return unavailable("run", `isn't available on "${row.label}"${why}`, details)
        }
        if (dispatch(context, "onRun", row.value, details)) return settled(false, "run", details)
        const pressAlreadyRanAction = Boolean(details.event)
        if (!pressAlreadyRanAction) context.options().perform?.(row.value)
        return true
      },
      rows: () => rows().map(({ value, label }) => ({ value, label })),
    }
  },
  slots: (slot) => ({
    root: slot({
      role: "group",
      attrs: (state) => ({ "data-agent-confirm": state.confirm, "data-count": String(state.count) }),
    }),
  }),
  agent: { actions: ["run"], items: (api) => api.rows(), shown: (state) => state.count > 0 },
})

export { listRowAction }
export type { ListRowActionOptions, ListRowActionReason, ListRowActionRow }
