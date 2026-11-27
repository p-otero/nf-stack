import { useCallback, useId, useState } from "react";

import { reviewTask } from "@/board-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewLive } from "@/components/nf/review-actions";

/** Rejecting a review needs its reason: that comment becomes the repair note of the task. */
function RejectDialog({ taskId, live }: { taskId: string; live: ReviewLive }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  const close = useCallback((next: boolean) => {
    setOpen(next);
    if (next) return;
    setComment("");
    setError(null);
    setPending(false);
  }, []);

  const submit = useCallback(() => {
    const reason = comment.trim();
    if (reason.length === 0) {
      setError("A comment is required: say what the next attempt must fix.");
      return;
    }
    setPending(true);
    setError(null);
    void reviewTask(live.channel, taskId, "reject", reason)
      .then(() => {
        setPending(false);
        close(false);
        live.onDecided();
      })
      .catch((failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
  }, [comment, live, taskId, close]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Reject ${taskId}`}
        onClick={() => setOpen(true)}
      >
        Reject
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogBackdrop />
        <DialogContent size="md">
          <DialogTitle>Reject {taskId}?</DialogTitle>
          <DialogDescription>
            The task goes back to working, and your comment becomes its repair note.
          </DialogDescription>
          <Field data-invalid={error !== null ? "" : undefined}>
            <FieldLabel htmlFor={fieldId}>Comment</FieldLabel>
            <Textarea
              id={fieldId}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
                if (error !== null) setError(null);
              }}
              placeholder="What must the next attempt fix?"
              aria-invalid={error !== null ? true : undefined}
              aria-describedby={errorId}
            />
            <FieldError id={errorId} role="alert">
              {error ?? ""}
            </FieldError>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={pending} onClick={submit}>
              Send back to working
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { RejectDialog };
