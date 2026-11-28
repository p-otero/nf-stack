"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { useShortcutHint } from "@ui-sdk/react/shortcuts"
import { useCallback, useMemo, useState, type FocusEvent, type Ref } from "react"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  addScopeLabel,
  formatSteps,
  listShortcuts,
  setScopeActive,
  stepsOf,
  type ListedShortcut,
} from "@/components/ui/shortcuts-registry"
import {
  ScopeContext,
  useShortcut,
  type ScopeContextValue,
  type UseShortcutOptions,
} from "@/components/ui/use-shortcut"
import { cn } from "@/lib/utils"

type ShortcutScopeProps = PartProps<"div"> & {
  /** The scope's name. Shortcuts registered inside it run only while it is active. */
  name: string
  /** How `ShortcutsDialog` titles this scope's group. */
  label?: string
  /**
   * `"focus"` (default): active while focus is inside, like an editor or a list. `true`: while mounted, like an
   * open side panel. `false`: never.
   */
  active?: boolean | "focus"
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") return ref(value)
  if (ref) ref.current = value
}

const focusedScopes = new WeakSet<Element>()

function enterScope(element: Element, name: string) {
  if (focusedScopes.has(element)) return
  focusedScopes.add(element)
  setScopeActive(name, true)
}

function leaveScope(element: Element, name: string) {
  if (!focusedScopes.delete(element)) return
  setScopeActive(name, false)
}

/** Limits the shortcuts registered inside it to a region, or to an open panel or dialog. */
function ShortcutScope({ name, label, active = "focus", render, onFocus, onBlur, ref, ...props }: ShortcutScopeProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const context = useMemo<ScopeContextValue>(() => ({ scope: name, layer: () => element }), [name, element])

  const scopeRef = useCallback(
    (node: HTMLDivElement | null) => {
      const cleanup = assignRef(ref, node)
      setElement(node)
      if (!node) return
      const offLabel = label === undefined ? undefined : addScopeLabel(name, label)
      if (active === true) setScopeActive(name, true)
      return () => {
        offLabel?.()
        if (active === true) setScopeActive(name, false)
        leaveScope(node, name)
        if (typeof cleanup === "function") cleanup()
        else assignRef(ref, null)
      }
    },
    [name, label, active, ref],
  )

  const handlers = {
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      onFocus?.(event)
      if (active === "focus") enterScope(event.currentTarget, name)
    },
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      onBlur?.(event)
      if (!event.currentTarget.contains(event.relatedTarget)) leaveScope(event.currentTarget, name)
    },
  }

  return (
    <ScopeContext value={context}>
      {renderElement(
        "div",
        { ...props, ...handlers, ref: scopeRef, "data-slot": "shortcut-scope", "data-scope": name },
        render,
      )}
    </ScopeContext>
  )
}

function ShortcutKey({ step }: { step: string }) {
  return <Kbd>{useShortcutHint(step).text}</Kbd>
}

type ShortcutHintProps = Omit<PartProps<"kbd">, "children"> & {
  /** Keys like `"u"`, `"mod+k"` or `"g i"`. */
  keys: string
}

/** The keys as `Kbd`s, formatted for this platform. Decorative: give the control `aria-keyshortcuts` instead. */
function ShortcutHint({ keys, className, ...props }: ShortcutHintProps) {
  return (
    <KbdGroup aria-hidden="true" data-slot="shortcut-hint" className={cn("shrink-0", className)} {...props}>
      {stepsOf(keys).map((step, index) => (
        <ShortcutKey key={`${String(index)}-${step}`} step={step} />
      ))}
    </KbdGroup>
  )
}

/** `aria-keyshortcuts` for one step; a sequence has no ARIA form, so it gets none. */
function useAriaKeyshortcuts(keys: string | undefined) {
  const single = keys !== undefined && stepsOf(keys).length === 1
  const hint = useShortcutHint(single ? keys : "a")
  return single ? hint.ariaKeyshortcuts : undefined
}

export { ariaKeyshortcuts, formatShortcut, shortcuts, useShortcutHint } from "@ui-sdk/react/shortcuts"
/** Each step of `keys` formatted for this platform, like `["G", "I"]`; for rows of your own in a help screen. */
const formatShortcutSteps = formatSteps

export { formatShortcutSteps, listShortcuts, ShortcutHint, ShortcutScope, useAriaKeyshortcuts, useShortcut }
export type { ListedShortcut, ShortcutHintProps, ShortcutScopeProps, UseShortcutOptions }
