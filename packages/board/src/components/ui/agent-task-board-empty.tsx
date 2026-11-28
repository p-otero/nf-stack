import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"

type AgentTaskBoardEmptyProps = {
  labels: AgentTaskBoardLabels
  filtered: boolean
  canClear?: boolean
  onClear: () => void
}

function AgentTaskBoardEmpty({ labels, filtered, canClear = true, onClear }: AgentTaskBoardEmptyProps) {
  return (
    <Empty data-slot="agent-task-board-empty">
      <EmptyHeader>
        <EmptyDescription>{filtered ? labels.empty.filtered : labels.empty.board}</EmptyDescription>
      </EmptyHeader>
      {filtered && canClear && (
        <Button variant="outline" onClick={onClear}>
          {labels.filters.clear}
        </Button>
      )}
    </Empty>
  )
}

export { AgentTaskBoardEmpty }
