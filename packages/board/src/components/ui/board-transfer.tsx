"use client"

import type { TransferLists } from "@ui-sdk/core"
import { createParts } from "@ui-sdk/react/primitive"
import { GripVerticalIcon } from "lucide-react"
import { createContext, use, useRef, type ComponentProps, type ReactNode, type RefObject } from "react"

import { boardTransfer, type BoardTransferOptions } from "@/components/ui/board-transfer-primitive"
import { transferLabels, type TransferLabels } from "@/components/ui/sortable-labels"
import { useFlip } from "@/components/ui/use-flip"
import { cn, cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

const Parts = createParts(boardTransfer, {
  root: "div",
  list: "div",
  card: "div",
  handle: "button",
  instructions: "div",
})

const BoardListsContext = createContext<TransferLists | null>(null)

/** The lists to render: the draft's while a card moves; null when the board doesn't move cards. */
function useBoardLists() {
  return use(BoardListsContext)
}

type BoardTransferProps = BoardTransferOptions & {
  "aria-label"?: string
  "aria-labelledby"?: string
  className?: string
  children: ReactNode
}

const rootClassNameCarryingFlipMotionTokens =
  "group/board-transfer min-w-0 transition-none duration-panel ease-standard"

function BoardTransfer({ children, className, labels, ...props }: BoardTransferProps) {
  const root = useRef<HTMLDivElement>(null)
  const text = { ...transferLabels, ...labels }
  return (
    <Parts.Root ref={root} labels={labels} className={cn(rootClassNameCarryingFlipMotionTokens, className)} {...props}>
      {(state: { lists: TransferLists }) => (
        <>
          <FlipLists root={root} lists={state.lists} />
          <BoardListsContext value={state.lists}>{children}</BoardListsContext>
          <Parts.Instructions>{text.instructions}</Parts.Instructions>
        </>
      )}
    </Parts.Root>
  )
}

function FlipLists({ root, lists }: { root: RefObject<HTMLDivElement | null>; lists: TransferLists }) {
  useFlip(root, "[data-transfer-item]", JSON.stringify(lists))
  return null
}

function BoardList({ className, ...props }: ComponentProps<typeof Parts.List>) {
  return (
    <Parts.List
      className={cnState(
        "flex min-h-control flex-col gap-items rounded-control group-data-moving/board-transfer:data-target:bg-accent/40",
        className,
      )}
      {...props}
    />
  )
}

const cardVariantClassNames = {
  card: "flex items-start gap-inline border bg-card px-inset-item py-inset-item text-body-sm text-card-foreground shadow-surface",
  plain: "",
} as const

type BoardItemProps = ComponentProps<typeof Parts.Card> & {
  /** `card` (default) draws a card around the content; `plain` leaves it to the content, like a `TaskCard`. */
  variant?: keyof typeof cardVariantClassNames
}

/** A card that moves between the board's columns: drag it, or press Space on it (or its handle) and use the arrows. */
function BoardItem({ className, variant = "card", ...props }: BoardItemProps) {
  return (
    <Parts.Card
      className={cnState(
        cn(
          "relative min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring data-disabled:opacity-60 data-moving:ring-2 data-moving:ring-ring data-grabbed:opacity-40 not-group-data-handle/board-transfer:cursor-grab not-group-data-handle/board-transfer:touch-none not-group-data-handle/board-transfer:select-none",
          cardVariantClassNames[variant],
        ),
        className,
      )}
      {...props}
    />
  )
}

type BoardItemHandleProps = Omit<ComponentProps<typeof Parts.Handle>, "value"> & {
  /** The card's name; the handle is called `labels.handle(label)`. */
  label?: string
  labels?: Partial<TransferLabels>
  value?: string
}

function BoardItemHandle({ className, label, labels, children, ...props }: BoardItemHandleProps) {
  const text = { ...transferLabels, ...labels }
  return (
    <Parts.Handle
      aria-label={label === undefined ? undefined : text.handle(label)}
      className={cnState(
        "touch-target relative z-10 inline-flex size-control-sm shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-moving:bg-accent data-moving:text-accent-foreground [&_svg]:size-4",
        className,
      )}
      // Workaround: UI SDK's Handle part type requires `value`, though it fills it from the enclosing card.
      {...assumeType<ComponentProps<typeof Parts.Handle>>(props)}
    >
      {children ?? <GripVerticalIcon />}
    </Parts.Handle>
  )
}

export { BoardItem, BoardItemHandle, BoardList, BoardTransfer, useBoardLists }
export type { BoardItemHandleProps, BoardItemProps, BoardTransferProps }
