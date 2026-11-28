import type { Quantity } from "@/lib/quantity"
import type { Attachment } from "@/components/ui/attachments"

type TaskStatus = "proposed" | "todo" | "working" | "review" | "blocked" | "done" | "cancelled"

type AttemptStatus = "dispatching" | "active" | "succeeded" | "failed" | "cancelled" | "superseded" | "unknown"

type Liveness = "running" | "idle" | "waiting_input" | "suspect_dead" | "finished"

type ContextMode = "fresh" | "reuse" | "fork" | "compact"

interface AgentRef {
  /** Provider id, such as "codex" or "claudeAgent". */
  provider: string
  /** Exact model id; can be long. */
  model: string
  /** Reasoning effort; the name varies by provider ("effort", "reasoningEffort", "thinking"). */
  effort?: { name: string; value: string }
  /** Machine the agent ran on, when it isn't the local one. */
  environment?: string
  /** Short display name. */
  label?: string
  /** Overrides the provider's avatar for this agent; `src` may be a data URI. */
  avatar?: { src?: string }
}

interface UsageSummary {
  inputTokens: Quantity
  outputTokens: Quantity
  cacheReadTokens: Quantity
  cacheWriteTokens: Quantity
  reasoningTokens: Quantity
  /** Equivalent API cost in USD, usually estimated. */
  costUsd: Quantity
  durationMs?: Quantity
  activeMs?: Quantity
}

interface ThreadRef {
  id: string
  title?: string
  /** May use a custom scheme, such as t3-thread://. */
  href?: string
}

interface AttemptView {
  id: string
  kind: "implementation" | "integration" | "research" | "design" | "review" | (string & {})
  status: AttemptStatus
  profile?: string
  /** What was requested. */
  configured: AgentRef
  /** What actually ran; may differ from `configured`. */
  executed?: AgentRef
  /** Routes discarded before this one. */
  fallbacks?: { agent: AgentRef; reason: string }[]
  contextMode?: ContextMode
  /** Origin thread when `contextMode` is "reuse" or "fork". */
  sourceThread?: ThreadRef
  /** One line: why this model, or why delegate. */
  reason?: string
  repairOf?: string
  thread?: ThreadRef
  /** ISO 8601 UTC. */
  startedAt: string
  /** ISO 8601 UTC. */
  endedAt?: string
  /** Always computed by the data source; components never derive it from times. */
  liveness?: Liveness
  /** Why the data source reached its `liveness` verdict, in one line ("No output for 25 min; process still alive"). Task cards show it in a tooltip on a waiting or stuck attempt. */
  livenessEvidence?: string
  /** ISO 8601 UTC. */
  lastActivityAt?: string
  usage?: UsageSummary
  checks?: { name: string; result: "pass" | "fail" | "not_run"; note?: string }[]
  commits?: string[]
  blocker?: { kind: string; summary: string; retryAt?: string }
}

interface TaskLink {
  kind: "pull-request" | "branch" | "commit" | "issue" | "external"
  href: string
  label: string
  state?: "draft" | "open" | "merged" | "closed"
}

/** Where the task's work is in a pipeline; `stage` is the id of one of the board's `stages`. */
interface TaskLocation {
  stage: string
  /** What the stage stands for, like the deployment or the pull request. */
  href?: string
}

interface TaskView {
  id: string
  title: string
  goal?: string
  project?: string
  status: TaskStatus
  /** Derived; only meaningful for "todo": ready versus waiting on a dependency. */
  ready?: boolean
  /** Free text, not a closed set of roles. */
  profile?: string
  analysisMode?: "review" | "autonomous"
  dependsOn: { id: string; title?: string; status: TaskStatus }[]
  acceptance: { text: string; result: "pass" | "fail" | "unverified"; evidence?: string }[]
  /** Chronological. */
  attempts: AttemptView[]
  activeAttemptId?: string
  decisionNeeded?: string
  /** Task total, including repairs and reviews. */
  usage?: UsageSummary
  counts?: { attempts: number; repairs: number; reviews: number; humanInterventions: number }
  acceptedFirstPass?: boolean
  labels?: string[]
  /** Pull requests, branches, commits, issues and other pages about the task. */
  links?: TaskLink[]
  /** Screenshots and files; images open in a lightbox. */
  attachments?: Attachment[]
  location?: TaskLocation
  /** ISO 8601 UTC. */
  updatedAt: string
}

/** The agent that actually ran, or the configured one when that isn't known. */
function effectiveAgent(attempt: AttemptView): AgentRef {
  return attempt.executed ?? attempt.configured
}

/** True when the agent that ran differs from the one requested. */
function agentDiffers(attempt: AttemptView): boolean {
  const { executed, configured } = attempt
  return (
    executed !== undefined &&
    (executed.provider !== configured.provider ||
      executed.model !== configured.model ||
      executed.effort?.value !== configured.effort?.value)
  )
}

export { agentDiffers, effectiveAgent }
export type {
  AgentRef,
  AttemptStatus,
  AttemptView,
  ContextMode,
  Liveness,
  TaskLink,
  TaskLocation,
  TaskStatus,
  TaskView,
  ThreadRef,
  UsageSummary,
}
