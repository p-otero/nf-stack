import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@/components/ui/segmented-control";
import type { TelemetryGrouping } from "@/components/nf/telemetry-config";

type GroupSwitchProps = {
  groupBy: TelemetryGrouping;
  entity: string;
  onGroupBy: (groupBy: TelemetryGrouping) => void;
};

function GroupSwitch({ groupBy, entity, onGroupBy }: GroupSwitchProps) {
  return (
    <SegmentedControl
      aria-label={`Group by ${entity}`}
      value={groupBy}
      onValueChange={(value) => {
        if (value === "strategy" || value === "model" || value === "coordinator") {
          onGroupBy(value);
        }
      }}
    >
      <SegmentedControlIndicator />
      <SegmentedControlItem value="strategy">Strategy</SegmentedControlItem>
      <SegmentedControlItem value="model">Model</SegmentedControlItem>
      <SegmentedControlItem value="coordinator">Coordinator</SegmentedControlItem>
    </SegmentedControl>
  );
}

export { GroupSwitch };
export type { GroupSwitchProps };
