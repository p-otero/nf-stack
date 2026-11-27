import type { TelemetryView } from "@nf/contracts";
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import type { TooltipPayloadEntry } from "recharts";

import { ChartContainer, ChartDataTable, ChartTooltip } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { GroupSwitch } from "@/components/nf/group-switch";
import type { TelemetryGrouping } from "@/components/nf/telemetry-config";
import {
  LOCALE,
  colorOf,
  formatAxis,
  formatCurrency,
  formatPercent,
  rate,
} from "@/components/nf/telemetry-format";
import { taskRows } from "@/components/nf/telemetry-rows";

const scatterConfig = {
  cost: { label: "cost / accepted task", color: "var(--chart-1)" },
  firstPass: { label: "first pass", color: "var(--chart-2)" },
  tasks: { label: "tasks", color: "var(--chart-3)" },
} satisfies ChartConfig;

type ScatterPoint = {
  key: string;
  label: string;
  logo: string | null;
  cost: number;
  firstPass: number;
  tasks: number;
  color: string;
};

const isScatterPoint = (value: unknown): value is ScatterPoint =>
  typeof value === "object" &&
  value !== null &&
  "cost" in value &&
  typeof value.cost === "number" &&
  "firstPass" in value &&
  typeof value.firstPass === "number";

function ScatterMark({
  cx,
  cy,
  size,
  payload,
}: {
  cx?: number;
  cy?: number;
  size?: number;
  payload?: unknown;
}) {
  if (!isScatterPoint(payload) || cx === undefined || cy === undefined) return <g />;
  const radius = Math.sqrt(Math.max(size ?? 0, 0) / Math.PI);
  const logo = Math.min(14, Math.max(9, radius * 1.5));
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={payload.color}
        fillOpacity={0.45}
        stroke={payload.color}
      />
      {payload.logo === null ? null : (
        <image href={payload.logo} x={cx - logo / 2} y={cy - logo / 2} width={logo} height={logo} />
      )}
    </g>
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly TooltipPayloadEntry[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !isScatterPoint(point)) return null;
  return (
    <div className="grid min-w-40 gap-1 rounded-lg border border-floating-border bg-floating px-inset-item py-inset-item text-xs text-popover-foreground shadow-floating backdrop-floating">
      <span className="font-medium">{point.label}</span>
      <span>{`${formatCurrency(point.cost)} per accepted task`}</span>
      <span>{`${formatPercent(point.firstPass)} accepted first pass`}</span>
      <span className="text-muted-foreground">
        {point.tasks === 1 ? "1 task" : `${point.tasks} tasks`}
      </span>
    </div>
  );
}

function CostFirstPassChart({
  view,
  groupBy,
  entity,
  onGroupBy,
  logoOf,
}: {
  view: TelemetryView;
  groupBy: TelemetryGrouping;
  entity: string;
  onGroupBy: (groupBy: TelemetryGrouping) => void;
  logoOf: (id: string) => string | null;
}) {
  const points: ScatterPoint[] = taskRows(view).flatMap((row) => {
    const cost = row.costPerAcceptedTask.value;
    const firstPass = rate(row.firstPass);
    if (cost === null || firstPass === null) return [];
    return [
      {
        key: row.entity.id,
        label: row.entity.label,
        logo: logoOf(row.entity.id),
        cost,
        firstPass,
        tasks: row.tasks,
        color: colorOf(row),
      },
    ];
  });
  return (
    <div className="flex flex-col gap-items">
      <GroupSwitch groupBy={groupBy} entity={entity} onGroupBy={onGroupBy} />
      {points.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No accepted task has both a price and a first-pass verdict yet.
        </p>
      ) : (
        <ChartContainer
          config={scatterConfig}
          aria-label={`Cost per accepted task against first-pass rate per ${entity}`}
          className="aspect-auto h-80 w-full"
        >
          <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 4 }}>
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="cost"
              name="Cost / task"
              tickLine={false}
              axisLine={false}
              tickFormatter={formatAxis}
              allowDecimals
            />
            <YAxis
              type="number"
              dataKey="firstPass"
              name="First pass"
              domain={[0, 1]}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={formatPercent}
            />
            <ZAxis type="number" dataKey="tasks" range={[90, 520]} />
            <ChartTooltip content={<ScatterTooltip />} />
            <Scatter data={points} shape={ScatterMark} isAnimationActive={false} />
          </ScatterChart>
        </ChartContainer>
      )}
      <ul aria-label={`Points per ${entity}`} className="flex flex-wrap gap-1">
        {points.map((point) => (
          <li
            key={point.key}
            title={`${point.label}: ${formatCurrency(point.cost)} per accepted task, ${formatPercent(point.firstPass)} first pass, ${point.tasks === 1 ? "1 task" : `${point.tasks} tasks`}`}
            className="inline-flex max-w-full items-center gap-1 rounded-md border bg-card/(--glass-opacity) px-2 py-1 text-xs"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: point.color }}
            />
            {point.logo === null ? null : (
              <img src={point.logo} alt="" aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{point.label}</span>
          </li>
        ))}
      </ul>
      <ChartDataTable
        aria-label={`Cost per accepted task and first pass per ${entity}, as a table`}
        data={points}
        labelKey="label"
        keys={["cost", "firstPass", "tasks"]}
        config={scatterConfig}
        locale={LOCALE}
        format={formatAxis}
      />
    </div>
  );
}

export { CostFirstPassChart };
