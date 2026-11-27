import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AgentRef } from "@nf/contracts";
import type { AgentRef as AgentRefType, Attempt } from "@nf/contracts";
import type { Project } from "@nf/contracts";

const Fallback = Schema.Struct({ agent: AgentRef, reason: Schema.String });
const decodeFallback = Schema.decodeUnknownOption(Fallback);

function optionsEffort(options: unknown): { name: string; value: string } | undefined {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return undefined;
  for (const [name, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return { name, value: String(value) };
    }
  }
  return undefined;
}

/** The route the attempt was asked to run on, with the effort its options asked for. */
export function configuredAgent(attempt: Attempt): AgentRefType {
  const effort = optionsEffort(attempt.options);
  return {
    provider: attempt.provider_instance_id ?? "unknown",
    model: attempt.model ?? attempt.executed_model ?? "unknown",
    ...(effort === undefined ? {} : { effort }),
  };
}

/** The model the provider reported, when it is not the one that was asked for. */
export function executedAgent(
  attempt: Attempt,
  configured: AgentRefType,
): AgentRefType | undefined {
  if (!attempt.model || !attempt.executed_model || attempt.executed_model === attempt.model) {
    return undefined;
  }
  return { ...configured, model: attempt.executed_model };
}

/** The routes the attempt fell back from, decoded; a malformed entry is left out. */
export function attemptFallbacks(attempt: Attempt): { agent: AgentRefType; reason: string }[] {
  const out: { agent: AgentRefType; reason: string }[] = [];
  for (const entry of attempt.fallbacks) {
    const decoded = Option.getOrNull(decodeFallback(entry));
    if (decoded !== null) out.push({ agent: decoded.agent, reason: decoded.reason });
  }
  return out;
}

/**
 * The thread's href: the `t3code://threads` deep link when the attempt, or its project's
 * coordinator, ran on an environment; otherwise the recorded link. On by default; a project
 * config can still turn it off.
 */
export function threadHrefOf(
  attempt: Attempt,
  project: Project,
  deepLinks: boolean,
): string | undefined {
  if (deepLinks && attempt.thread_id !== null) {
    const environment = attempt.environment_id ?? project.coordinator_environment_id;
    if (environment !== null) {
      return `t3code://threads/${environment}/${encodeURIComponent(attempt.thread_id)}`;
    }
  }
  return attempt.thread_link ?? undefined;
}
