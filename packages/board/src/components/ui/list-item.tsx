"use client"

import { Button } from "@ui-sdk/react/button"
import { ListboxItem } from "@ui-sdk/react/listbox"
import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { createElement, useState, type ComponentProps, type ReactElement, type ReactNode } from "react"

import { Checkbox, CheckboxIndicator } from "@/components/ui/checkbox"
import { useListContext, useListItemPosition, type ListVariant, List, type ListProps } from "@/components/ui/list"
import { ListGroup, type ListGroupProps } from "@/components/ui/list-group"
import { ListGridCell, ListGridRow, useListGrid } from "@/components/ui/list-grid"
import { ListRowActionCells, useRowActions } from "@/components/ui/list-row-actions"
import { NavigableRow } from "@/components/ui/row-navigation"
import { SortableHandle, SortableItem } from "@/components/ui/sortable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useListItemRegistration, useTruncated } from "@/components/ui/use-list-item"
import type { Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"

// Perf: contain-content, so moving focus repaints only one row.
const rowClassNames = {
  row: "rounded-control contain-content hover:bg-accent/60 data-checked:bg-accent/60 data-selected:bg-accent data-selected:text-accent-foreground",
  card: "rounded-lg border bg-card/(--glass-opacity) text-card-foreground shadow-surface backdrop-surface hover:border-ring data-selected:border-ring data-selected:bg-accent data-selected:text-accent-foreground data-selected:ring-3 data-selected:ring-ring/25",
} satisfies Record<ListVariant, string>

const stretchedClassNames = {
  row: "after:rounded-control focus-visible:after:ring-inset",
  card: "after:rounded-lg",
} satisfies Record<ListVariant, string>

type ListItemEmphasis = "muted" | "strong"

const toneClassNames = {
  neutral: "bg-neutral-soft text-neutral-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  violet: "bg-violet-soft text-violet-soft-foreground",
} satisfies Record<Tone, string>

/** An icon on a tinted square, for a row's `leading`. */
function IconTile({ tone = "neutral", className, render, ...props }: PartProps<"span"> & { tone?: Tone }) {
  return renderElement(
    "span",
    {
      "aria-hidden": true,
      "data-slot": "icon-tile",
      className: cn(
        "flex size-8 shrink-0 items-center justify-center rounded-control [&_svg]:size-4",
        toneClassNames[tone],
        className,
      ),
      ...props,
    },
    render,
  )
}

function ListItemTitle({ className, render, ...props }: PartProps<"span">) {
  return renderElement(
    "span",
    {
      "data-slot": "list-item-title",
      className: cn("line-clamp-2 min-w-0 text-body font-medium break-words", className),
      ...props,
    },
    render,
  )
}

function ListItemMeta({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "list-item-meta",
      className: cn("flex flex-wrap items-center gap-inline text-caption text-muted-foreground", className),
      ...props,
    },
    render,
  )
}

function ListItemActions({ className, render, ...props }: PartProps<"div">) {
  return renderElement(
    "div",
    {
      "data-slot": "list-item-actions",
      className: cn("relative z-10 flex shrink-0 items-center gap-inline self-center", className),
      ...props,
    },
    render,
  )
}

function followWithoutSelectingAgain(primary: HTMLElement) {
  primary.setAttribute("data-selecting", "")
  primary.click()
}

type ListItemProps = {
  id: string
  title: string
  /** A control before the content, like a checkbox that selects the row; ignored in a selectable List. */
  control?: ReactNode
  leading?: ReactNode
  subtitle?: ReactNode
  /** A StatusPill; on a narrow row it wraps below the title instead of squeezing it. */
  status?: ReactNode
  /** Inline chips. */
  meta?: ReactNode
  /** An avatar or a time, at the end. */
  trailing?: ReactNode
  /**
   * Buttons or a menu, in a List without `rowActions`. Rows of a selectable List are options, which can't hold
   * controls, so it ignores them there: give the List `rowActions` instead, which reach the keyboard as grid cells.
   */
  actions?: ReactNode
  selected?: boolean
  href?: string
  onSelect?: () => void
  /** Overrides the List's variant. */
  variant?: ListVariant
  /** `muted` fades the row's text, like a read message; `strong` sets it in a medium weight, like an unread one. */
  emphasis?: ListItemEmphasis
  /** The checkbox's name in a list with `checkedIds`; English by default. */
  checkLabel?: string
  className?: string
}

