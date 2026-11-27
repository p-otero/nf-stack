function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Whether `value` is one of `list`, typed as that member: `isOneOf(VIEWS, view)` narrows `view` to a view. */
function isOneOf<const T>(list: readonly T[], value: unknown): value is T {
  const members: readonly unknown[] = list
  return members.includes(value)
}

/** A string array, as an action's untyped argument or a filter's value arrives. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

type ElementTypes = {
  Element: Element
  HTMLElement: HTMLElement
  HTMLInputElement: HTMLInputElement
  HTMLSelectElement: HTMLSelectElement
  HTMLImageElement: HTMLImageElement
  HTMLTextAreaElement: HTMLTextAreaElement
}

/**
 * `value instanceof HTMLElement` (or another element constructor by name), also for a node from another window, such
 * as an iframe's, whose constructors are its own. Safe on the server, where there are no elements.
 */
function isElementOf<N extends keyof ElementTypes>(value: unknown, name: N): value is ElementTypes[N] {
  if (!isRecord(value)) return false
  const own: unknown = globalThis[name]
  if (typeof own === "function" && value instanceof own) return true
  const view: unknown = isRecord(value.ownerDocument) ? value.ownerDocument.defaultView : undefined
  const theirs: unknown = isRecord(view) ? view[name] : undefined
  return typeof theirs === "function" && theirs !== own && value instanceof theirs
}

/**
 * `Object.keys` typed as the object's own keys. TypeScript returns `string[]` because an object may carry more keys
 * than its type names; use it only on objects the module built itself (a constant table), never on input.
 */
function keysOf<T extends object>(object: T): (keyof T & string)[] {
  const unchecked: any = Object.keys(object)
  return unchecked
}

/**
 * A record with one entry per key. `Object.fromEntries` returns `{ [key: string]: V }`, which TypeScript won't take
 * as having every key of a union, though the loop gives it each one.
 */
function recordOf<const K extends PropertyKey, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
  const unchecked: any = {}
  const record: Record<K, V> = unchecked
  for (const key of keys) record[key] = value(key)
  return record
}

/**
 * The last resort: tells TypeScript a value's type where it can't follow it and no runtime check fits, such as a
 * generic that variance won't relate or an upstream type narrower than what the library hands over. Every call says
 * why in a comment above it; a test counts the calls.
 */
function assumeType<T>(value: unknown): T {
  const unchecked: any = value
  return unchecked
}

export { assumeType, isElementOf, isOneOf, isRecord, isStringArray, keysOf, recordOf }
export type { ElementTypes }
