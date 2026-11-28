import { formatShortcut, registerShortcut, shortcuts, type ShortcutOptions } from "@ui-sdk/react/shortcuts"

type ShortcutLayer = ShortcutOptions["layer"]

type ShortcutRegistration = {
  /** Keys like `"u"`, `"mod+k"` or a sequence like `"g i"`. */
  keys: string
  handler: (event: KeyboardEvent) => void
  scope?: string
  layer?: ShortcutLayer
  description?: string
  allowInInput?: boolean
  when?: () => boolean
}

type ListedShortcut = {
  keys: string
  /** Each step formatted for this platform, like `["G", "I"]` or `["⌘K"]`. */
  steps: string[]
  description: string
  scope?: string
  scopeLabel?: string
}

type Entry = { keys: string; last: string[]; description?: string; scope?: string }

const SEQUENCE_TIMEOUT = 1200

const entries = new Set<Entry>()
const scopeCounts = new Map<string, number>()
const scopeLabels = new Map<string, string[]>()
const prefixes = new Map<string, { count: number; off: () => void }>()
let pending: { prefix: string; timer: ReturnType<typeof setTimeout> } | null = null
let listing = false

// Spec: a symbol or digit takes different modifiers on different layouts ("?" is Shift+/ in the US, Shift+' in
// Spain, AltGr or Option elsewhere; digits take Shift on AZERTY), so it matches with whichever of Shift, Alt or
// AltGr (Ctrl+Alt) made it. Letters stay exact, since Shift changes what they mean.
const producedWith = ["", "shift+", "alt+", "alt+shift+", "ctrl+alt+", "ctrl+alt+shift+"]

function variantsOf(step: string) {
  return /^[^\p{L}\s+]$/u.test(step) ? producedWith.map((modifiers) => `${modifiers}${step}`) : [step]
}

function stepsOf(keys: string) {
  return keys.trim().split(/\s+/)
}

function isTypingTarget(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const editable = element.closest("[contenteditable]")
  return editable !== null && editable.getAttribute("contenteditable") !== "false"
}

function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending = null
}

function startPending(prefix: string) {
  clearPending()
  pending = { prefix, timer: setTimeout(clearPending, SEQUENCE_TIMEOUT) }
  const onNext = (event: KeyboardEvent) => {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return
    document.removeEventListener("keydown", onNext, true)
    setTimeout(clearPending, 0)
  }
  document.addEventListener("keydown", onNext, true)
}

function retainPrefix(prefix: string) {
  const existing = prefixes.get(prefix)
  if (existing) {
    existing.count += 1
  } else {
    const offs = variantsOf(prefix).map((keys) =>
      registerShortcut(keys, () => startPending(prefix), {
        when: () => pending === null && !isTypingTarget(document.activeElement),
      }),
    )
    const off = () => {
      for (const unregister of offs) unregister()
    }
    prefixes.set(prefix, { count: 1, off })
  }
  return () => {
    const current = prefixes.get(prefix)
    if (!current) return
    current.count -= 1
    if (current.count > 0) return
    current.off()
    prefixes.delete(prefix)
  }
}

/** Registers a shortcut or a two-step sequence (`"g i"`) in UI SDK's shared shortcuts. Returns the cleanup. */
function addShortcut(registration: ShortcutRegistration) {
  const steps = stepsOf(registration.keys)
  const [first, second] = steps
  if (!first || steps.length > 2) throw new RangeError(`Shortcut "${registration.keys}" needs one or two steps.`)
  const userWhen = registration.when ?? (() => true)
  const typingOk = () => registration.allowInInput === true || !isTypingTarget(document.activeElement)
  const entry: Entry = {
    keys: registration.keys,
    last: variantsOf(second ?? first),
    description: registration.description,
    scope: registration.scope,
  }
  const options = { scope: registration.scope, layer: registration.layer, allowInInput: registration.allowInInput }
  const description = registration.description
  const offs =
    second === undefined
      ? entry.last.map((keys) =>
          registerShortcut(keys, registration.handler, {
            ...options,
            description,
            when: () => (listing || pending === null) && typingOk() && userWhen(),
          }),
        )
      : [
          retainPrefix(first),
          ...entry.last.map((keys) =>
            registerShortcut(
              keys,
              (event) => {
                clearPending()
                registration.handler(event)
              },
              {
                ...options,
                description,
                when: () => (listing || pending?.prefix === first) && typingOk() && userWhen(),
              },
            ),
          ),
        ]
  entries.add(entry)
  return () => {
    entries.delete(entry)
    for (const off of offs) off()
  }
}

function setScopeActive(name: string, active: boolean) {
  const count = Math.max(0, (scopeCounts.get(name) ?? 0) + (active ? 1 : -1))
  scopeCounts.set(name, count)
  shortcuts.setScope(name, count > 0)
}

function addScopeLabel(name: string, label: string) {
  const labels = scopeLabels.get(name) ?? []
  labels.push(label)
  scopeLabels.set(name, labels)
  return () => {
    const index = labels.indexOf(label)
    if (index !== -1) labels.splice(index, 1)
  }
}

function formatSteps(keys: string) {
  return stepsOf(keys).map((step) => formatShortcut(step))
}

/**
 * The shortcuts that can run now, with a description, in registration order. A modal pauses the page's
 * shortcuts, so a help dialog reads this before it opens.
 */
function listShortcuts(): ListedShortcut[] {
  listing = true
  let available: ReturnType<typeof shortcuts.list>
  try {
    available = shortcuts.list()
  } finally {
    listing = false
  }
  const known = [...entries]
  const claimed = new Set<Entry>()
  const result: ListedShortcut[] = []
  for (const info of available) {
    if (!info.description) continue
    const entry = known.find(
      (candidate) =>
        candidate.last.includes(info.keys) &&
        candidate.description === info.description &&
        candidate.scope === info.scope &&
        !claimed.has(candidate),
    )
    if (entry) claimed.add(entry)
    else if (known.some((candidate) => claimed.has(candidate) && candidate.last.includes(info.keys))) continue
    const keys = entry?.keys ?? info.keys
    result.push({
      keys,
      steps: entry ? formatSteps(keys) : [info.hint],
      description: info.description,
      scope: info.scope,
      scopeLabel: info.scope === undefined ? undefined : scopeLabels.get(info.scope)?.at(-1),
    })
  }
  return result
}

export { addScopeLabel, addShortcut, formatSteps, isTypingTarget, listShortcuts, setScopeActive, stepsOf }
export type { ListedShortcut, ShortcutLayer, ShortcutRegistration }
