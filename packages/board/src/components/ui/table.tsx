"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import type { PointerEvent } from "react"

import { ScrollArea, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type TableProps = PartProps<"table"> & { containerClassName?: string }

// The UI SDK viewport becomes a tab stop only while it overflows and holds nothing focusable,
// so a narrow table stays keyboard-scrollable without adding a stop to every table.
// The viewport repeats the table's name because agents list the scroll area as a component of its own.
function Table({ className, containerClassName, render, ...props }: TableProps) {
  const label = props["aria-label"]
  const labelledBy = props["aria-labelledby"]
  return (
    // oxlint-disable-next-line p-otero/spacing-tokens -- room for the h-2.5 horizontal scrollbar so it never covers the last row
    <ScrollArea type="auto" className={cn("w-full data-overflow-x:pb-3", containerClassName)}>
      <ScrollAreaViewport
        role={label || labelledBy ? "group" : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
      >
        {renderElement(
          "table",
          { "data-slot": "table", className: cn("w-full caption-bottom text-sm", className), ...props },
          render,
        )}
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="horizontal">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}

function TableHeader({ className, render, ...props }: PartProps<"thead">) {
  return renderElement(
    "thead",
    { "data-slot": "table-header", className: cn("[&_tr]:border-b", className), ...props },
    render,
  )
}

function TableBody({ className, render, ...props }: PartProps<"tbody">) {
  return renderElement(
    "tbody",
    { "data-slot": "table-body", className: cn("[&_tr:last-child]:border-0", className), ...props },
    render,
  )
}

function TableFooter({ className, render, ...props }: PartProps<"tfoot">) {
  return renderElement(
    "tfoot",
    {
      "data-slot": "table-footer",
      className: cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className),
      ...props,
    },
    render,
  )
}

function TableRow({ className, render, ...props }: PartProps<"tr">) {
  return renderElement(
    "tr",
    { "data-slot": "table-row", className: cn("border-b transition-colors hover:bg-muted/50", className), ...props },
    render,
  )
}

function TableHead({ className, render, ...props }: PartProps<"th">) {
  return renderElement(
    "th",
    {
      "data-slot": "table-head",
      className: cn(
        "h-control px-inset-item text-start align-middle font-medium whitespace-nowrap text-muted-foreground aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground",
        className,
      ),
      ...props,
    },
    render,
  )
}

type TableCellProps = PartProps<"td"> & {
  /** Wraps long text onto more lines instead of cutting it at `max-w-80` with an ellipsis. */
  wrap?: boolean
}

// A cut-off cell shows its whole text in a native tooltip, set as the pointer arrives so cells that fit get none.
function titleIfTruncated(event: PointerEvent<HTMLTableCellElement>) {
  const cell = event.currentTarget
  cell.title = cell.scrollWidth > cell.clientWidth ? (cell.textContent ?? "") : ""
}

function TableCell({ className, render, wrap = false, onPointerEnter, ...props }: TableCellProps) {
  return renderElement(
    "td",
    {
      "data-slot": "table-cell",
      "data-wrap": wrap ? "" : undefined,
      className: cn(
        "px-inset-item py-inset-item align-middle",
        wrap ? "min-w-40 break-words whitespace-normal" : "max-w-80 truncate",
        className,
      ),
      onPointerEnter: (event: PointerEvent<HTMLTableCellElement>) => {
        onPointerEnter?.(event)
        if (!wrap && props.title === undefined) titleIfTruncated(event)
      },
      ...props,
    },
    render,
  )
}

function TableCaption({ className, render, ...props }: PartProps<"caption">) {
  return renderElement(
    "caption",
    { "data-slot": "table-caption", className: cn("mt-group text-sm text-muted-foreground", className), ...props },
    render,
  )
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
export type { TableCellProps, TableProps }
