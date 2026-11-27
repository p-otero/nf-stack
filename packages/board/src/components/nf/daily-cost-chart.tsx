import type { TelemetryView } from "@nf/contracts";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartDataTable,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { LOCALE, formatAxis, formatCurrency, formatDay } from "@/components/nf/telemetry-format";

const dailyConfig = {
  workers: { label: "workers", color: "var(--chart-1)" },
  coordination: { label: "coordination", color: "var(--chart-2)" },
} satisfies ChartConfig;

function DailyCostChart({ view }: { view: TelemetryView }) {
  const rows = view.daily.map((entry) => ({
    date: entry.date,
    label: formatDay(entry.date),
    workers: entry.workers.value ?? 0,
    coordination: entry.coordination.value ?? 0,
  }));
  const workers = rows.reduce((sum, row) => sum + row.workers, 0);
  const coordination = rows.reduce((sum, row) => sum + row.coordination, 0);
  return (
    <div className="flex flex-col gap-items">
      <ul
        aria-label="Cost per day series"
        className="flex flex-wrap items-center gap-items text-xs"
      >
        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="size-2 rounded-full bg-chart-1" />
          <span>{`workers ${formatCurrency(workers)}`}</span>
        </li>
        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="size-2 rounded-full bg-chart-2" />
          <span>{`coordination ${formatCurrency(coordination)}`}</span>
        </li>
        <li className="text-muted-foreground">{`total ${formatCurrency(workers + coordination)}`}</li>
      </ul>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No day has usage yet.</p>
      ) : (
        <ChartContainer
          config={dailyConfig}
          aria-label="Cost per day, workers and coordination apart"
          className="aspect-auto h-64 w-full"
        >
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={formatAxis}
              allowDecimals
            />
            <ChartTooltip
              content={<ChartTooltipContent locale={LOCALE} format={formatCurrency} />}
            />
            <Bar
              dataKey="workers"
              stackId="day"
              fill="var(--color-workers)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="coordination"
              stackId="day"
              fill="var(--color-coordination)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      )}
      <ChartDataTable
        aria-label="Cost per day, as a table"
        data={rows}
        labelKey="label"
        keys={["workers", "coordination"]}
        config={dailyConfig}
        locale={LOCALE}
        format={formatCurrency}
      />
    </div>
  );
}

export { DailyCostChart };
