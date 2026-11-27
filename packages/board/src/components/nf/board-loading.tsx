import { Skeleton } from "@/components/ui/skeleton";

/** The live board's first paint: a column per status while `/api/board` answers. */
const COLUMNS = ["todo", "active", "review"];

function BoardLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-section">
      <p className="sr-only">Loading the board…</p>
      <Skeleton className="h-control-sm w-52" />
      <div className="grid gap-group md:grid-cols-3">
        {COLUMNS.map((column) => (
          <div key={column} className="flex flex-col gap-items">
            <Skeleton className="h-control-sm w-32" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export { BoardLoading };
