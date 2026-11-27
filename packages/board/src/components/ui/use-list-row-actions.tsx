"use client"

import { useMemo, useState } from "react"

import {
  collectRowActions,
  listRowActionLabels,
  ListRowActionRoots,
  type ListRowAction,
  type ListRowActionHandle,
  type ListRowActionLabels,
  type ListRowActionsVisibility,
  type RowActionsContextValue,
} from "@/components/ui/list-row-actions"

const noActions: readonly ListRowAction[] = []

/**
 * A List's row actions: the context its rows read, and the components agents run the actions through, one per
 * action, over every row whether it's rendered or not.
 */
function useListRowActions({
  rowActions,
  entries,
  labels: overrides,
  visibility,
}: {
  rowActions: ((id: string) => readonly ListRowAction[] | undefined) | undefined
  entries: readonly { value: string; label: string }[]
  labels: Partial<ListRowActionLabels> | undefined
  visibility: ListRowActionsVisibility
}) {
  // One Map for the list's life, filled by each action's component as it mounts.
  const [handles] = useState(() => new Map<string, ListRowActionHandle>())
  const labels = useMemo(() => ({ ...listRowActionLabels, ...overrides }), [overrides])
  const context = useMemo<RowActionsContextValue | null>(() => {
    if (!rowActions) return null
    return {
      actionsOf: (id) => rowActions(id) ?? noActions,
      labels,
      visibility,
      run: (action, row, event) => handles.get(action)?.api.run(row, { reason: "item-press", event }) ?? false,
    }
  }, [rowActions, labels, visibility, handles])
  const kinds = useMemo(() => (rowActions ? collectRowActions(entries, rowActions) : undefined), [entries, rowActions])
  const roots =
    kinds && context ? (
      <ListRowActionRoots kinds={kinds} labels={labels} actionsOf={context.actionsOf} handles={handles} />
    ) : null
  return { context, roots }
}

export { useListRowActions }
