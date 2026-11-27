import { useEffect, useEffectEvent, useRef } from "react"

import type { DiffViewController } from "@/components/ui/diff-view-primitive"

/**
 * Scrolls the diff to `currentFile` when the caller changes it, and not when it only echoes the file the diff
 * reported while scrolling: call the returned function with each file the diff reports.
 */
function useOpenCurrentFile(
  controller: DiffViewController,
  currentFile: string | null | undefined,
  known: (path: string) => boolean,
) {
  const shown = useRef<string | null>(null)
  const isKnown = useEffectEvent(known)
  useEffect(() => {
    if (currentFile == null || currentFile === shown.current || !isKnown(currentFile)) return
    shown.current = currentFile
    controller.openFile(currentFile)
  }, [controller, currentFile])
  return (path: string | null) => {
    shown.current = path
  }
}

export { useOpenCurrentFile }
