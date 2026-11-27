import { useState } from "react";

import type { TelemetryView } from "@nf/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { DataTableColumn } from "@/components/ui/data-table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { QuantityValue } from "@/components/ui/quantity-value";
import { Stat, StatGroup, StatHint, StatLabel, StatValue } from "@/components/ui/stat";
import { ContextCosts } from "@/components/nf/telemetry-context-costs";
import { CacheChart } from "@/components/nf/cache-chart";
import { CostFirstPassChart } from "@/components/nf/cost-first-pass-chart";
import { CostToAcceptanceChart } from "@/components/nf/cost-to-acceptance-chart";
import { DailyCostChart } from "@/components/nf/daily-cost-chart";
import type { TelemetryCacheGrouping, TelemetryGrouping } from "@/components/nf/telemetry-config";
import { useColorScheme } from "@/components/nf/color-scheme";
import { ProviderLogo, telemetryLogoSrc } from "@/components/nf/provider-logo";
import { SampleSizeBadge } from "@/components/nf/sample-size-badge";
import {
  colorOf,
  formatCompact,
  formatCurrency,
  formatDate,
  formatPercent,
  quantityText,
  rate,
  rateText,
} from "@/components/nf/telemetry-format";
import { ShareBar } from "@/components/nf/share-bar";

/** The three groupings the page carries; NF computes each one, the page only switches. */
type TelemetryViews = {
  readonly strategy: TelemetryView;
  readonly model: TelemetryView;
  readonly coordinator: TelemetryView;
};

type Row = TelemetryView["rows"][number];

