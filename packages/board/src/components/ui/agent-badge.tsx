import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { ArrowLeftRightIcon } from "lucide-react"

import type { AgentRef } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { AgentAvatar, type AgentAvatars } from "@/components/ui/agent-avatar"

interface AgentBadgeLabels {
  /** Visible marker before the requested agent, as in "requested zai/glm-5.3". */
  requested: string
  /** Screen reader text that explains the marker. */
  differs: string
  /** Display names for effort names, keyed by the provider's name ("reasoningEffort"). */
  effortNames: Record<string, string>
}

const agentBadgeLabels: AgentBadgeLabels = {
  requested: "requested",
  differs: "Not the requested agent.",
  effortNames: {},
}

const agentBadgeLabelsEs: AgentBadgeLabels = {
  requested: "pedido",
  differs: "No es el agente pedido.",
  effortNames: {
    effort: "esfuerzo",
    reasoningEffort: "razonamiento",
    thinking: "pensamiento",
  },
}

/** Same comparison as `agentDiffers`, for two refs instead of an attempt. */
function sameAgent(a: AgentRef, b: AgentRef) {
  return a.provider === b.provider && a.model === b.model && a.effort?.value === b.effort?.value
}

function formatEffort(effort: AgentRef["effort"], showName: boolean, labels: AgentBadgeLabels) {
  if (!effort) return undefined
  if (!showName) return effort.value
  return `${labels.effortNames[effort.name] ?? effort.name}: ${effort.value}`
}

function describeAgent(agent: AgentRef, labels: AgentBadgeLabels) {
  return [agent.provider, agent.model, formatEffort(agent.effort, true, labels)].filter(Boolean).join(" · ")
}

/** The part of `requested` that differs from `agent`, the shortest thing that tells them apart. */
function requestedDifference(agent: AgentRef, requested: AgentRef) {
  if (requested.model !== agent.model) return requested.label ?? requested.model
  if (requested.provider !== agent.provider) return requested.provider
  return requested.effort?.value ?? "—"
}

/** The agent in full, and what was requested when it differs: a title, or the name of an avatar shown alone. */
function agentSummary(agent: AgentRef, requested: AgentRef | undefined, labels: AgentBadgeLabels = agentBadgeLabels) {
  const differs = requested !== undefined && !sameAgent(agent, requested)
  const requestedInFull = differs ? `${labels.requested} ${describeAgent(requested, labels)}` : undefined
  return [describeAgent(agent, labels), requestedInFull].filter(Boolean).join(" — ")
}

/** What a card has room for: the agent's label, or the last segment of its model id. */
function shortModel(agent: AgentRef) {
  return agent.label ?? agent.model.slice(agent.model.lastIndexOf("/") + 1)
}

type AgentBadgeProps = Omit<PartProps<"span">, "children"> & {
  /** The agent that ran, or the configured one when nothing ran yet. */
  agent: AgentRef
  /** What was configured; a marker shows when it differs from `agent`. */
  requested?: AgentRef
  variant?: "compact" | "detail"
  /** Show the effort as "name: value". Defaults to true in the detail variant. */
  showEffortName?: boolean
  labels?: Partial<AgentBadgeLabels>
  /** Images, icons or names per provider; initials on a provider color otherwise. */
  avatars?: AgentAvatars
  /** Shows the provider's avatar before the model. Defaults to true. */
  showAvatar?: boolean
}

function AgentBadge({
  agent,
  requested,
  variant = "compact",
  showEffortName,
  labels: labelOverrides,
  avatars,
  showAvatar = true,
  className,
  render,
  ...props
}: AgentBadgeProps) {
  const labels = { ...agentBadgeLabels, ...labelOverrides }
  const detail = variant === "detail"
  const differs = requested !== undefined && !sameAgent(agent, requested)
  const effort = formatEffort(agent.effort, showEffortName ?? detail, labels)
  const requestedInFull = differs ? `${labels.requested} ${describeAgent(requested, labels)}` : undefined
  const marker = differs && !detail ? `${labels.requested} ${requestedDifference(agent, requested)}` : requestedInFull
  const title = agentSummary(agent, requested, labels)

  return renderElement(
    "span",
    {
      "data-slot": "agent-badge",
      "data-variant": variant,
      "data-differs": differs ? "" : undefined,
      title: detail ? undefined : title,
      className: cn(
        "inline-flex max-w-full min-w-0 gap-inline text-xs text-foreground",
        showAvatar ? "items-center" : "items-baseline",
        detail ? "flex-wrap" : "whitespace-nowrap",
        className,
      ),
      ...props,
      children: (
        <>
          {differs && <span className="sr-only">{labels.differs}</span>}
          {showAvatar && <AgentAvatar agent={agent} avatars={avatars} />}
          {detail && (
            <span data-slot="agent-badge-provider" className="shrink-0 text-muted-foreground">
              {agent.provider}
            </span>
          )}
          {detail ? (
            <span data-slot="agent-badge-model" className="font-medium break-all">
              {agent.model}
            </span>
          ) : (
            <span data-slot="agent-badge-model" className="min-w-0 truncate font-medium">
              {shortModel(agent)}
            </span>
          )}
          {effort && (
            <span data-slot="agent-badge-effort" className="shrink-0 text-muted-foreground">
              {effort}
            </span>
          )}
          {agent.environment && detail && (
            <span data-slot="agent-badge-environment" className="text-muted-foreground">
              @{agent.environment}
            </span>
          )}
          {marker &&
            (detail ? (
              <span data-slot="agent-badge-requested" className="break-all text-warning">
                {marker}
              </span>
            ) : (
              <span data-slot="agent-badge-requested" className="inline-flex shrink-0 text-warning">
                <ArrowLeftRightIcon className="size-3 shrink-0 self-center" />
                <span className="sr-only">{marker}</span>
              </span>
            ))}
        </>
      ),
    },
    render,
  )
}

export { AgentBadge, agentBadgeLabels, agentBadgeLabelsEs, agentSummary }
export type { AgentBadgeLabels, AgentBadgeProps }
