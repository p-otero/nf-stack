import type { AgentRef, AttemptView, TaskView } from "@/lib/agent-task-types";
import { providerLogoSrc } from "@/components/nf/provider-logo";
import type { ColorScheme } from "@/components/nf/color-scheme";

const withLogo = (agent: AgentRef, theme: ColorScheme): AgentRef => {
  const src = providerLogoSrc(agent.provider, agent.model, theme);
  return src === null ? agent : { ...agent, avatar: { src } };
};

const withAttemptLogo = (attempt: AttemptView, theme: ColorScheme): AttemptView => ({
  ...attempt,
  configured: withLogo(attempt.configured, theme),
  ...(attempt.executed === undefined ? {} : { executed: withLogo(attempt.executed, theme) }),
  ...(attempt.fallbacks === undefined
    ? {}
    : {
        fallbacks: attempt.fallbacks.map((fallback) => ({
          ...fallback,
          agent: withLogo(fallback.agent, theme),
        })),
      }),
});

/** Every agent of the board with the mark its provider (and, for Pi, its model vendor) carries. */
export function withAgentLogos(task: TaskView, theme: ColorScheme): TaskView {
  return { ...task, attempts: task.attempts.map((attempt) => withAttemptLogo(attempt, theme)) };
}
