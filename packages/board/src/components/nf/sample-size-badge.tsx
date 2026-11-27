import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SAMPLE_SIZE, sampleSizeLevel } from "@/components/nf/telemetry-config";

type SampleSizeBadgeProps = {
  /** Accepted tasks with a first-pass verdict: the rate's denominator. */
  n: number;
  className?: string;
};

/**
 * Marks a rate whose sample is too small to read as a ranking; long samples show nothing. Without
 * verdicts there is no rate to qualify, so no badge either.
 */
function SampleSizeBadge({ n, className }: SampleSizeBadgeProps) {
  const level = n > 0 ? sampleSizeLevel(n) : null;
  if (level === null) return null;
  const threshold = level === "indicative" ? SAMPLE_SIZE.INDICATIVE : SAMPLE_SIZE.LOW;
  const hint = `${n} of fewer than ${threshold}: the rate is ${level}`;
  return (
    <Badge
      variant={level === "indicative" ? "warning" : "secondary"}
      title={hint}
      className={cn("shrink-0 font-normal", className)}
    >
      <span aria-hidden="true">n {n}</span>
      <span className="sr-only">{hint}</span>
    </Badge>
  );
}

export { SampleSizeBadge };
export type { SampleSizeBadgeProps };
