import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function GitReadError({
  what,
  error,
  onRetry,
  className,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Alert
      role="alert"
      tone="destructive"
      className={cn("h-fit", className)}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <AlertTitle>The Git tab could not read {what}</AlertTitle>
      <AlertDescription>{messageOf(error)}</AlertDescription>
    </Alert>
  );
}

export { GitReadError };
