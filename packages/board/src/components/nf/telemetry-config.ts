/** How small a sample the board labels as such: the view carries `n`, the judgement is here. */
export const SAMPLE_SIZE = {
  /** Below this many verdicts a first-pass rate is only indicative. */
  INDICATIVE: 10,
  /** Below this many it is low: comparable with care, never as a ranking. */
  LOW: 30,
} as const;

export type SampleSizeLevel = "indicative" | "low";

export function sampleSizeLevel(n: number): SampleSizeLevel | null {
  if (n < SAMPLE_SIZE.INDICATIVE) return "indicative";
  if (n < SAMPLE_SIZE.LOW) return "low";
  return null;
}

/** The groupings the telemetry tab and its two task charts switch between. */
export type TelemetryGrouping = "strategy" | "model" | "coordinator";

/** The two ways the cache card reads the cached input. */
export type TelemetryCacheGrouping = "contexts" | "models";
