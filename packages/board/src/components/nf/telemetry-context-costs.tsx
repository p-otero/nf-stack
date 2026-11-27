import type { TelemetryView } from "@nf/contracts";

import { SampleSizeBadge } from "@/components/nf/sample-size-badge";
import { formatCurrency, rateText } from "@/components/nf/telemetry-format";

function ContextCosts({ view }: { view: TelemetryView }) {
  const contexts = view.cache.contexts;
  const widest = Math.max(...contexts.map((context) => context.costPerAcceptedTask.value ?? 0), 0);
  return (
    <div className="flex flex-col gap-items">
      <h3 className="text-meta tracking-meta text-muted-foreground uppercase">
        Cost per accepted task, repairs apart
      </h3>
      {contexts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No attempt recorded a context transfer yet.</p>
      ) : (
        <ul className="flex flex-col gap-items">
          {contexts.map((context) => {
            const base = context.costToAcceptance.base.value ?? 0;
            const repair = context.costToAcceptance.repair.value ?? 0;
            const total = base + repair;
            const width = widest === 0 ? 0 : (total / widest) * 100;
            const baseWidth = total === 0 ? 0 : (base / total) * 100;
            return (
              <li key={context.mode} className="grid gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-inline">
                  <span className="font-medium">{context.mode}</span>
                  <span className="text-caption text-muted-foreground">
                    {`${context.tasks} task${context.tasks === 1 ? "" : "s"} · ${context.attempts.newWork} new · ${context.attempts.repair} repairs`}
                  </span>
                </div>
                <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full"
                    style={{ width: `${(width * baseWidth) / 100}%`, background: "var(--chart-1)" }}
                  />
                  <span
                    className="block h-full"
                    style={{
                      width: `${width - (width * baseWidth) / 100}%`,
                      background: "var(--chart-2)",
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-inline text-xs">
                  <span className="tabular-nums text-muted-foreground">
                    {`${context.costPerAcceptedTask.value === null ? "—" : `${formatCurrency(context.costPerAcceptedTask.value)} per accepted`} · repairs ${formatCurrency(repair)}`}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="tabular-nums">{rateText(context.firstPass)}</span>
                    <span className="text-muted-foreground">first pass</span>
                    <SampleSizeBadge n={context.n} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { ContextCosts };
