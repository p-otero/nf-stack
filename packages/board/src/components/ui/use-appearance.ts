"use client"

import { useLayoutEffect } from "react"

/** Connects `appearance` to `<html>` while the caller is mounted; `connect` returns the disconnect. */
function useConnectedAppearance(appearance: { connect: () => () => void }) {
  useLayoutEffect(() => appearance.connect(), [appearance])
}

export { useConnectedAppearance }
