import type { TelemetryView } from "@nf/contracts";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartDataTable,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import type { TelemetryCacheGrouping } from "@/components/nf/telemetry-config";
import { LOCALE, cacheColor, formatPercent, shortLabel } from "@/components/nf/telemetry-format";

const cacheConfig = {
  share: { label: "cache read share", color: "var(--chart-3)" },
} satisfies ChartConfig;

function CacheChart({
  view,
  cacheBy,
  onCacheBy,
}: {
  view: TelemetryView;
  cacheBy: TelemetryCacheGrouping;
  onCacheBy: (cacheBy: TelemetryCacheGrouping) => void;
}) {
  const rows =
    cacheBy === "contexts"
      ? view.cache.contexts.map((context, index) => ({
          key: context.mode,
          label: context.mode,
          share: context.cacheShare ?? 0,
          color: cacheColor(index),
        }))
      : view.cache.models.map((model, index) => ({
          key: model.id,
          label: shortLabel(model.id, 26),
          share: model.cacheShare ?? 0,
          color: cacheColor(index),
        }));
  const height = Math.max(160, rows.length * 28 + 40);
  return (
    <div className="flex flex-col gap-items">
      <SegmentedControl
        aria-label="Group cache read by"
        value={cacheBy}
        onValueChange={(value) => {
          if (value === "contexts" || value === "models") onCacheBy(value);
        }}
      >
        <SegmentedControlIndicator />
        <SegmentedControlItem value="contexts">Context</SegmentedControlItem>
        <SegmentedControlItem value="models">Model</SegmentedControlItem>
      </SegmentedControl>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cached input recorded yet.</p>
      ) : (
        <div className="max-h-[20rem] overflow-y-auto">
          <ChartContainer
            config={cacheConfig}
            aria-label={`Cache read share per ${cacheBy === "contexts" ? "context mode" : "model"}`}
            className="aspect-auto w-full"
            style={{ height }}
          >
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
              barCategoryGap="22%"
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 1]}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatPercent}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={132}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <ChartTooltip
                content={<ChartTooltipContent locale={LOCALE} format={formatPercent} />}
              />
              <Bar dataKey="share" fill="var(--color-share)" barSize={14} isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      )}
      <ChartDataTable
        aria-label={`Cache read share per ${cacheBy === "contexts" ? "context mode" : "model"}, as a table`}
        data={rows}
        labelKey="label"
        keys={["share"]}
        config={cacheConfig}
        locale={LOCALE}
        format={formatPercent}
      />
    </div>
  );
}

export { CacheChart };
