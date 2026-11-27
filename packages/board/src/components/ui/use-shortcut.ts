"use client"

import { createContext, use, useEffect, useLayoutEffect, useRef, type RefObject } from "react"

import { addShortcut, type ShortcutLayer } from "@/components/ui/shortcuts-registry"

type ScopeContextValue = { scope: string; layer: () => Element | null }

const ScopeContext = createContext<ScopeContextValue | null>(null)

type UseShortcutOptions = {
  /** A named scope; inside a `ShortcutScope` it defaults to that scope's name. `null` makes it global. */
  scope?: string | null
  /** `false` leaves it unregistered. */
  enabled?: boolean
  /** What it does, for the `ShortcutsDialog`. Without one it still runs but isn't listed. */
  description?: string
  /** Whether it runs while focus is in a text field or contenteditable. Shortcuts with ⌘, Ctrl or ⌥ always do. */
  allowInInput?: boolean
  /** Checked on every key press. */
  when?: () => boolean
  /** An element inside a popup, or a ref to one: the shortcut runs only while that popup is open. */
  layer?: ShortcutLayer | RefObject<Element | null>
}

function layerOf(layer: UseShortcutOptions["layer"], scope: ScopeContextValue | null): ShortcutLayer {
  if (layer === undefined) return scope ? scope.layer : undefined
  if (layer instanceof Element || typeof layer === "function") return layer
  return () => layer.current
}

/**
 * Registers a shortcut while the component is mounted: `"u"`, `"mod+k"`, `"?"` or a sequence `"g i"`. Plain keys
 * never fire while someone types in a field or contenteditable, nor during IME composition. Built on UI SDK's
 * shared `shortcuts`, so modals pause page shortcuts and `ShortcutsDialog` lists them.
 */
function useShortcut(
  keys: string | null | undefined,
  handler: (event: KeyboardEvent) => void,
  { scope, enabled = true, description, allowInInput, when, layer }: UseShortcutOptions = {},
) {
  const context = use(ScopeContext)
  const resolvedScope = scope === null ? undefined : (scope ?? context?.scope)
  const layerContext = scope === null ? null : context
  const hasLayer = layer !== undefined || layerContext !== null
  const latest = useRef({ handler, when, layer, layerContext })
  // oxlint-disable-next-line p-otero/no-latest-ref-effect -- ShortcutsDialog lists shortcuts in the render that opens it (the modal pauses them after), which calls `when` and the layer; an effect event throws during render
  useLayoutEffect(() => {
    latest.current = { handler, when, layer, layerContext }
  })

  useEffect(() => {
    if (!keys || !enabled) return
    const currentLayer = () => {
      const resolved = layerOf(latest.current.layer, latest.current.layerContext)
      return typeof resolved === "function" ? (resolved() ?? null) : (resolved ?? null)
    }
    return addShortcut({
      keys,
      handler: (event) => latest.current.handler(event),
      scope: resolvedScope,
      layer: hasLayer ? currentLayer : undefined,
      description,
      allowInInput,
      when: () => latest.current.when?.() ?? true,
    })
  }, [keys, enabled, resolvedScope, hasLayer, description, allowInInput])
}

export { ScopeContext, useShortcut }
export type { ScopeContextValue, UseShortcutOptions }
