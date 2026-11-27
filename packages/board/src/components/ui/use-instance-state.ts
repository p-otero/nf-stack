import type { PrimitiveInstance } from "@ui-sdk/core"
import { useSyncExternalStore } from "react"
import { assumeType } from "@/lib/narrow"

/** A primitive instance's state, re-rendering the component that reads it on every change. */
function useInstanceState<State>(instance: PrimitiveInstance): State {
  // UI SDK types `PrimitiveInstance.get()` as `object`; the caller names its primitive's state, `typeof handle.state`.
  return assumeType<State>(useSyncExternalStore(instance.subscribe, instance.get, instance.get))
}

export { useInstanceState }
