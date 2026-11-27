"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import { usePart, usePrimitive, type PrimitiveHandle } from "@ui-sdk/react/primitive"
import { createContext, use, type ComponentType, type MouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { ListGridCell, type ListGridHandle } from "@/components/ui/list-grid"
import {
  listRowAction,
  type ListRowActionReason,
  type ListRowActionRow,
} from "@/components/ui/list-row-action-primitive"
import { useHandleEntry } from "@/components/ui/use-list-item"
import { cn } from "@/lib/utils"

/** An action a row offers, like "Copy URL". Rows that offer the same action give it the same `id`. */
type ListRowAction = {
  /** The same on every row that offers it: agents run it by this action and the row's id. */
  id: string
  /** Names the button (its tooltip when it has an `icon`) and the action for agents. */
  label: string
  /** A lucide icon: the button shows only the icon, and the label in a tooltip. */
  icon?: ComponentType<{ className?: string }>
  /** Runs on a press and on an agent's `run`; `details.cancel()` refuses it, which fails an agent's step. */
  onAction?: (details: ChangeDetails<ListRowActionReason>) => void
  /** Makes the action a link, for navigation only, like opening the row's URL. */
  href?: string
  /** Opens `href` in a new tab. */
  newTab?: boolean
  /** Unavailable on this row; a string says why, in the tooltip and in an agent's failed step. */
  disabled?: boolean | string
  /** An agent asks a person before it runs this action: the `data-agent-confirm` sentence. Use it for anything destructive. */
  confirm?: string
  /** `destructive` colours the button. */
  tone?: "destructive"
}

type ListRowActionLabels = {
  /** A row's button. In a grid the row gives it context, so the action's label is enough by default. */
  button: (action: ListRowAction, title: string) => string
  /** The action for agents, over every row: its label by default. Make it unique when two lists share an action. */
  group: (action: ListRowAction) => string
}

const listRowActionLabels: ListRowActionLabels = {
  button: (action) => action.label,
  group: (action) => action.label,
}

/** When a row's actions show on a fine pointer: on hover, focus and selection, or always. Touch always shows them. */
type ListRowActionsVisibility = "hover" | "always"

type ListRowActionHandle = PrimitiveHandle<typeof listRowAction>

type RowActionsContextValue = {
  actionsOf: (id: string) => readonly ListRowAction[]
  run: (action: string, row: string, event: Event) => boolean
  labels: ListRowActionLabels
  visibility: ListRowActionsVisibility
}

const RowActionsContext = createContext<RowActionsContextValue | null>(null)

/** The actions of the List around a row, or null when its rows have none. */
function useRowActions() {
  return use(RowActionsContext)
}

/** One entry per action across every row, rendered or not, with the rows that offer it. */
type RowActionKind = { action: ListRowAction; rows: ListRowActionRow[] }

function collectRowActions(
  entries: readonly { value: string; label: string }[],
  actionsOf: (id: string) => readonly ListRowAction[] | undefined,
) {
  const kinds = new Map<string, RowActionKind>()
  for (const entry of entries) {
    for (const action of actionsOf(entry.value) ?? []) {
      let kind = kinds.get(action.id)
      if (!kind) {
        kind = { action, rows: [] }
        kinds.set(action.id, kind)
      }
      const disabled = action.disabled === undefined || action.disabled === false ? undefined : action.disabled
      kind.rows.push({
        value: entry.value,
        label: entry.label,
        disabled: disabled === undefined ? undefined : disabled === true ? "" : disabled,
      })
    }
  }
  return [...kinds.values()]
}

function follow(action: ListRowAction) {
  if (!action.href) return
  if (action.newTab) globalThis.open(action.href, "_blank", "noopener,noreferrer")
  else globalThis.location.assign(action.href)
}

function ListRowActionRoot({
  kind,
  label,
  actionsOf,
  handles,
}: {
  kind: RowActionKind
  label: string
  actionsOf: (id: string) => readonly ListRowAction[]
  handles: Map<string, ListRowActionHandle>
}) {
  const id = kind.action.id
  const find = (row: string) => actionsOf(row).find((action) => action.id === id)
  const handle = usePrimitive(listRowAction, {
    rows: kind.rows,
    confirm: kind.action.confirm,
    onRun: (row, details) => find(row)?.onAction?.(details),
    perform: (row) => {
      const action = find(row)
      if (action) follow(action)
    },
  })
  useHandleEntry(handles, id, handle)
  return usePart(handle, "root", {}, { "aria-label": label, className: "sr-only" }, "div")
}

/**
 * Agents' way to the actions: one component per action, named by its label, whose `run(id)` takes the row's id.
 * The rows' own buttons stay out of agents' sight, so a long list doesn't fill the snapshot with them.
 */
function ListRowActionRoots({
  kinds,
  labels,
  actionsOf,
  handles,
}: {
  kinds: readonly RowActionKind[]
  labels: ListRowActionLabels
  actionsOf: (id: string) => readonly ListRowAction[]
  handles: Map<string, ListRowActionHandle>
}) {
  return kinds.map((kind) => (
    <ListRowActionRoot
      key={kind.action.id}
      kind={kind}
      label={labels.group(kind.action)}
      actionsOf={actionsOf}
      handles={handles}
    />
  ))
}

const revealClassNames = {
  // Shown while the row is hovered, holds focus or is selected; a coarse pointer has no hover, so it always shows.
  hover:
    "pointer-fine:opacity-0 pointer-fine:group-hover/list-item:opacity-100 pointer-fine:group-focus-within/list-item:opacity-100 pointer-fine:group-data-selected/list-item:opacity-100 transition-opacity duration-micro ease-standard",
  always: "",
} satisfies Record<ListRowActionsVisibility, string>

function RowActionButton({
  action,
  row,
  title,
  context,
  cell,
}: {
  action: ListRowAction
  row: string
  title: string
  context: RowActionsContextValue
  /** The grid cell's props, for the element the Button renders. */
  cell?: Record<string, unknown>
}) {
  const name = context.labels.button(action, title)
  const reason = typeof action.disabled === "string" ? action.disabled : undefined
  const disabled = action.disabled !== undefined && action.disabled !== false
  const Icon = action.icon
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (!context.run(action.id, row, event.nativeEvent)) event.preventDefault()
  }
  const shared = {
    variant: "ghost" as const,
    disabled,
    focusableWhenDisabled: disabled,
    "aria-label": name,
    "data-agent-hidden": "",
    "data-row-action": action.id,
    "data-tone": action.tone,
    tooltip: reason === undefined ? undefined : `${name} (${reason})`,
    className: cn(action.tone === "destructive" && "text-destructive hover:text-destructive"),
    onClick,
    // UI SDK's Button keeps its own data-slot over a prop; the rendered element's props win.
    render: action.href ? (
      // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the Button renders its icon or label into it
      <a
        {...cell}
        href={action.href}
        target={action.newTab ? "_blank" : undefined}
        rel="noopener noreferrer"
        data-slot="list-item-action"
      />
    ) : (
      <button {...cell} type="button" data-slot="list-item-action" />
    ),
  }
  if (Icon) {
    return (
      <Button {...shared} size="icon" className={cn("size-control-sm", shared.className)}>
        <Icon />
      </Button>
    )
  }
  return (
    <Button {...shared} size="sm">
      {action.label}
    </Button>
  )
}

