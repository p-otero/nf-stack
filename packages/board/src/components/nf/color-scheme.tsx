import { createContext, useContext } from "react";

/** The two schemes the board paints: a light or dark surface, never "system". */
export type ColorScheme = "light" | "dark";

/** The part of the UI SDK color scheme this page reads; `AppearanceState` satisfies it. */
type ColorSchemeSource = {
  readonly colorScheme: {
    get(): { readonly resolved: string };
    subscribe(listener: () => void): () => void;
    readonly initialState: { readonly resolved: string };
  };
};

const ColorSchemeContext = createContext<ColorScheme>("light");

const useColorScheme = (): ColorScheme => useContext(ColorSchemeContext);

export { ColorSchemeContext, useColorScheme };
export type { ColorSchemeSource };
