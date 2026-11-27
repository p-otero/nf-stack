import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { ColorSchemeContext } from "@/components/nf/color-scheme";
import type { ColorScheme, ColorSchemeSource } from "@/components/nf/color-scheme";

const schemeOf = (state: { readonly resolved: string }): ColorScheme =>
  state.resolved === "dark" ? "dark" : "light";

/** Follows the page's color scheme so data URIs and chart marks can carry the matching logo. */
function ColorSchemeProvider({
  appearance,
  children,
}: {
  appearance: ColorSchemeSource;
  children: ReactNode;
}) {
  const { colorScheme } = appearance;
  const subscribe = useCallback(
    (onChange: () => void) => colorScheme.subscribe(onChange),
    [colorScheme],
  );
  const scheme = useSyncExternalStore(
    subscribe,
    () => schemeOf(colorScheme.get()),
    () => schemeOf(colorScheme.initialState),
  );
  return <ColorSchemeContext value={scheme}>{children}</ColorSchemeContext>;
}

export { ColorSchemeProvider };
