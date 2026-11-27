"use client"

import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react"

import type { useListContext } from "@/components/ui/list"

type ListRegister = NonNullable<ReturnType<typeof useListContext>>["register"]

/** Whether `node`'s text overflows its line clamp, followed as it resizes. */
function useTruncated(node: HTMLElement | null) {
  const [truncated, setTruncated] = useState(false)
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return
    const measure = () => setTruncated(node.scrollHeight - node.clientHeight > 1)
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [node])
  return truncated
}

/**
 * Registers the item with its List under `id`. An option is activated by the listbox, so its handle never acts;
 * otherwise `activate` runs with the latest props, without registering again when they change.
 */
function useListItemRegistration(
  register: ListRegister | undefined,
  id: string,
  title: string,
  option: boolean,
  activate: () => boolean,
) {
  const onActivate = useEffectEvent(activate)
  useLayoutEffect(() => {
    if (!register) return
    return register(id, { label: title, activate: option ? () => false : () => onActivate() })
  }, [register, option, id, title])
}

/** Keeps `value` in `map` under `id` while the component is mounted. */
function useHandleEntry<Value>(map: Map<string, Value>, id: string, value: Value) {
  useLayoutEffect(() => {
    map.set(id, value)
    return () => {
      if (map.get(id) === value) map.delete(id)
    }
  }, [map, id, value])
}

export { useHandleEntry, useListItemRegistration, useTruncated }
