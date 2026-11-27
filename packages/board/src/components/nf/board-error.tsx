import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

/** A live board that cannot reach `nf serve`, or a project the API does not know. */
function BoardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty size="page" role="alert">
      <EmptyHeader>
        <EmptyTitle>The board could not load</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export { BoardError };
