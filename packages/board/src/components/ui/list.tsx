"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import { createListboxController, Listbox, type ListboxValueChangeReason } from "@ui-sdk/react/listbox"
import { usePart, usePrimitive, type PartProps, type RenderProp } from "@ui-sdk/react/primitive"
import { memo, useCallback, useMemo, useRef, useState, type FocusEvent, type ReactElement, type ReactNode } from "react"

import {
  containerClassNames,
  ListContext,
  PositionContext,
  useListContext,
  useListItemPosition,
  type ItemHandle,
  type ListContextValue,
  type ListItemPosition,
  type ListVariant,
} from "@/components/ui/list-context"
import { ListGridProvider, ListGridRoot, useListGridInstance } from "@/components/ui/list-grid"
import { list, type ListEntry, type ListOptions } from "@/components/ui/list-primitive"
import {
  RowActionsContext,
  type ListRowAction,
  type ListRowActionLabels,
  type ListRowActionsVisibility,
} from "@/components/ui/list-row-actions"
import { RowNavigationProvider, useRowNavigation } from "@/components/ui/row-navigation"
import { ListSortableRows, type ListSortableRowsProps } from "@/components/ui/list-sortable"
import { useListRowActions } from "@/components/ui/use-list-row-actions"
import { useVirtualRows, type Virtualize } from "@/components/ui/virtual-rows"
import {
  childId,
  childRowsOf,
  childText,
  defaultId,
  defaultText,
  listboxKeyDown,
  renderChild,
} from "@/components/ui/list-rows"
import { assumeType } from "@/lib/narrow"
import { cn } from "@/lib/utils"

type ListProps<Item = unknown> = Omit<PartProps<"div">, "children" | "onSelect" | "defaultValue"> & {
  /** Names the list, for screen readers and agents. */
  "aria-label": string
  variant?: ListVariant
  /** With any of `value`, `defaultValue` or `onValueChange`, the rows are options of a UI SDK Listbox. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (id: string | null, details: ChangeDetails<ListboxValueChangeReason>) => void
  onSelect?: ListOptions["onSelect"]
  /** Rows as data, rendered by `renderItem`: every row is reachable by keyboard and agents, rendered or not. */
  items?: readonly Item[]
  getItemId?: (item: Item) => string
  renderItem?: (item: Item, index: number) => ReactNode
  /** A row's text, for agents and for find in page while it isn't rendered. */
  itemText?: (item: Item) => string
  /** `"auto"` (default) renders only the rows in view past 200 data rows. Rows only; cards never virtualize. */
  virtualize?: Virtualize
  /** A row's estimated height in px before it is measured. */
  estimateSize?: number
  /** Rows checked for a bulk action: Space or `x` on a row toggles it, and each row shows a checkbox. */
  checkedIds?: readonly string[]
  onCheckedIdsChange?: (ids: string[]) => void
  /** Rows reorder by a handle (drag, or Space and arrows). Needs data rows and no `value`; never virtualizes. */
  sortable?: boolean
  /** The new order of the row ids; pass `items` back in it. `details.cancel()` keeps the old one. */
  onReorder?: ListSortableRowsProps["onReorder"]
  /** The drag handle's name and what screen readers hear while a row moves. */
  sortableLabels?: ListSortableRowsProps["labels"]
  /**
   * The actions a row offers, by its id: buttons after its content that run without choosing the row. The list
   * becomes a grid (one tab stop; Left and Right reach a row's actions), and agents get one component per action
   * whose `run(id)` takes the row's id.
   */
  rowActions?: (id: string) => readonly ListRowAction[] | undefined
  /** `hover` (default) shows a row's actions on a fine pointer while it's hovered, focused or selected. */
  rowActionsVisibility?: ListRowActionsVisibility
  /** Names of the rows' action buttons and of the actions for agents. */
  rowActionLabels?: Partial<ListRowActionLabels>
  children?: ReactNode
}

function rootAttributes(variant: ListVariant, selectable: boolean, grid: boolean) {
  return {
    "data-slot": "list",
    "data-variant": variant,
    "data-selectable": selectable ? "" : undefined,
    "data-row-actions": grid ? "" : undefined,
  }
}

type ItemFunctions = {
  getId: (item: unknown) => string
  itemText: (item: unknown) => string
  renderItem?: (item: unknown, index: number) => ReactNode
}

type PartRenderProps = Parameters<Exclude<RenderProp, ReactElement>>[0]

type ListRowProps<Item> = {
  item: Item
  index: number
  setsize?: number
  measure?: ListItemPosition["measure"]
  renderItem: (item: Item, index: number) => ReactNode
}

