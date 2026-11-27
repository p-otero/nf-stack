import { createColorScheme, createPreference, type ColorSchemeValue, type ValueStorage } from "@ui-sdk/core"
import { assumeType } from "@/lib/narrow"

const defaultThemes = ["default", "compact", "glass"] as const
const defaultPalettes = ["default", "neutral", "blue", "violet", "green", "orange"] as const
const densities = ["default", "compact"] as const
const radii = ["default", "none", "sm", "md", "lg", "full"] as const

/** `data-density` on `<html>`: `"default"` leaves it off. */
type Density = (typeof densities)[number]
/** `data-radius` on `<html>`: `"default"` leaves it off, so the shape derives from `--radius`. */
type Radius = (typeof radii)[number]

type AppearanceOptions<Theme extends string, Palette extends string> = {
  /** `"system"` (default) follows the browser's `prefers-color-scheme`, live. */
  colorScheme?: ColorSchemeValue
  /** The `data-theme` on `<html>`; `"default"` leaves the attribute off. */
  theme?: NoInfer<Theme>
  themes?: readonly Theme[]
  /** The `data-palette` on `<html>` (from `@eskais/palettes`); `"default"` leaves it off, keeping your own seeds. */
  palette?: NoInfer<Palette>
  palettes?: readonly Palette[]
  /** The `data-density` on `<html>`: `"compact"` tightens sizes, spacing and type, apart from the radius. */
  density?: Density
  /** The `data-radius` on `<html>`: `"none"`, `"sm"`, `"md"`, `"lg"` or `"full"`, apart from the density. */
  radius?: Radius
  /** Where each choice is kept between visits, from `createLocalStorage` and friends. */
  storage?: {
    colorScheme?: ValueStorage
    theme?: ValueStorage
    palette?: ValueStorage
    density?: ValueStorage
    radius?: ValueStorage
  }
}

function setAttribute(html: HTMLElement, name: string, value: string) {
  if (value === "default") html.removeAttribute(name)
  else html.setAttribute(name, value)
}

function createAppearance<
  Theme extends string = (typeof defaultThemes)[number],
  Palette extends string = (typeof defaultPalettes)[number],
>(options: AppearanceOptions<Theme, Palette> = {}) {
  // Without `themes` or `palettes`, the type parameters keep their defaults, the names of these lists; TypeScript
  // can't tie a generic's default to the argument being left out.
  const themes = options.themes ?? assumeType<readonly Theme[]>(defaultThemes)
  const palettes = options.palettes ?? assumeType<readonly Palette[]>(defaultPalettes)
  const colorScheme = createColorScheme({
    defaultValue: options.colorScheme ?? "system",
    global: true,
    storage: options.storage?.colorScheme,
  })
  const theme = createPreference<Theme>({
    values: themes,
    defaultValue: options.theme ?? themes[0]!,
    attribute: "data-theme",
    global: true,
    storage: options.storage?.theme,
  })
  const palette = createPreference<Palette>({
    values: palettes,
    defaultValue: options.palette ?? palettes[0]!,
    attribute: "data-palette",
    global: true,
    storage: options.storage?.palette,
  })

  const density = createPreference<Density>({
    values: densities,
    defaultValue: options.density ?? "default",
    attribute: "data-density",
    global: true,
    storage: options.storage?.density,
  })
  const radius = createPreference<Radius>({
    values: radii,
    defaultValue: options.radius ?? "default",
    attribute: "data-radius",
    global: true,
    storage: options.storage?.radius,
  })

  /** Writes the current choice to `<html>`. Call it before the first render to avoid a flash. */
  function apply() {
    if (typeof document === "undefined") return
    const html = document.documentElement
    const scheme = colorScheme.get()
    html.classList.toggle("dark", scheme.resolved === "dark")
    // The theme's no-JS dark fallback reads this, so an explicit light choice beats a dark system before any render.
    html.setAttribute("data-color-scheme", scheme.value)
    setAttribute(html, "data-theme", theme.get().value)
    setAttribute(html, "data-palette", palette.get().value)
    setAttribute(html, "data-density", density.get().value)
    setAttribute(html, "data-radius", radius.get().value)
  }

  /** Applies now and on every change, the browser's scheme included, until the returned function runs. */
  function connect() {
    apply()
    const stops = [colorScheme, theme, palette, density, radius].map((preference) => preference.subscribe(apply))
    return () => {
      for (const stop of stops) stop()
    }
  }

  return { colorScheme, theme, palette, density, radius, apply, connect }
}

type Appearance<Theme extends string = string, Palette extends string = string> = ReturnType<
  typeof createAppearance<Theme, Palette>
>

export { createAppearance, defaultPalettes, defaultThemes, densities, radii }
export type { Appearance, AppearanceOptions, Density, Radius }
