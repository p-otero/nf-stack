import type { BoardSummary } from "@/lib/agent-task-board-model"
import type { AgentTaskBoardLabels } from "@/components/ui/agent-task-labels"
import { Stat, StatGroup, StatLabel, StatValue } from "@/components/ui/stat"
import { usageFormatter } from "@/components/ui/usage"

type AgentTaskBoardSummaryProps = {
  summary: BoardSummary
  labels: AgentTaskBoardLabels
  locale?: string
  formatCurrency?: (usd: number) => string
  className?: string
}

function AgentTaskBoardSummary({ summary, labels, locale, formatCurrency, className }: AgentTaskBoardSummaryProps) {
  const text = labels.summary
  const { accepted, rated } = summary.acceptedFirstPass
  return (
    <StatGroup aria-label={text.group} data-slot="agent-task-board-summary" className={className}>
      <Stat>
        <StatLabel>{text.total}</StatLabel>
        <StatValue value={summary.total} locale={locale} />
      </Stat>
      <Stat>
        <StatLabel>{text.acceptedFirstPass}</StatLabel>
        <StatValue>{text.acceptedFirstPassValue(accepted, rated)}</StatValue>
      </Stat>
      <Stat>
        <StatLabel>{text.cost}</StatLabel>
        <StatValue
          value={summary.cost}
          locale={locale}
          format={usageFormatter("cost", { locale, formatCurrency })}
          labels={labels.components.usage?.quantity}
        />
      </Stat>
      <Stat>
        <StatLabel>{text.awaitingDecision}</StatLabel>
        <StatValue value={summary.awaitingDecision} locale={locale} />
      </Stat>
    </StatGroup>
  )
}

export { AgentTaskBoardSummary }
export type { AgentTaskBoardSummaryProps }
