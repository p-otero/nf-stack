import { Skeleton } from "@/components/ui/skeleton";

function GitLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-items rounded-surface border bg-card px-inset-item py-inset-item"
    >
      <p className="sr-only">{label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-control-sm" />
      ))}
    </div>
  );
}

export { GitLoading };
