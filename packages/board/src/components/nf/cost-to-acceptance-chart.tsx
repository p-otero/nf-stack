import type { TelemetryView } from "@nf/contracts";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartDataTable,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { GroupSwitch } from "@/components/nf/group-switch";
import type { TelemetryGrouping } from "@/components/nf/telemetry-config";
import { LOCALE, formatAxis, formatCurrency, shortLabel } from "@/components/nf/telemetry-format";
import { taskRows } from "@/components/nf/telemetry-rows";

const costConfig = {
  base: { label: "base", color: "var(--chart-1)" },
  repair: { label: "repairs", color: "var(--chart-2)" },
} satisfies ChartConfig;

const isFullLabel = (value: unknown): value is { full: string } =>
  typeof value === "object" && value !== null && "full" in value && typeof value.full === "string";

function CostToAcceptanceChart({
  view,
  groupBy,
  entity,
  onGroupBy,
}: {
  view: TelemetryView;
  groupBy: TelemetryGrouping;
  entity: string;
  onGroupBy: (groupBy: TelemetryGrouping) => void;
}) {
  const rows = taskRows(view).map((row) => ({
    key: row.entity.id,
    label: shortLabel(row.entity.label),
    full: row.entity.label,
    base: row.costToAcceptance.base.value ?? 0,
    repair: row.costToAcceptance.repair.value ?? 0,
  }));
  const height = Math.max(240, rows.length * 26 + 48);
  return (
    <div className="flex flex-col gap-items">
      <GroupSwitch groupBy={groupBy} entity={entity} onGroupBy={onGroupBy} />
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No task cost recorded for this grouping.</p>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto">
          <ChartContainer
            config={costConfig}
            aria-label={`Cost to acceptance per ${entity}`}
            className="aspect-auto w-full"
            style={{ height }}
          >
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              barCategoryGap="18%"
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatAxis}
                allowDecimals
              />
              <YAxis
                type="category"
                dataKey="label"
                width={120}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    locale={LOCALE}
                    format={formatCurrency}
                    labelFormatter={(_label, payload) => {
                      const point = payload[0]?.payload;
                      if (isFullLabel(point)) return point.full;
                      return typeof _label === "string" || typeof _label === "number"
                        ? String(_label)
                        : "";
                    }}
                  />
                }
              />
              <Bar
                dataKey="base"
                stackId="cost"
                fill="var(--color-base)"
                barSize={14}
                isAnimationActive={false}
              />
              <Bar
                dataKey="repair"
                stackId="cost"
                fill="var(--color-repair)"
                radius={[0, 4, 4, 0]}
                barSize={14}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </div>
      )}
      <ChartDataTable
        aria-label={`Cost to acceptance per ${entity}, as a table`}
        data={rows}
        labelKey="label"
        keys={["base", "repair"]}
        config={costConfig}
        locale={LOCALE}
        format={formatCurrency}
      />
    </div>
  );
}

export { CostToAcceptanceChart };