const COLUMNS: readonly DataTableColumn<Row>[] = [
  {
    id: "entity",
    header: "Entity",
    sortValue: (row) => row.entity.label,
    cell: (row) => (
      <span className="inline-flex items-center gap-2">
        {row.entity.kind === "model" || row.entity.kind === "coordinator" ? (
          <ProviderLogo model={row.entity.id} className="size-3.5" />
        ) : (
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-xs"
            style={{ background: colorOf(row) }}
          />
        )}
        <span>{row.entity.label}</span>
        {row.entity.kind === "coordination" ? (
          <Badge variant="info" className="font-normal">
            coordination
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    id: "tasks",
    header: "Tasks",
    align: "end",
    sortValue: (row) => row.tasks,
    cell: (row) => row.tasks,
  },
  {
    id: "firstPass",
    header: "First pass",
    align: "end",
    sortValue: (row) => rate(row.firstPass),
    cell: (row) => (
      <span className="inline-flex items-center justify-end gap-2">
        <span className="tabular-nums">{rateText(row.firstPass)}</span>
        {row.n > 0 && row.entity.kind !== "coordination" ? <SampleSizeBadge n={row.n} /> : null}
      </span>
    ),
  },
  {
    id: "cost",
    header: "Cost",
    align: "end",
    sortValue: (row) => row.costToAcceptance.value,
    cell: (row) => <QuantityValue value={row.costToAcceptance} format={formatCurrency} />,
  },
  {
    id: "repairs",
    header: "Repairs",
    align: "end",
    sortValue: (row) => row.repairs,
    cell: (row) => row.repairs,
  },
  {
    id: "tokens",
    header: "Tokens",
    align: "end",
    sortValue: (row) => row.tokens.value,
    cell: (row) => <QuantityValue value={row.tokens} format={formatCompact} />,
  },
  {
    id: "cache",
    header: "Cache",
    align: "end",
    sortValue: (row) => row.cacheShare,
    cell: (row) => (
      <span
        title={
          row.cacheRead.value === null
            ? "no cached input"
            : `${formatCompact(row.cacheRead.value)} cached input tokens`
        }
        className="tabular-nums text-muted-foreground"
      >
        {row.cacheShare === null ? "—" : formatPercent(row.cacheShare)}
      </span>
    ),
  },
  {
    id: "spawns",
    header: "Spawns",
    align: "end",
    sortValue: (row) => row.spawns,
    cell: (row) => row.spawns,
  },
  {
    id: "share",
    header: "Cost share",
    align: "end",
    sortValue: (row) => row.share.cost,
    cell: (row) => <ShareBar value={row.share.cost} label="cost share" color={colorOf(row)} />,
  },
];

function TelemetryTab({ telemetry }: { telemetry: TelemetryViews }) {
  const [groupBy, setGroupBy] = useState<TelemetryGrouping>("strategy");
  const [cacheBy, setCacheBy] = useState<TelemetryCacheGrouping>("contexts");
  const theme = useColorScheme();
  const view = telemetry[groupBy];
  const totals = view.totals;
  const entity = groupBy === "coordinator" ? "coordinator" : groupBy;
  if (view.rows.length === 0) {
    return (
      <Empty data-slot="nf-telemetry">
        <EmptyHeader>
          <EmptyTitle>No telemetry yet</EmptyTitle>
          <EmptyDescription>
            `nf sync` has not attributed usage to this project. The tasks and their attempts are
            still in the Tasks view.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div data-slot="nf-telemetry" className="flex flex-col gap-surface">
      <StatGroup>
        <Stat>
          <StatLabel>Tasks</StatLabel>
          <StatValue value={totals.tasks} />
          <StatHint>{`${totals.n} with a first-pass verdict`}</StatHint>
        </Stat>
        <Stat>
          <StatLabel>Accepted first pass</StatLabel>
          <StatValue>{rateText(totals.firstPass)}</StatValue>
          <StatHint>{`${totals.firstPass.accepted} of ${totals.firstPass.total} accepted`}</StatHint>
        </Stat>
        <Stat>
          <StatLabel>Cost to acceptance</StatLabel>
          <StatValue value={totals.costToAcceptance} format={formatCurrency} />
          <StatHint>
            {[
              totals.coordination.cost.value === null
                ? null
                : `+ coordination ${quantityText(totals.coordination.cost)}`,
              totals.costToAcceptance.median.value === null
                ? null
                : `median ${formatCurrency(totals.costToAcceptance.median.value)}`,
            ]
              .filter((part) => part !== null)
              .join(" · ") || "no recorded cost"}
          </StatHint>
        </Stat>
        <Stat>
          <StatLabel>Tokens</StatLabel>
          <StatValue value={totals.tokens} format={formatCompact} />
          <StatHint>
            {view.unpriced.events === 0
              ? `${totals.spawns} spawns, ${totals.repairs} repairs`
              : `${view.unpriced.events} event${view.unpriced.events === 1 ? "" : "s"} without a price`}
          </StatHint>
        </Stat>
      </StatGroup>

      <div className="grid gap-surface lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="grid gap-1">
              <CardTitle render={<h2 />} className="text-sm">
                Cost to acceptance
              </CardTitle>
              <CardDescription render={<p />} className="text-xs">
                {`Base and repairs per ${entity}, from ${formatDate(view.range.from)} to ${formatDate(view.range.to)}. The coordinator's own turns stay out.`}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CostToAcceptanceChart
              view={view}
              groupBy={groupBy}
              entity={entity}
              onGroupBy={setGroupBy}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="grid gap-1">
              <CardTitle render={<h2 />} className="text-sm">
                Cost vs first pass
              </CardTitle>
              <CardDescription render={<p />} className="text-xs">
                {`Known cost per accepted task against the first-pass rate per ${entity}; a point is sized by its task count.`}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CostFirstPassChart
              view={view}
              groupBy={groupBy}
              entity={entity}
              onGroupBy={setGroupBy}
              logoOf={(id) => telemetryLogoSrc(id, theme)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle render={<h2 />} className="text-sm">
              Cache and thread reuse
            </CardTitle>
            <CardDescription render={<p />} className="text-xs">
              {`Cache read share of the tasks' input per attempt context and per model, and the cost per accepted task with repairs apart.`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-items">
            <Badge variant="success" className="font-normal">
              {`saved ${quantityText(view.cache.totals.savings)}`}
            </Badge>
            {view.cache.totals.unpriced === null ? null : (
              <span className="text-caption text-muted-foreground">
                {`${formatCompact(view.cache.totals.unpriced)} cached tokens without both rates`}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-group lg:grid-cols-2">
          <CacheChart view={view} cacheBy={cacheBy} onCacheBy={setCacheBy} />
          <ContextCosts view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle render={<h2 />} className="text-sm">
              Cost per day
            </CardTitle>
            <CardDescription render={<p />} className="text-xs">
              Workers' tasks and the coordinator threads' own turns, by UTC day.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <DailyCostChart view={view} />
        </CardContent>
      </Card>

      <DataTable
        label="Telemetry per entity"
        rows={view.rows}
        columns={COLUMNS}
        getRowId={(row) => row.entity.id}
        getRowLabel={(row) => row.entity.label}
        defaultSort={{ columnId: "cost", direction: "descending" }}
      />
    </div>
  );
}

export { TelemetryTab };
export type { TelemetryViews };
