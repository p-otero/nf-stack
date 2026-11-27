"use client"

import {
  Pagination as PaginationPrimitive,
  PaginationEllipsis as PaginationEllipsisPrimitive,
  PaginationFirst as PaginationFirstPrimitive,
  PaginationItem,
  PaginationLast as PaginationLastPrimitive,
  PaginationLink as PaginationLinkPrimitive,
  PaginationList as PaginationListPrimitive,
  PaginationNext as PaginationNextPrimitive,
  PaginationPrevious as PaginationPreviousPrimitive,
  createPaginationController,
  paginationRange,
} from "@ui-sdk/react/pagination"
import type { ComponentProps } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { ControlTooltip, type ControlTooltipOption } from "@/components/ui/tooltip"
import { cnState } from "@/lib/utils"

type PaginationLabels = {
  navigation: string
  previous: string
  next: string
  page: (page: number) => string
}

const defaultPaginationLabels: PaginationLabels = {
  navigation: "Pagination",
  previous: "Previous page",
  next: "Next page",
  page: (page) => `Page ${page}`,
}

const stepClassName = `${buttonVariants({ variant: "ghost", size: "icon" })} data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent rtl:[&_svg]:-scale-x-100`

function Chevron({ direction }: { direction: "previous" | "next" }) {
  return direction === "previous" ? <ChevronLeftIcon /> : <ChevronRightIcon />
}

type PaginationProps = ComponentProps<typeof PaginationPrimitive> & { labels?: Partial<PaginationLabels> }

function Pagination({ className, labels, children, "aria-label": ariaLabel, ...props }: PaginationProps) {
  const text = { ...defaultPaginationLabels, ...labels }
  return (
    <PaginationPrimitive
      aria-label={ariaLabel ?? text.navigation}
      className={cnState("flex w-full justify-center", className)}
      {...props}
    >
      {children ?? (
        <PaginationList>
          {({ items }) => (
            <>
              <PaginationItem>
                <PaginationPrevious aria-label={text.previous} />
              </PaginationItem>
              {items.map((item) => (
                <PaginationItem key={item}>
                  {typeof item === "number" ? (
                    <PaginationLink page={item} aria-label={text.page(item)} />
                  ) : (
                    <PaginationEllipsis />
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext aria-label={text.next} />
              </PaginationItem>
            </>
          )}
        </PaginationList>
      )}
    </PaginationPrimitive>
  )
}

function PaginationList({ className, ...props }: ComponentProps<typeof PaginationListPrimitive>) {
  return (
    <PaginationListPrimitive
      className={cnState("m-0 flex list-none flex-row flex-wrap items-center gap-inline p-0", className)}
      {...props}
    />
  )
}

function PaginationLink({ className, ...props }: ComponentProps<typeof PaginationLinkPrimitive>) {
  return (
    <PaginationLinkPrimitive
      className={cnState(
        `${buttonVariants({ variant: "ghost", size: "icon" })} tabular-nums data-current:border data-current:border-input data-current:bg-background/(--glass-opacity) data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent`,
        className,
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  children,
  tooltip,
  ...props
}: ComponentProps<typeof PaginationPreviousPrimitive> & { tooltip?: ControlTooltipOption }) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={children === undefined}>
      <PaginationPreviousPrimitive className={cnState(stepClassName, className)} {...props}>
        {children ?? <Chevron direction="previous" />}
      </PaginationPreviousPrimitive>
    </ControlTooltip>
  )
}

function PaginationNext({
  className,
  children,
  tooltip,
  ...props
}: ComponentProps<typeof PaginationNextPrimitive> & { tooltip?: ControlTooltipOption }) {
  return (
    <ControlTooltip label={props["aria-label"]} tooltip={tooltip} iconOnly={children === undefined}>
      <PaginationNextPrimitive className={cnState(stepClassName, className)} {...props}>
        {children ?? <Chevron direction="next" />}
      </PaginationNextPrimitive>
    </ControlTooltip>
  )
}

function PaginationFirst({ className, ...props }: ComponentProps<typeof PaginationFirstPrimitive>) {
  return <PaginationFirstPrimitive className={cnState(stepClassName, className)} {...props} />
}

function PaginationLast({ className, ...props }: ComponentProps<typeof PaginationLastPrimitive>) {
  return <PaginationLastPrimitive className={cnState(stepClassName, className)} {...props} />
}

function PaginationEllipsis({ className, ...props }: ComponentProps<typeof PaginationEllipsisPrimitive>) {
  return (
    <PaginationEllipsisPrimitive
      className={cnState("inline-flex size-control items-center justify-center text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Pagination,
  PaginationEllipsis,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
  createPaginationController,
  defaultPaginationLabels,
  paginationRange,
}
export type { PaginationLabels, PaginationProps }
