import { CopyCommand } from "@/components/nf/copy-command";

/** A proposal is approved from a terminal: the snapshot and live board both offer its command. */
function ApproveCommand({ taskId }: { taskId: string }) {
  return <CopyCommand command={`nf task approve ${taskId}`} />;
}

export { ApproveCommand };
