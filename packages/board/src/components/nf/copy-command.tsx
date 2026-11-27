import { useState } from "react";

import { Button } from "@/components/ui/button";

const FEEDBACK_MS = 1600;

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      className="size-3.5 text-success"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="size-3.5"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** One command a snapshot visitor can copy and run, with a short "copied" confirmation. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        globalThis.setTimeout(() => setCopied(false), FEEDBACK_MS);
      })
      .catch(() => setCopied(false));
  };
  return (
    <span data-slot="nf-copy-command" className="flex min-w-0 items-center gap-inline">
      <code className="min-w-0 flex-1 rounded-choice border bg-muted/(--glass-opacity) px-inset-chip py-inset-chip font-mono text-meta text-muted-foreground wrap-anywhere">
        {command}
      </code>
      <Button
        size="icon"
        variant="outline"
        aria-label={`Copy ${command}`}
        onClick={copy}
        className="size-control-sm shrink-0"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? `Copied ${command}` : ""}
      </span>
    </span>
  );
}

export { CopyCommand };
