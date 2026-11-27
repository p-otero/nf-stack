"use client"

import { Button } from "@ui-sdk/react/button"
import type { ComponentProps, ReactNode } from "react"

import { statusPillVariants, type StatusTone } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"

type DependencyChip = { id: string; label: string; tone?: StatusTone }

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }

type DependencyChipsProps = Omit<ComponentProps<"ul">, "children" | "onSelect" | "aria-label" | "aria-labelledby"> &
  AccessibleName & {
    items: readonly DependencyChip[]
    onSelect?: (id: string) => void
    max?: number
    formatMore?: (count: number) => string
    empty?: ReactNode
  }

const chipClassName = "min-w-0 max-w-48 shrink"

const pressableClassName =
  "cursor-pointer outline-none transition-colors hover:border-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50"

const formatMoreDefault = (count: number) => `${count} more`

function Chip({ item, onSelect }: { item: DependencyChip; onSelect?: (id: string) => void }) {
  const label = <span className="min-w-0 truncate">{item.label}</span>
  const className = cn(statusPillVariants({ tone: item.tone }), "min-w-0 shrink", chipClassName)
  if (!onSelect) {
    return (
      <span title={item.label} className={className}>
        {label}
      </span>
    )
  }
  return (
    <Button title={item.label} className={cn(className, pressableClassName)} onClick={() => onSelect(item.id)}>
      {label}
    </Button>
  )
}

function DependencyChips({
  items,
  onSelect,
  max,
  formatMore = formatMoreDefault,
  empty,
  className,
  ...props
}: DependencyChipsProps) {
  if (items.length === 0) return empty ?? null

  const visible = max !== undefined && items.length > max ? items.slice(0, Math.max(0, max)) : items
  const hidden = items.length - visible.length

  return (
    <ul data-slot="dependency-chips" className={cn("flex flex-wrap items-center gap-items", className)} {...props}>
      {visible.map((item) => (
        <li
          key={item.id}
          data-slot="dependency-chips-item"
          data-tone={item.tone ?? "neutral"}
          className="flex min-w-0 max-w-full"
        >
          <Chip item={item} onSelect={onSelect} />
        </li>
      ))}
      {hidden > 0 && (
        <li className="flex">
          <span
            data-slot="dependency-chips-more"
            title={items
              .slice(visible.length)
              .map((item) => item.label)
              .join(", ")}
            className={statusPillVariants({ tone: "muted" })}
          >
            <span aria-hidden="true">+{hidden}</span>
            <span className="sr-only">{formatMore(hidden)}</span>
          </span>
        </li>
      )}
    </ul>
  )
}

export { DependencyChips }
export type { DependencyChip, DependencyChipsProps }