function ListItem({
  id,
  title,
  control,
  leading,
  subtitle,
  status,
  meta,
  trailing,
  actions,
  selected = false,
  href,
  onSelect,
  variant: variantProp,
  emphasis,
  checkLabel,
  className,
}: ListItemProps) {
  const context = useListContext()
  const position = useListItemPosition()
  const variant = variantProp ?? context?.variant ?? "row"
  const grid = useListGrid()
  const rowActions = useRowActions()
  const option = (context?.selectable ?? false) && !grid
  const gridSelects = grid !== null && (context?.selectable ?? false)
  const [titleNode, setTitleNode] = useState<HTMLElement | null>(null)
  const truncated = useTruncated(titleNode)
  const [primary, setPrimary] = useState<HTMLElement | null>(null)

  useListItemRegistration(context?.register, id, title, option, () => {
    if (href) {
      if (!primary) return false
      followWithoutSelectingAgain(primary)
      return true
    }
    if (!onSelect) return false
    onSelect()
    return true
  })

  const titleText = (
    <ListItemTitle ref={setTitleNode} title={option && truncated ? title : undefined}>
      {title}
    </ListItemTitle>
  )
  const pressable = !option && (grid !== null || href !== undefined || onSelect !== undefined)
  const primaryProps = {
    ref: setPrimary,
    "data-slot": "list-item-primary",
    "aria-current": selected && !gridSelects ? (href ? ("page" as const) : ("true" as const)) : undefined,
    className: cn(
      "min-w-0 cursor-pointer text-start outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring",
      stretchedClassNames[variant],
    ),
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      const target = event.currentTarget
      if (target.dataset.selecting !== undefined) {
        delete target.dataset.selecting
        return
      }
      if (context && !context.select(id, event.nativeEvent)) {
        event.preventDefault()
        return
      }
      if (gridSelects && grid) grid.api.setValue(id, { reason: "item-press", event: event.nativeEvent })
      if (!href) onSelect?.()
    },
    children: titleText,
  }
  const element: ReactElement<Record<string, unknown>> = href
    ? createElement("a", { href, ...primaryProps })
    : createElement(Button, {
        ...primaryProps,
        render: (props: ComponentProps<"button">) => <button {...props} data-slot="list-item-primary" />,
      } as Record<string, unknown>)
  let heading: ReactNode = titleText
  if (pressable) {
    // Perf: tooltip content mounts only while the title is cut off.
    heading = (
      <Tooltip type="label" disabled={!truncated}>
        {grid ? (
          <ListGridCell handle={grid} id={id} col={0} render={<TooltipTrigger render={element} />} />
        ) : (
          <NavigableRow id={id} render={<TooltipTrigger render={element} />} />
        )}
        {truncated && <TooltipContent>{title}</TooltipContent>}
      </Tooltip>
    )
  }
  const checked = option ? undefined : context?.checked
  const checkbox = checked && (
    <span className="relative z-10 flex min-h-lh shrink-0 items-center">
      <Checkbox
        render={(props) => <button {...props} tabIndex={-1} />}
        aria-label={checkLabel ?? `Select ${title}`}
        checked={checked.has(id)}
        onCheckedChange={() => checked.toggle(id)}
      >
        <CheckboxIndicator />
      </Checkbox>
    </span>
  )

  const sortable = option ? undefined : context?.sortable
  const handle = sortable && (
    <span className="relative z-10 -my-px flex min-h-lh shrink-0 items-center">
      <SortableHandle label={title} labels={sortable.labels} />
    </span>
  )

  const main = (
    <>
      <div className="flex min-w-0 grow basis-60 items-start gap-items">
        {handle}
        {checkbox}
        {control && !option && <span className="relative z-10 flex min-h-lh shrink-0 items-center">{control}</span>}
        {leading && (
          <span
            data-slot="list-item-leading"
            className="flex min-h-lh shrink-0 items-center text-muted-foreground [&_svg]:size-4"
          >
            {leading}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-inline">
          <div className="flex flex-wrap items-start gap-x-items gap-y-inline">
            <div className="flex min-w-0 grow basis-48">{heading}</div>
            {status && <div className="relative z-10 flex shrink-0 items-center">{status}</div>}
          </div>
          {subtitle && <div className="line-clamp-1 text-body-sm text-muted-foreground">{subtitle}</div>}
          {meta && <ListItemMeta className="relative z-10 w-fit">{meta}</ListItemMeta>}
        </div>
      </div>
      {trailing && (
        <div className="relative z-10 ms-auto flex shrink-0 items-center gap-inline self-center text-caption text-muted-foreground">
          {trailing}
        </div>
      )}
    </>
  )
  let actionsNode: ReactNode = null
  if (rowActions) actionsNode = <ListRowActionCells id={id} title={title} grid={grid} />
  else if (actions && !option) actionsNode = <ListItemActions>{actions}</ListItemActions>
  const body = (
    <>
      {main}
      {actionsNode}
    </>
  )

  const rowClassName = cn(
    "group/list-item relative flex min-w-0 flex-wrap items-start gap-items px-inset-item py-inset-item transition-colors duration-micro ease-standard",
    variant === "card" ? rowClassNames.card : rowClassNames.row,
    emphasis === "muted" && "text-muted-foreground",
    emphasis === "strong" && "font-medium",
    className,
  )

  if (grid) {
    const row = (
      <div
        ref={position?.measure}
        data-index={position?.index}
        aria-rowindex={position ? position.index + 1 : undefined}
        data-slot="list-item"
        data-item-id={id}
        data-variant={variant}
        data-selected={selected && !gridSelects ? "" : undefined}
        data-checked={checked?.has(id) ? "" : undefined}
        data-pressable=""
        className={rowClassName}
      >
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of flex rows, not a table
          role="gridcell"
          data-slot="list-item-cell"
          className="flex min-w-0 grow basis-60 flex-wrap items-start gap-items"
        >
          {main}
        </div>
        {actionsNode}
      </div>
    )
    return <ListGridRow handle={grid} id={id} render={row} />
  }
  if (option) {
    return (
      <ListboxItem
        ref={position?.measure}
        render={<div data-slot="list-item" />}
        value={id}
        index={position?.index}
        data-index={position?.index}
        data-item-id={id}
        data-variant={variant}
        className={cn(rowClassName, "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {body}
      </ListboxItem>
    )
  }
  if (sortable) {
    return (
      <SortableItem
        value={id}
        render={(part) => <li {...part} className={cn(part.className, rowClassName, "data-grabbed:bg-background")} />}
        data-item-id={id}
        data-variant={variant}
        data-selected={selected ? "" : undefined}
        data-checked={checked?.has(id) ? "" : undefined}
        data-pressable={pressable ? "" : undefined}
      >
        {body}
      </SortableItem>
    )
  }
  return (
    <li
      ref={position?.measure}
      data-index={position?.index}
      aria-posinset={position ? position.index + 1 : undefined}
      aria-setsize={position?.setsize}
      data-slot="list-item"
      data-item-id={id}
      data-variant={variant}
      data-selected={selected ? "" : undefined}
      data-checked={checked?.has(id) ? "" : undefined}
      data-pressable={pressable ? "" : undefined}
      className={rowClassName}
    >
      {body}
    </li>
  )
}

export { IconTile, ListItem, ListItemActions, ListItemMeta, ListItemTitle }
export { List, ListGroup }
export type { ListItemEmphasis, ListItemProps }
export type { ListGroupProps, ListProps, ListVariant }
