"use client"

import { ClockIcon } from "lucide-react"

import {
  NO_STAGE,
  activeFilters,
  type FilterControl,
  type FilterOptions,
  type TaskFilters,
} from "@/lib/agent-task-board-model"
import { formatInstant } from "@/lib/time"
import type { AgentTaskBoardController, BoardView } from "@/components/ui/agent-task-board-primitive"
import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { SearchField } from "@/components/ui/search-field"
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StageFilter, type Stage } from "@/components/ui/stage-track"
import { recordOf } from "@/lib/narrow"

type ChoiceKey = "project" | "profile" | "model"

const choiceSources = { project: "projects", profile: "profiles", model: "models" } as const
const anyLabel = { project: "allProjects", profile: "anyProfile", model: "anyModel" } as const

type FilterSelectProps = {
  name: ChoiceKey
  options: FilterOptions
  filters: TaskFilters
  labels: AgentTaskBoardLabels
  controller: AgentTaskBoardController
}

const ANY = ""

function FilterSelect({ name, options, filters, labels, controller }: FilterSelectProps) {
  const items = [
    { value: ANY, label: labels.filters[anyLabel[name]] },
    ...options[choiceSources[name]].map((value) => ({ value, label: value })),
  ]
  return (
    <Field className="min-w-40 flex-1">
      <FieldLabel>{labels.filters[name]}</FieldLabel>
      <Select
        items={items}
        value={filters[name] ?? ANY}
        onValueChange={(value) => controller.filter({ [name]: value || null }, { reason: "item-press" })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="min-w-0 truncate">{item.label}</span>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

type AgentTaskBoardToolbarProps = {
  options: FilterOptions
  filters: TaskFilters
  view: BoardView
  labels: AgentTaskBoardLabels
  controller: AgentTaskBoardController
  /** Shown as the snapshot banner. */
  generatedAt?: string
  locale?: string
  timeZone?: string
  /** Shows a row of stage toggles when set. */
  stages?: readonly Stage[]
  /** Tasks per stage id under the other filters. */
  stageCounts?: Readonly<Record<string, number>>
  /** Adds the "No stage" toggle. */
  noStage?: boolean
  /** The filter controls that show; "Clear filters" clears only these. */
  controls: readonly FilterControl[]
}

const clearedFilters = (controls: readonly FilterControl[]) => recordOf(controls, () => null)

function AgentTaskBoardToolbar({
  options,
  filters,
  view,
  labels,
  controller,
  generatedAt,
  locale,
  timeZone,
  stages,
  stageCounts,
  noStage,
  controls,
}: AgentTaskBoardToolbarProps) {
  const filtered = activeFilters(filters, controls).length > 0
  const choices = (["project", "profile", "model"] as const).filter(
    (name) => controls.includes(name) && options[choiceSources[name]].length > 0,
  )
  const search = controls.includes("query")
  return (
    <div data-slot="agent-task-board-toolbar" className="@container/agent-task-board-toolbar flex flex-col gap-items">
      <div className="flex flex-wrap items-center justify-between gap-items">
        {generatedAt && (
          <p
            data-slot="agent-task-board-snapshot"
            className="flex items-center gap-inline text-sm text-muted-foreground"
          >
            <ClockIcon className="size-4" />
            <time dateTime={generatedAt}>{labels.snapshot(formatInstant(generatedAt, { locale, timeZone }))}</time>
          </p>
        )}
        <SegmentedControl<BoardView>
          aria-label={labels.views.group}
          className="ml-auto"
          value={view}
          onValueChange={(next) => next && controller.setView(next, { reason: "item-press" })}
        >
          <SegmentedControlIndicator />
          <SegmentedControlItem value="board">{labels.views.board}</SegmentedControlItem>
          <SegmentedControlItem value="table">{labels.views.table}</SegmentedControlItem>
          <SegmentedControlItem value="backlog">{labels.views.backlog}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {(search || choices.length > 0) && (
        <div className="flex">
          <fieldset aria-label={labels.filters.group} className="flex min-w-0 flex-1 flex-wrap items-end gap-items">
            {search && (
              <SearchField
                label={labels.filters.search}
                clearLabel={labels.filters.clearSearch}
                placeholder={labels.filters.searchPlaceholder}
                value={filters.query ?? ""}
                onValueChange={(value) => controller.filter({ query: value || null }, { reason: "input-change" })}
                className="min-w-56 flex-2"
              />
            )}
            {choices.map((name) => (
              <FilterSelect
                key={name}
                name={name}
                options={options}
                filters={filters}
                labels={labels}
                controller={controller}
              />
            ))}
            {filtered && (
              <Button
                variant="ghost"
                onClick={() => controller.filter(clearedFilters(controls), { reason: "clear-press" })}
              >
                {labels.filters.clear}
              </Button>
            )}
          </fieldset>
        </div>
      )}
      {controls.includes("stage") && stages && stages.length > 0 && (
        <StageFilter
          aria-label={labels.filters.stage}
          stages={stages}
          counts={stageCounts}
          noStage={noStage ? { value: NO_STAGE, label: labels.filters.noStage } : undefined}
          size="sm"
          locale={locale}
          value={filters.stage ?? []}
          onValueChange={(value) =>
            controller.filter({ stage: value.length > 0 ? value : null }, { reason: "item-press" })
          }
        />
      )}
    </div>
  )
}

export { AgentTaskBoardToolbar, clearedFilters }
export type { AgentTaskBoardToolbarProps }
