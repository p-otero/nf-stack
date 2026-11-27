import { TriangleAlertIcon } from "lucide-react";

import type { Truncation } from "@/components/nf/task-git-data";

const LISTED = 5;

function TruncationNotice({ what, truncation }: { what: string; truncation: Truncation | null }) {
  if (truncation === null) return null;
  const { shown, total, missing } = truncation;
  const listed = missing.slice(0, LISTED);
  const more = missing.length - listed.length;
  return (
    <div
      role="status"
      data-slot="diff-truncated"
      className="flex flex-col gap-inline rounded-control border border-warning/40 bg-warning-soft px-inset-item py-inset-chip text-sm text-warning-soft-foreground"
    >
      <p className="flex items-center gap-inline font-medium">
        <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
        {shown < total
          ? `${what} stops at the git API's size limit: showing ${shown} of ${total} files.`
          : `${what} stops at the git API's size limit: part of it is not shown.`}
      </p>
      {listed.length > 0 ? (
        <p className="text-xs">
          Not shown: <span className="font-mono">{listed.join(", ")}</span>
          {more > 0 ? ` and ${more} more` : ""}.
        </p>
      ) : null}
    </div>
  );
}

export { TruncationNotice };
