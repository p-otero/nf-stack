"use client"

import { useEffect, useState } from "react"

import { toTime, type Instant } from "@/lib/time"

interface UseNowOptions {
  now?: Instant
  intervalMs?: number
}

function useNow({ now, intervalMs = 30_000 }: UseNowOptions = {}) {
  const fixed = now === undefined ? undefined : toTime(now)
  const [tick, setTick] = useState(() => fixed ?? Date.now())

  useEffect(() => {
    if (fixed !== undefined) return
    let timer: ReturnType<typeof setInterval> | undefined
    const update = () => setTick(Date.now())
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      stop()
      if (!document.hidden) timer = setInterval(update, intervalMs)
    }
    const onVisibilityChange = () => {
      if (document.hidden) return stop()
      update()
      start()
    }
    // The first render may come from the server, so resync once mounted.
    update()
    start()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [fixed, intervalMs])

  return fixed ?? tick
}

export { useNow }
export type { UseNowOptions }