/**
 * A row's actions, after its content. In a grid each is a cell of its own, which Left and Right reach; pressing one
 * runs it without choosing the row.
 */
function ListRowActionCells({
  id,
  title,
  grid,
  className,
}: {
  id: string
  title: string
  grid: ListGridHandle | null
  className?: string
}): ReactNode {
  const context = useRowActions()
  const actions = context?.actionsOf(id) ?? []
  if (!context || actions.length === 0) return null
  return (
    <div
      data-slot="list-item-actions"
      className={cn(
        "relative z-10 flex shrink-0 items-center gap-inline self-center",
        revealClassNames[context.visibility],
        className,
      )}
    >
      {actions.map((action, index) => {
        if (!grid) {
          return <RowActionButton key={action.id} action={action} row={id} title={title} context={context} />
        }
        return (
          <div
            key={action.id}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of flex rows, not a table
            role="gridcell"
            data-slot="list-item-action-cell"
            className="flex"
          >
            <ListGridCell
              handle={grid}
              id={id}
              col={index + 1}
              render={(part) => (
                <RowActionButton action={action} row={id} title={title} context={context} cell={part} />
              )}
            />
          </div>
        )
      })}
    </div>
  )
}

export {
  collectRowActions,
  ListRowActionCells,
  listRowActionLabels,
  ListRowActionRoots,
  RowActionsContext,
  useRowActions,
}
export type {
  ListRowAction,
  ListRowActionHandle,
  ListRowActionLabels,
  ListRowActionsVisibility,
  RowActionKind,
  RowActionsContextValue,
}
