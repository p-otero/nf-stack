"use client"

import { Meter, MeterTrack } from "@ui-sdk/react/meter"
import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import type { ComponentProps, ReactNode } from "react"
import { CheckIcon, CircleDashedIcon, XIcon, type LucideIcon } from "lucide-react"

import { Collapsible, CollapsibleIcon, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger, type PopoverProps } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type AcceptanceResult = "pass" | "fail" | "unverified"

interface AcceptanceCriterion {
  id?: string
  text: string
  result: AcceptanceResult
  evidence?: ReactNode
}

type AcceptanceCounts = Record<AcceptanceResult, number>

interface AcceptanceLabels extends Record<AcceptanceResult, string> {
  bar: string
  /** The visible label of `AcceptancePopover`'s trigger and its popover's title. */
  title: string
}

const defaultAcceptanceLabels: AcceptanceLabels = {
  pass: "Passed",
  fail: "Failed",
  unverified: "Not verified",
  bar: "Acceptance criteria",
  title: "Acceptance",
}

const results: AcceptanceResult[] = ["pass", "fail", "unverified"]

const resultColor: Record<AcceptanceResult, string> = {
  pass: "text-success",
  fail: "text-destructive",
  unverified: "text-muted-foreground",
}

const segmentColor: Record<AcceptanceResult, string> = {
  pass: "bg-success",
  fail: "bg-destructive",
  unverified: "bg-muted-foreground",
}

const resultIcons: Record<AcceptanceResult, LucideIcon> = {
  pass: CheckIcon,
  fail: XIcon,
  unverified: CircleDashedIcon,
}

function countAcceptance(criteria: readonly Pick<AcceptanceCriterion, "result">[]): AcceptanceCounts {
  const counts: AcceptanceCounts = { pass: 0, fail: 0, unverified: 0 }
  for (const { result } of criteria) counts[result]++
  return counts
}

function formatAcceptanceSummary({ pass, fail, unverified }: AcceptanceCounts) {
  const summary = `${pass} of ${pass + fail + unverified} passed`
  return fail > 0 ? `${summary}, ${fail} failed` : summary
}

function AcceptanceIcon({ result }: { result: AcceptanceResult }) {
  const ResultIcon = resultIcons[result]
  return <ResultIcon strokeWidth={2.5} className={cn("h-lh w-4 shrink-0", resultColor[result])} />
}

type AcceptanceListProps = Omit<PartProps<"ul">, "children"> & {
  criteria: readonly AcceptanceCriterion[]
  labels?: Partial<AcceptanceLabels>
  /** `"disclosure"` keeps each criterion to one row and reveals its evidence on demand. */
  evidence?: "inline" | "disclosure"
}

function AcceptanceList({
  criteria,
  labels,
  evidence: evidenceMode = "inline",
  className,
  render,
  ...props
}: AcceptanceListProps) {
  const text = { ...defaultAcceptanceLabels, ...labels }
  return renderElement(
    "ul",
    {
      "data-slot": "acceptance-list",
      // Preflight's list-style: none strips list semantics in Safari unless the role is explicit.
      role: "list",
      className: cn("flex flex-col gap-items text-sm", className),
      ...props,
      children: criteria.map((criterion) => (
        <li
          key={criterion.id ?? criterion.text}
          data-slot="acceptance-item"
          data-result={criterion.result}
          className="flex gap-inline"
        >
          <AcceptanceIcon result={criterion.result} />
          {criterion.evidence && evidenceMode === "disclosure" ? (
            <Collapsible className="min-w-0 flex-1">
              <CollapsibleTrigger className="min-h-0 w-full justify-between rounded-sm px-0 text-start font-normal hover:bg-transparent hover:text-foreground hover:underline">
                <span className="min-w-0">
                  <span className="sr-only">{text[criterion.result]}</span>
                  {criterion.text}
                </span>
                <CollapsibleIcon className="text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <p data-slot="acceptance-evidence" className="pt-inline text-xs text-muted-foreground">
                  {criterion.evidence}
                </p>
              </CollapsiblePanel>
            </Collapsible>
          ) : (
            <div className="flex min-w-0 flex-col gap-inline">
              <span className="sr-only">{text[criterion.result]}</span>
              <span>{criterion.text}</span>
              {criterion.evidence ? (
                <span data-slot="acceptance-evidence" className="text-xs text-muted-foreground">
                  {criterion.evidence}
                </span>
              ) : null}
            </div>
          )}
        </li>
      )),
    },
    render,
  )
}

