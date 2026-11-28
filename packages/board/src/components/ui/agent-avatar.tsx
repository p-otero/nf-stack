"use client"

import type { ComponentProps, ReactNode } from "react"

import type { AgentRef } from "@/lib/agent-task-types"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/** Images, icons or display names per provider id. A `src` may be a data URI, for pages without network. */
type AgentAvatars = Record<string, { src?: string; icon?: ReactNode; label?: string }>

const AVATAR_TINTS = 8

// Spec: WCAG 1.4.3 — tints under foreground text, never solid fills under white, keep the initials readable in both schemes.
const tintClassName =
  "data-[tint=0]:bg-chart-1/20 data-[tint=0]:inset-ring-chart-1/50 data-[tint=1]:bg-chart-2/20 data-[tint=1]:inset-ring-chart-2/50 data-[tint=2]:bg-chart-3/20 data-[tint=2]:inset-ring-chart-3/50 data-[tint=3]:bg-chart-4/20 data-[tint=3]:inset-ring-chart-4/50 data-[tint=4]:bg-chart-5/25 data-[tint=4]:inset-ring-chart-5/60 data-[tint=5]:bg-info/15 data-[tint=5]:inset-ring-info/40 data-[tint=6]:bg-success/15 data-[tint=6]:inset-ring-success/40 data-[tint=7]:bg-warning/15 data-[tint=7]:inset-ring-warning/40"

function spreadLowBits(hash: number) {
  let spread = hash ^ (hash >>> 16)
  spread = Math.imul(spread, 0x7feb352d)
  spread ^= spread >>> 15
  spread = Math.imul(spread, 0x846ca68b)
  spread ^= spread >>> 16
  return spread >>> 0
}

function stableFnv1aHash(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return spreadLowBits(hash)
}

/** In [0, count), the same for a key on every run and runtime. */
function colorIndex(key: string, count: number) {
  return stableFnv1aHash(key) % count
}

function agentAvatarTint(provider: string) {
  return colorIndex(provider, AVATAR_TINTS)
}

/** "claudeAgent" → "CA", "codex" → "Co", "open ai" → "OA". */
function agentInitials(name: string) {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length > 1) return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
  const word = words[0]!
  return word.charAt(0).toUpperCase() + word.slice(1, 2).toLowerCase()
}

/** The label in `avatars`, or the provider id. */
function providerName(provider: string, avatars?: AgentAvatars) {
  return avatars?.[provider]?.label ?? provider
}

type AgentAvatarProps = Omit<ComponentProps<typeof Avatar>, "children"> & {
  agent: AgentRef
  avatars?: AgentAvatars
  /** Names the avatar when it stands alone; without it, it is decorative beside visible text. */
  label?: string
}

function AgentAvatar({ agent, avatars, label, size = "xs", className, ...props }: AgentAvatarProps) {
  const custom = avatars?.[agent.provider]
  const src = agent.avatar?.src ?? custom?.src
  const named = label !== undefined
  return (
    <Avatar
      data-agent-avatar=""
      data-provider={agent.provider}
      size={size}
      role={named ? "img" : undefined}
      aria-label={label}
      aria-hidden={named ? undefined : true}
      className={className}
      {...props}
    >
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback
        aria-hidden="true"
        data-tint={agentAvatarTint(agent.provider)}
        className={cn("font-semibold text-foreground inset-ring-1 inset-ring-border [&_svg]:size-3/5", tintClassName)}
      >
        {custom?.icon ?? agentInitials(providerName(agent.provider, avatars))}
      </AvatarFallback>
    </Avatar>
  )
}

function UnassignedAvatar({ className }: { className?: string }) {
  return (
    <span
      data-slot="agent-avatar-unassigned"
      aria-hidden="true"
      className={cn("inline-flex size-5 shrink-0 text-muted-foreground", className)}
    >
      {/* oxlint-disable-next-line eskais/no-inline-icons -- a placeholder avatar, a dashed ring and figure, not an icon */}
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" className="size-full">
        <circle cx="10" cy="10" r="9" strokeDasharray="2.5 2" />
        <circle cx="10" cy="8" r="2.75" />
        <path d="M5 15.5a5.5 5.5 0 0 1 10 0" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export { AgentAvatar, UnassignedAvatar, agentAvatarTint, agentInitials, colorIndex, providerName }
export type { AgentAvatarProps, AgentAvatars }
