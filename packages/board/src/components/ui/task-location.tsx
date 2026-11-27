"use client"

import type { TaskLocation } from "@/lib/agent-task-types"
import { StagePill, StageTrack, type Stage } from "@/components/ui/stage-track"

/** The board's stage with this id, or one named after the id when the board doesn't list it. */
function stageOf(stages: readonly Stage[] | undefined, id: string): Stage {
  return stages?.find((stage) => stage.id === id) ?? { id, label: id }
}

type TaskLocationTrackProps = {
  location: TaskLocation
  stages?: readonly Stage[]
  "aria-label": string
}

/** Every stage with the task's marked, or only its pill when the board lists no stage it's in. */
function TaskLocationTrack({ location, stages, "aria-label": label }: TaskLocationTrackProps) {
  if (!stages?.some((stage) => stage.id === location.stage)) {
    return <StagePill stage={stageOf(stages, location.stage)} href={location.href} className="self-start" />
  }
  return (
    <StageTrack
      aria-label={label}
      stages={stages}
      current={location.stage}
      variant="track"
      getHref={(stage) => (stage.id === location.stage ? location.href : undefined)}
    />
  )
}

export { TaskLocationTrack, stageOf }