type AcceptanceBarProps = Omit<ComponentProps<typeof Meter>, "value" | "max" | "min" | "children"> & {
  counts: AcceptanceCounts
  labels?: Partial<Pick<AcceptanceLabels, "bar">>
  formatSummary?: (counts: AcceptanceCounts) => string
}

function AcceptanceBar({
  counts,
  labels,
  formatSummary = formatAcceptanceSummary,
  className,
  ...props
}: AcceptanceBarProps) {
  const total = counts.pass + counts.fail + counts.unverified
  return (
    <Meter
      value={counts.pass}
      max={Math.max(total, 1)}
      aria-label={labels?.bar ?? defaultAcceptanceLabels.bar}
      getValueLabel={() => formatSummary(counts)}
      className={cn("w-full", className)}
      {...props}
    >
      <MeterTrack className="flex h-2 w-full gap-px overflow-hidden rounded-control bg-muted">
        {results.map((result) =>
          counts[result] > 0 ? (
            <div
              key={result}
              data-slot="acceptance-segment"
              data-result={result}
              className={cn("h-full basis-0", segmentColor[result])}
              style={{ flexGrow: counts[result] }}
            />
          ) : null,
        )}
      </MeterTrack>
    </Meter>
  )
}

type AcceptancePopoverProps = Omit<PopoverProps, "children"> & {
  criteria: readonly AcceptanceCriterion[]
  labels?: Partial<AcceptanceLabels>
  /** The counts in the trigger's accessible name, after the title: "Acceptance: 1 of 3 passed, 1 failed". */
  formatSummary?: (counts: AcceptanceCounts) => string
  /** Classes for the trigger, a ghost button. */
  className?: string
  /** Classes for the popover. */
  contentClassName?: string
}

/**
 * The acceptance summary for a header: a label, a thin bar and `n/m` as a button that opens the list of criteria
 * with their evidence. It opens on hover too, without moving focus; a press, Enter or a tap opens it and moves focus
 * in.
 */
function AcceptancePopover({
  criteria,
  labels,
  formatSummary = formatAcceptanceSummary,
  className,
  contentClassName,
  openOnHover = true,
  delay = 300,
  closeDelay = 200,
  ...props
}: AcceptancePopoverProps) {
  const text = { ...defaultAcceptanceLabels, ...labels }
  const counts = countAcceptance(criteria)
  return (
    <Popover openOnHover={openOnHover} delay={delay} closeDelay={closeDelay} {...props}>
      <PopoverTrigger
        variant="ghost"
        aria-label={`${text.title}: ${formatSummary(counts)}`}
        tooltip={false}
        className={cn("h-auto flex-col items-start gap-inline px-inset-chip py-inset-chip", className)}
      >
        <span className="text-xs font-normal text-muted-foreground">{text.title}</span>
        <span className="flex w-44 items-center gap-inline">
          <AcceptanceBar counts={counts} labels={text} aria-hidden className="min-w-0 flex-1" />
          <span className="text-sm tabular-nums">
            {counts.pass}/{criteria.length}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent className={cn("w-md", contentClassName)}>
        <PopoverTitle>{text.title}</PopoverTitle>
        <AcceptanceList criteria={criteria} labels={text} evidence="inline" />
      </PopoverContent>
    </Popover>
  )
}

export {
  AcceptanceBar,
  AcceptanceList,
  AcceptancePopover,
  countAcceptance,
  defaultAcceptanceLabels,
  formatAcceptanceSummary,
}
export type {
  AcceptanceBarProps,
  AcceptancePopoverProps,
  AcceptanceCounts,
  AcceptanceCriterion,
  AcceptanceLabels,
  AcceptanceListProps,
  AcceptanceResult,
}
