import { useSyncExternalStore } from "react"

/** The page's language: `<html lang>`, or undefined when it has none or there is no document. */
function pageLocale(): string | undefined {
  if (typeof document === "undefined") return undefined
  return document.documentElement.lang || undefined
}

function subscribe(notify: () => void) {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {}
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] })
  return () => observer.disconnect()
}

const onServer = () => undefined

/**
 * The locale to format numbers and dates in: `locale` when given, else the page's `<html lang>`, followed as it
 * changes. Without either, undefined, which `Intl` reads as the runtime's default. The server and the first client
 * render skip the page's language, so hydration matches, as UI SDK's Meter and Progress do.
 */
function useLocale(locale?: string): string | undefined {
  const page = useSyncExternalStore(subscribe, pageLocale, onServer)
  return locale ?? page
}

export { pageLocale, useLocale }
