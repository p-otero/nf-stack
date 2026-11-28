"use client"

import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"
import { BoardNavigationProvider, useBoardNavigation } from "@/components/ui/board-navigation"
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@/components/ui/scroll-area"
import {
  BoardColumn,
  BoardColumnGroup,
  boardColumnLabels,
  type BoardColumnLabels,
  type BoardColumnProps,
  type BoardColumnGroupProps,
} from "@/components/ui/board-column"
import {
  BoardItem,
  BoardItemHandle,
  BoardList,
  BoardTransfer,
  useBoardLists,
  type BoardItemHandleProps,
  type BoardItemProps,
} from "@/components/ui/board-transfer"
import type { BoardTransferOptions } from "@/components/ui/board-transfer-primitive"
import { assumeType } from "@/lib/narrow"

export { BoardItem, BoardItemHandle, BoardColumn, BoardColumnGroup, BoardList, boardColumnLabels, useBoardLists }
export type { BoardItemHandleProps, BoardItemProps, BoardColumnLabels, BoardColumnProps, BoardColumnGroupProps }

type BoardName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }

type BoardProps = Omit<
  ComponentProps<typeof ScrollArea>,
  "aria-label" | "aria-labelledby" | "children" | "defaultValue"
> &
  BoardName &
  BoardTransferOptions & { children?: ReactNode }

const transferKeys = [
  "value",
  "defaultValue",
  "onValueChange",
  "order",
  "accepts",
  "disabledKeys",
  "handle",
  "handleFocus",
  "autoScroll",
  "itemLabel",
  "listLabel",
  "labels",
  "agentMoves",
] as const satisfies readonly (keyof BoardTransferOptions)[]

function splitTransfer<Props extends BoardTransferOptions>(props: Props) {
  const transfer: BoardTransferOptions = {}
  const rest: Record<string, unknown> = { ...props }
  for (const key of transferKeys) {
    if (key in rest) {
      Object.assign(transfer, { [key]: rest[key] })
      delete rest[key]
    }
  }
  // Workaround: TypeScript can't follow a `delete` of exactly `transferKeys` on a generic object.
  return { transfer, rest: assumeType<Omit<Props, (typeof transferKeys)[number]>>(rest) }
}

/**
 * Columns of cards. With `value` (or `defaultValue`) and `onValueChange`, cards move between columns: each
 * `BoardColumn` with a `value` renders its list's cards with its `children` function, as `BoardItem`s.
 */
function Board({
  className,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...all
}: BoardProps) {
  const { transfer, rest: props } = splitTransfer(all)
  const navigation = useBoardNavigation()
  const board = (
    <ScrollArea
      type="auto"
      className={cn("w-full", transfer.value || transfer.defaultValue ? undefined : className)}
      {...props}
    >
      <ScrollAreaViewport render={<section />} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {/* oxlint-disable-next-line p-otero/spacing-tokens -- room for the h-2 horizontal scrollbar so it never covers the columns */}
        <ScrollAreaContent render={<ul />} className="flex w-max min-w-full items-start gap-section pb-2">
          <BoardNavigationProvider handle={navigation}>{children}</BoardNavigationProvider>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="horizontal">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
  if (!transfer.value && !transfer.defaultValue) return board
  return (
    <BoardTransfer
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("w-full", className)}
      {...transfer}
    >
      {board}
    </BoardTransfer>
  )
}

export { Board }
export type { BoardProps }
