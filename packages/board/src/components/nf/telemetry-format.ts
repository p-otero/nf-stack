import type { TelemetryFirstPass } from "@nf/contracts";
import { formatQuantity } from "@/lib/quantity";

const LOCALE = "en";

/** Costs run from fractions of a cent to dollars, so the number of decimals follows the size. */
const money = {
  thousandth: new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }),
  cent: new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }),
  unit: new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD" }),
};
const compact = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });
const axisTick = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 });
const date = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
const day = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });
const percent = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });

const formatCurrency = (value: number): string => {
  const size = Math.abs(value);
  if (size >= 1) return money.unit.format(value);
  return size >= 0.01 ? money.cent.format(value) : money.thousandth.format(value);
};
const formatAxis = (value: number): string => axisTick.format(value);
const formatCompact = (value: number): string => compact.format(value);
const formatDay = (value: string): string => {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(parsed) ? value : day.format(parsed);
};
const formatPercent = (value: number): string => percent.format(value);
const formatDate = (value: string): string => date.format(new Date(value));

function rate(firstPass: TelemetryFirstPass): number | null {
  return firstPass.total === 0 ? null : firstPass.accepted / firstPass.total;
}

function rateText(firstPass: TelemetryFirstPass): string {
  const value = rate(firstPass);
  return value === null ? "—" : formatPercent(value);
}

/** The coordinator is no task and takes no chart colour: it paints with the neutral swatch. */
function colorOf(row: { entity: { color: number | null } }): string {
  return row.entity.color === null ? "var(--muted-foreground)" : `var(--chart-${row.entity.color})`;
}

/** A quantity as the cards show it: `~` when estimated, `—` when unknown. */
function quantityText(value: {
  value: number | null;
  quality: "measured" | "estimated" | "derived" | "unknown";
}): string {
  return formatQuantity(value, { format: formatCurrency }).text;
}

const CACHE_COLORS = 5;
const cacheColor = (index: number): string => `var(--chart-${(index % CACHE_COLORS) + 1})`;

/** Long model ids get a short axis label; the table and the tooltip keep the full id. */
const shortLabel = (label: string, limit = 22): string =>
  label.length <= limit ? label : `${label.slice(0, limit - 1)}…`;

export {
  LOCALE,
  cacheColor,
  colorOf,
  formatAxis,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDay,
  formatPercent,
  quantityText,
  rate,
  rateText,
  shortLabel,
};