// Perf: memoized row so rows in view don't re-render on scroll.
const MemoListRow = memo(function ListRow<Item>({ item, index, setsize, measure, renderItem }: ListRowProps<Item>) {
  const position = useMemo(
    () => (setsize === undefined ? null : { index, setsize, measure }),
    [index, setsize, measure],
  )
  return <PositionContext value={position}>{renderItem(item, index)}</PositionContext>
})
// Workaround: `memo` drops the row's type parameter; this gives it back.
const ListRow = assumeType<<Item>(props: ListRowProps<Item>) => ReactNode>(MemoListRow)

function List<Item = unknown>({
  "aria-label": label,
  variant = "row",
  value,
  defaultValue,
  onValueChange,
  onSelect,
  items,
  getItemId = defaultId,
  renderItem: renderItemProp,
  itemText: itemTextProp = defaultText,
  virtualize = "auto",
  estimateSize,
  checkedIds,
  onCheckedIdsChange,
  sortable = false,
  onReorder,
  sortableLabels,
  rowActions,
  rowActionsVisibility = "hover",
  rowActionLabels,
  className,
  children,
  onFocus,
  ...props
}: ListProps<Item>) {
  const selectable = value !== undefined || defaultValue !== undefined || onValueChange !== undefined
  const handles = useRef(new Map<string, ItemHandle>())
  const [registered, setRegistered] = useState<ListEntry[]>([])
  const [listbox] = useState(() => createListboxController<string>())

  const childRows = useMemo(
    () => (items === undefined && variant === "row" ? childRowsOf(children) : undefined),
    [items, variant, children],
  )
  const data: readonly unknown[] | undefined = items ?? childRows
  // Workaround: TypeScript can't relate `items` to the functions that read them, so they are typed by what `data` holds.
  const itemFunctions = assumeType<ItemFunctions>({
    getId: getItemId,
    itemText: itemTextProp,
    renderItem: renderItemProp,
  })
  const getId = childRows ? childId : itemFunctions.getId
  const itemText = childRows ? childText : itemFunctions.itemText
  const renderItem = childRows ? renderChild : itemFunctions.renderItem

  const ids = useMemo(() => data?.map(getId), [data, getId])
  const indexOf = useMemo(() => new Map(ids?.map((id, index) => [id, index])), [ids])
  const dataEntries = useMemo(
    () => data?.map((item, index) => ({ value: ids?.[index] ?? "", label: itemText(item) })),
    [data, ids, itemText],
  )

  const keyAt = useCallback((index: number) => ids?.[index] ?? String(index), [ids])
  const textAt = useCallback(
    (index: number) => (data?.[index] === undefined ? "" : itemText(data[index])),
    [data, itemText],
  )
  const sorting = sortable && !selectable && data !== undefined && renderItem !== undefined
  const { anchor, ...virtual } = useVirtualRows({
    count: data?.length ?? 0,
    findable: textAt,
    virtualize: renderItem && variant === "row" && !sorting ? virtualize : false,
    estimateSize,
    getKey: keyAt,
  })

  const fromData = data !== undefined
  const refresh = useCallback(() => {
    if (fromData) return
    setRegistered([...handles.current].map(([id, handle]) => ({ value: id, label: handle.label })))
  }, [fromData])

  const entries = dataEntries ?? registered
  const grid = rowActions !== undefined && !sorting
  const rowIds = useMemo(() => ids ?? entries.map((entry) => entry.value), [ids, entries])

  const handle = usePrimitive(list, {
    entries,
    onSelect,
    activate: (id) => {
      if (grid && selectable) return gridHandle.api.setValue(id)
      if (selectable) return listbox.setValue(id)
      const index = indexOf.get(id)
      if (!handles.current.has(id) && index !== undefined) virtual.renderNow(index)
      return handles.current.get(id)?.activate() ?? false
    },
  })

  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds])
  const checked = useMemo(
    () =>
      onCheckedIdsChange && checkedIds
        ? {
            has: (id: string) => checkedSet.has(id),
            toggle: (id: string) =>
              onCheckedIdsChange(
                checkedSet.has(id) ? checkedIds.filter((checkedId) => checkedId !== id) : [...checkedIds, id],
              ),
          }
        : undefined,
    [checkedIds, checkedSet, onCheckedIdsChange],
  )

  const gridHandle = useListGridInstance({
    ids: rowIds,
    cells: (id) => 1 + (rowActions?.(id)?.length ?? 0),
    selectable: grid && selectable,
    value,
    defaultValue,
    onValueChange,
    entries,
    onToggle: checked ? (id) => checked.toggle(id) : undefined,
    reveal: (id) => {
      const index = indexOf.get(id)
      if (index !== undefined) virtual.scrollToIndex(index)
    },
  })

  const actions = useListRowActions({ rowActions, entries, labels: rowActionLabels, visibility: rowActionsVisibility })

  const navigation = useRowNavigation({
    ids,
    onToggle: checked ? (id) => checked.toggle(id) : undefined,
    reveal: (id) => {
      const index = indexOf.get(id)
      if (index !== undefined) virtual.scrollToIndex(index)
    },
  })

  const sortableContext = useMemo(() => (sorting ? { labels: sortableLabels } : undefined), [sorting, sortableLabels])
  const context = useMemo<ListContextValue>(
    () => ({
      variant,
      selectable,
      grid,
      checked,
      sortable: sortableContext,
      register: (id, item) => {
        handles.current.set(id, item)
        refresh()
        return () => {
          if (handles.current.get(id) === item) handles.current.delete(id)
          refresh()
        }
      },
      select: (id, event) => handle.api.select(id, { reason: "item-press", event }),
    }),
    [variant, selectable, grid, checked, sortableContext, refresh, handle],
  )

  let rows: ReactNode = children
  if (sorting && data && renderItem && ids) {
    rows = (
      <ListSortableRows
        label={label}
        grid={variant === "card"}
        ids={ids}
        indexOf={indexOf}
        textAt={textAt}
        checkedIds={checkedIds}
        onCheckedIdsChange={onCheckedIdsChange}
        onReorder={onReorder}
        labels={sortableLabels}
        renderRow={(index) => {
          const item = data[index]
          return item === undefined ? null : (
            <ListRow key={ids[index]} item={item} index={index} renderItem={renderItem} />
          )
        }}
      />
    )
  } else if (data && renderItem) {
    const GapTag = selectable || grid ? "div" : "li"
    rows = virtual.segments.map((segment) => {
      if (segment.type === "gap") {
        return <GapTag key={segment.key} aria-hidden="true" data-slot="list-gap" style={{ height: segment.size }} />
      }
      const item = data[segment.index]
      if (item === undefined) return null
      return (
        <ListRow
          key={segment.key}
          item={item}
          index={segment.index}
          setsize={virtual.enabled ? data.length : undefined}
          measure={virtual.measureElement}
          renderItem={renderItem}
        />
      )
    })
  }

  const rootProps = {
    ...props,
    ...rootAttributes(variant, selectable, grid),
    ref: anchor,
    "aria-label": label,
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      onFocus?.(event)
      if (!virtual.enabled || !(event.target instanceof Element)) return
      const index = Number(event.target.closest<HTMLElement>("[data-index]")?.dataset.index ?? Number.NaN)
      if (!Number.isNaN(index)) virtual.pin(index)
    },
    className: cn("min-w-0", containerClassNames[variant], virtual.enabled && "relative", className),
  }

  const listChildren = (
    <ListContext value={context}>
      <RowActionsContext value={actions.context}>{rows}</RowActionsContext>
    </ListContext>
  )

  const partProps = grid
    ? {
        ...rootProps,
        "aria-rowcount": virtual.enabled ? data?.length : undefined,
        className: cn(rootProps.className, "outline-none"),
        children: <ListGridProvider handle={gridHandle}>{listChildren}</ListGridProvider>,
        render: (part: Record<string, unknown>) => <ListGridRoot {...part} handle={gridHandle} />,
      }
    : selectable
      ? {
          ...rootProps,
          className: cn(rootProps.className, "outline-none"),
          children: listChildren,
          render: ({ ref, ...part }: PartRenderProps) => (
            <Listbox<string>
              {...part}
              ref={ref}
              render={(listboxProps) => <div {...listboxProps} data-slot="list" />}
              controller={listbox}
              value={value}
              defaultValue={defaultValue}
              onValueChange={onValueChange}
              onHighlight={(_value, details) => {
                if (virtual.enabled && details.index >= 0) virtual.scrollToIndex(details.index)
              }}
              onKeyDownCapture={(event) => listboxKeyDown(event, (id) => listbox.setValue(id))}
            />
          ),
        }
      : {
          ...rootProps,
          // Workaround: Safari drops list semantics under Preflight's list-style: none unless the role is explicit.
          role: sorting ? "group" : "list",
          className: sorting ? cn("min-w-0", className) : rootProps.className,
          children: (
            <ListContext value={context}>
              <RowActionsContext value={actions.context}>
                <RowNavigationProvider handle={navigation}>{rows}</RowNavigationProvider>
              </RowActionsContext>
            </ListContext>
          ),
        }

  const tag: "div" | "ul" = selectable || sorting || grid ? "div" : "ul"
  const root = usePart(handle, "root", {}, partProps, tag)
  if (!actions.roots) return root
  // Spec: a grid or list owns only rows, so the action roots render outside it.
  return (
    <>
      {root}
      {actions.roots}
    </>
  )
}

export { containerClassNames, List, useListContext, useListItemPosition }
export type { ItemHandle, ListItemPosition, ListProps, ListVariant }
