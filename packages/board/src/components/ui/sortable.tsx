"use client"

import { createParts } from "@ui-sdk/react/primitive"
import { GripVerticalIcon } from "lucide-react"
import { createContext, use, useRef, type ComponentProps, type ReactNode, type RefObject } from "react"

import { sortableLabels, type SortableLabels } from "@/components/ui/sortable-labels"
import { sortable } from "@/components/ui/sortable-primitive"
import { useFlip } from "@/components/ui/use-flip"
import { cn, cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

const Parts = createParts(sortable, { root: "div", entry: "div", handle: "button", instructions: "div" })

type SortableState = { order: string[]; moving: boolean }
type RootProps = ComponentProps<typeof Parts.Root>
/** `card`: separate bordered items; `row`: rows edge to edge in one bordered box; `plain`: no surface, for your own. */
type SortableVariant = "card" | "row" | "plain"

type SortableProps = Omit<RootProps, "children"> & {
  /** The items, or a function of the order to render them in (the draft's while an item moves). */
  children?: ReactNode | ((state: SortableState) => ReactNode)
  labels?: Partial<SortableLabels>
  variant?: SortableVariant
}

const VariantContext = createContext<SortableVariant>("card")

function Flip({
  root,
  order,
  children,
}: {
  root: RefObject<HTMLElement | null>
  order: string[]
  children: ReactNode
}) {
  useFlip(root, "[data-sortable-item]", order.join("\n"))
  return children
}

const orientationClassNames = {
  vertical: "flex flex-col gap-items",
  horizontal: "flex flex-row flex-wrap gap-items",
  grid: "grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-items",
} as const

const rootVariantClassNames = {
  card: "",
  row: "gap-0 divide-y rounded-surface border bg-card text-card-foreground",
  plain: "",
} satisfies Record<SortableVariant, string>

function Sortable({
  className,
  children,
  labels,
  orientation = "vertical",
  variant = "card",
  ref,
  ...props
}: SortableProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const text = { ...sortableLabels, ...labels }
  return (
    <Parts.Root
      orientation={orientation}
      labels={labels}
      ref={(node: HTMLDivElement | null) => {
        root.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      className={cnState(
        cn(
          "group/sortable min-w-0 transition-none duration-panel ease-standard outline-none",
          orientationClassNames[orientation],
          rootVariantClassNames[variant],
        ),
        className,
      )}
      {...props}
    >
      {(state: SortableState) => (
        <VariantContext value={variant}>
          <Flip root={root} order={state.order}>
            {typeof children === "function" ? children(state) : children}
          </Flip>
          <Parts.Instructions>{text.instructions}</Parts.Instructions>
        </VariantContext>
      )}
    </Parts.Root>
  )
}

const itemVariantClassNames = {
  card: "flex items-center gap-inline rounded-lg border bg-card px-inset-item py-inset-item text-body text-card-foreground shadow-surface data-checked:border-primary",
  row: "flex items-center gap-inline bg-card px-inset-item py-inset-item text-body first:rounded-t-surface last:rounded-b-surface",
  plain: "rounded-control",
} satisfies Record<SortableVariant, string>

const itemClassName =
  "relative min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-accent data-checked:text-accent-foreground data-disabled:opacity-60 data-moving:ring-2 data-moving:ring-ring data-grabbed:z-10 data-grabbed:translate-x-(--drag-x) data-grabbed:translate-y-(--drag-y) data-grabbed:shadow-floating group-data-preview/sortable:data-grabbed:translate-none group-data-preview/sortable:data-grabbed:opacity-40 group-data-preview/sortable:data-grabbed:shadow-none not-group-data-handle/sortable:cursor-grab not-group-data-handle/sortable:touch-none not-group-data-handle/sortable:select-none"

type SortableItemProps = ComponentProps<typeof Parts.Entry>

function SortableItem({ className, ...props }: SortableItemProps) {
  const variant = use(VariantContext)
  return <Parts.Entry className={cnState(cn(itemClassName, itemVariantClassNames[variant]), className)} {...props} />
}

type SortableHandleProps = Omit<ComponentProps<typeof Parts.Handle>, "value"> & {
  /** The item's name; the handle is called `labels.handle(label)`. */
  label?: string
  labels?: Partial<SortableLabels>
  value?: string
}

function SortableHandle({ className, label, labels, children, ...props }: SortableHandleProps) {
  const text = { ...sortableLabels, ...labels }
  return (
    <Parts.Handle
      aria-label={label === undefined ? undefined : text.handle(label)}
      className={cnState(
        "touch-target inline-flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-moving:bg-accent data-moving:text-accent-foreground [&_svg]:size-4",
        className,
      )}
      // Workaround: UI SDK fills `value` from the enclosing item (the slot's `from: "entry"`), but its part type still requires it.
      {...assumeType<ComponentProps<typeof Parts.Handle>>(props)}
    >
      {children ?? <GripVerticalIcon />}
    </Parts.Handle>
  )
}

export { Sortable, SortableHandle, SortableItem }
export type { SortableHandleProps, SortableItemProps, SortableProps, SortableState, SortableVariant }
