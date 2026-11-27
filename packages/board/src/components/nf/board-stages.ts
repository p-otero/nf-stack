import type { TaskStage } from "@nf/contracts";
import type { Stage } from "@/components/ui/stage-track";
import { tones, type Tone } from "@/lib/tone";

const toneOf = (value: string | undefined): Tone | undefined =>
  tones.find((tone) => tone === value);

const asStage = (stage: TaskStage): Stage => {
  const tone = toneOf(stage.tone);
  return tone === undefined
    ? { id: stage.id, label: stage.label }
    : { id: stage.id, label: stage.label, tone };
};

/** The project's stages in order, for the cards' pills, the detail's track and the stage filter. */
export const boardStages = (stages: readonly TaskStage[]): Stage[] => stages.map(asStage);
