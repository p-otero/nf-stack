/**
 * The T3 Code app mark from `assets/prod/logo.svg` (the favicon and app icon) in
 * https://github.com/pingdotgg/t3code, MIT licensed (see that repository's LICENSE).
 * The dark variant inverts its fills.
 */
import { useColorScheme } from "@/components/nf/color-scheme";
import { cn } from "@/lib/utils";

const MARK = {
  viewBox: "0 0 128 128",
  background:
    "M0 10C0 4.47715 4.47715 0 10 0H118C123.523 0 128 4.47715 128 10V118C128 123.523 123.523 128 118 128H10C4.47715 128 0 123.523 0 118V10Z",
  glyph:
    "M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z",
} as const;

const FILL = {
  light: { background: "#000000", glyph: "#FFFFFF" },
  dark: { background: "#F5F5F5", glyph: "#0F0F0F" },
} as const;

/** The T3 Code app mark in the page's theme, sized where a button sets its icons. */
function T3Logo({ className }: { className?: string }) {
  const fill = FILL[useColorScheme()];
  return (
    <svg
      data-slot="t3-logo"
      viewBox={MARK.viewBox}
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <path d={MARK.background} fill={fill.background} />
      <path d={MARK.glyph} fill={fill.glyph} />
    </svg>
  );
}

export { T3Logo };
