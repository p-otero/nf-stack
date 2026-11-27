"use client"

import { ListboxGroup, ListboxGroupLabel } from "@ui-sdk/react/listbox"
import { useId, type ReactNode } from "react"

import { containerClassNames, useListContext } from "@/components/ui/list-context"
import { cn } from "@/lib/utils"

type ListGroupProps = {
  label: ReactNode
  /** Shown beside the label, like "Proposed 3". */
  count?: number
  className?: string
  children: ReactNode
}

const groupLabelClassName =
  "flex items-center gap-inline px-inset-item text-meta tracking-meta text-muted-foreground uppercase"

function ListGroup({ label, count, className, children }: ListGroupProps) {
  const context = useListContext()
  const labelId = useId()
  const variant = context?.variant ?? "row"
  const heading = (
    <>
      {label}
      {count !== undefined && (
        <>
          {" "}
          <span className="tabular-nums">{count}</span>
        </>
      )}
    </>
  )
  if (context?.grid) {
    // The label stays out of the rows, which a row group alone may hold; it names the group by reference.
    return (
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of flex rows, not a table
        role="rowgroup"
        aria-labelledby={labelId}
        data-slot="list-group"
        className={cn("flex flex-col gap-inline not-first:pt-group", className)}
      >
        <div id={labelId} aria-hidden="true" className={groupLabelClassName}>
          {heading}
        </div>
        <div className={containerClassNames[variant]}>{children}</div>
      </div>
    )
  }
  if (context?.selectable) {
    return (
      <ListboxGroup
        render={<div data-slot="list-group" />}
        className={cn("flex flex-col gap-inline not-first:pt-group", className)}
      >
        <ListboxGroupLabel className={groupLabelClassName}>{heading}</ListboxGroupLabel>
        <div className={containerClassNames[variant]}>{children}</div>
      </ListboxGroup>
    )
  }
  return (
    <li data-slot="list-group" className={cn("flex flex-col gap-inline not-first:pt-group", className)}>
      <div id={labelId} className={groupLabelClassName}>
        {heading}
      </div>
      <ul aria-labelledby={labelId} className={containerClassNames[variant]}>
        {children}
      </ul>
    </li>
  )
}

export { ListGroup }
export type { ListGroupProps }
