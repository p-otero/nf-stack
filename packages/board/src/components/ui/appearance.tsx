"use client"

import { Preferences } from "@ui-sdk/react/preferences"
import type { ReactNode } from "react"

import { useConnectedAppearance } from "@/components/ui/use-appearance"
import {
  createAppearance,
  densities,
  radii,
  type Appearance as AppearanceState,
  type Density,
  type Radius,
} from "@/lib/appearance-state"

type AppearanceProps<Theme extends string, Palette extends string> = {
  appearance: AppearanceState<Theme, Palette>
  children?: ReactNode
}

/**
 * Keeps `.dark`, `data-color-scheme`, `data-theme`, `data-palette`, `data-density` and `data-radius` on `<html>` in sync
 * with `appearance` while it's mounted.
 */
function Appearance<Theme extends string, Palette extends string>({
  appearance,
  children,
}: AppearanceProps<Theme, Palette>) {
  useConnectedAppearance(appearance)
  return <Preferences preferences={[appearance.colorScheme]}>{children}</Preferences>
}

export { Appearance, createAppearance, densities, radii }
export type { AppearanceProps, AppearanceState, Density, Radius }
