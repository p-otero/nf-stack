"use client"

import type { ComponentProps } from "react"

import type { Stage, StageSize } from "@/components/ui/stage-track"
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group"
import type { Tone } from "@/lib/tone"
import { cnState } from "@/lib/utils"

const dotClassNames = {
  default: "bg-primary",
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  violet: "bg-violet",
} satisfies Record<Tone | "default", string>

type StageFilterProps = Omit<ComponentProps<typeof ToggleGroup<string>>, "children" | "multiple" | "orientation"> & {
  stages: readonly Stage[]
  /** How many items are in each stage, by stage id (and by `noStage.value`). */
  counts?: Readonly<Record<string, number>>
  /** A last toggle for items in no stage, drawn with a hollow dot. */
  noStage?: { value: string; label: string }
  /** Several stages at once (the default), or one, which pressing again clears. */
  multiple?: boolean
  size?: StageSize
  locale?: string
}

function StageFilter({
  stages,
  counts,
  noStage,
  multiple = true,
  size = "md",
  locale,
  className,
  ...props
}: StageFilterProps) {
  const format = new Intl.NumberFormat(locale)
  const options = [
    ...stages.map((stage) => ({ value: stage.id, label: stage.label, dot: dotClassNames[stage.tone ?? "default"] })),
    ...(noStage
      ? [{ value: noStage.value, label: noStage.label, dot: "border border-current text-muted-foreground" }]
      : []),
  ]
  return (
    <ToggleGroup<string>
      multiple={multiple}
      data-slot="stage-filter"
      className={cnState("flex-wrap", className)}
      {...props}
    >
      {options.map((option) => {
        const count = counts?.[option.value]
        return (
          <Toggle
            key={option.value}
            value={option.value}
            variant="outline"
            size={size === "sm" ? "sm" : "default"}
            data-stage={option.value}
            data-no-stage={option.value === noStage?.value ? "" : undefined}
            className="group/stage"
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full group-data-pressed/stage:bg-current group-data-pressed/stage:text-current ${option.dot}`}
            />
            {option.label}
            {count !== undefined && (
              <>
                {" "}
                <span className="text-caption font-normal text-muted-foreground tabular-nums group-data-pressed/stage:text-primary-foreground">
                  {format.format(count)}
                </span>
              </>
            )}
          </Toggle>
        )
      })}
    </ToggleGroup>
  )
}

export { StageFilter }
export type { StageFilterProps }
