import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

type ShareBarProps = {
  /** The row's part of a total, 0..1; null when the total or the row is unknown. */
  value: number | null;
  /** What the number is a share of, for the accessible name. */
  label: string;
  /** CSS color of the fill, usually the entity's `--chart-<n>` token. */
  color?: string;
  className?: string;
};

/** A compact share of a total: the bar is decorative, the percentage is the readable value. */
function ShareBar({ value, label, color, className }: ShareBarProps) {
  const share = value === null ? null : Math.min(Math.max(value, 0), 1);
  const percent = share === null ? "—" : `${(share * 100).toFixed(share < 0.01 ? 1 : 0)}%`;
  return (
    <span
      data-slot="nf-share-bar"
      title={share === null ? `${label}: no data` : `${label}: ${percent}`}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span aria-hidden="true" className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-(--share-color)"
          style={
            {
              "--share-color": color ?? "var(--chart-1)",
              width: percent === "—" ? "0%" : percent,
            } as CSSProperties
          }
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{percent}</span>
    </span>
  );
}

export { ShareBar };
export type { ShareBarProps };
