---
name: eskais-perf
description: Keeps screens built with Eskais UI fast. Use when a screen renders long lists or tables, feels slow to type in, scroll or navigate, when adding effects, animations, glass or blur, when React Compiler is on, or when asked to profile or speed up a page in a project that installs @eskais components. Load it with the eskais-ui skill.
---

# Keep Eskais screens fast

Eskais components are already built to stay cheap: rows virtualize, effects live in hooks, motion is transform and opacity on short timings, and glass is opt-in. Most slow screens come from the code around them. Check these in order, then measure.

## Long lists and tables

- **Never map thousands of rows by hand.** Use `List items getItemId renderItem itemText` (rows) or `DataTable`. Past 200 rows they render only the rows in view (`virtualize="auto"`, through the `virtual-rows` item), and keep every row reachable: keyboard (`row-navigation`), agents' `select`/`setSelection` by id, and find in page through UI SDK's findable layers (`hidden="until-found"` stand-ins). A `.map()` of 2,000 `ListItem`s loses all three and paints about eight times slower.
- **Give the list a bounded height.** Virtual rows scroll with the nearest scrolling ancestor, else the window: put the list in a `min-h-0 flex-1 overflow-y-auto` parent, or pass `className="max-h-96"` to a `DataTable`. A parent that grows with its content renders every row.
- **Pass `estimateSize`** close to a row's real height in px, so the scrollbar doesn't jump while rows are measured.
- **Keep `renderItem` cheap and stable.** Rows are memoized: scrolling renders only the rows that enter. Read data in the row, don't compute it there; pass callbacks and arrays that keep their identity (`renderCardActions` on `AgentTaskBoard`, `renderItem`, a `DataTable`'s `columns` and row objects), or every row re-renders on every parent render. Define `columns` at module level or memoize it. React Compiler memoizes them for you; without it, use `useCallback` and `useMemo`.
- **Cards and grouped lists don't virtualize.** A board column or a `ListGroup` of hundreds of cards needs paging or a filter, not more cards.
- **Diffs:** `TextDiff` and `GitDiff` put every file and line in one virtualized scroller, so never render one diff per file in a `.map()`. Keep them in one scroller (`TextDiff` grows to the whole diff and its rows follow the nearest scrolling ancestor or the page; `GitDiff` fills its parent, or with `height="auto"` grows the same way), pass `labels` as a constant, leave `wrap` off for the largest diffs (unwrapped rows aren't measured), and let `TextDiff` move big inputs to its worker instead of diffing them yourself during render.
- **Streaming logs:** feed a `createLogStore` from the socket or process and render one `LogViewer`; never keep log lines in React state or a growing `CodeBlock`. `append` is cheap and the viewer renders once per frame (every few frames when a flood makes rendering slow), only the lines in view, so 2,000 lines a second keep key to paint near 14 ms at 1× CPU. Pass `append` an array per chunk rather than one call per line, keep `maxLines` to what people scroll back through (10,000 by default), and give the viewer a bounded height.
- **Long pages of sections:** the theme's `content-auto` utility sets `content-visibility: auto` with an intrinsic height (`--intrinsic-height`, 24rem by default), so the browser skips rendering what's off screen.

## Effects stay out of components

- A component renders; side effects live in your handlers (`onConfirm`, `onSearch`, `onSubmit`) or in a hook module (`use-*.ts` next to the component, or `hooks/`). `@eskais/lint-rules` already rejects state set or derived in an effect (`react/set-state-in-effect`, `react/no-deriving-state-in-effects`); to enforce effects in hooks as Eskais does, also extend `node_modules/@p-otero/oxlint-rules/presets/react-agents.json` (`p-otero/no-effect-outside-hooks`, `p-otero/prefer-sync-external-store`).
- Before writing an effect, try in this order: derive the value during render; act in the event handler that caused the change; read an external store with `useSyncExternalStore`; read the latest props inside an effect with `useEffectEvent`.
- Never mirror a prop into state with an effect (`useEffect(() => setX(props.x))`): it renders twice and paints a stale frame between.
- One clock per screen: `useNow()` once, passed down as `now` to `RelativeTime`, `TaskCard` and friends, never one timer per time. `AgentTaskBoard` does this itself and pauses while the page is hidden.
- Remote options: `useAsyncOptions` from `@ui-sdk/react/async-options` debounces, aborts stale requests through `signal` and keeps the last results while loading. Don't add your own debounce or loading state around it.

## React Compiler

Eskais components and hooks compile with `babel-plugin-react-compiler`. Keep your code compilable too, or the compiler skips the whole component and nothing in it is memoized:

- no `try … finally` in a component or hook, no conditional inside a `try`, and no default parameter built with `||` or `&&`; move that work into a plain function outside the component;
- no mutation of props, state or values read during render; no reading or writing `ref.current` during render;
- hooks at the top level, never in a condition or loop.

`@eskais/lint-rules` reports the render-purity ones (`react/purity`, `react/refs`, `react/immutability`, `react/rules-of-hooks`). With the compiler on, a hand-written `useMemo` or `useCallback` in a compiled component is redundant; keep it where the component can't compile.

## Motion

- **Animate `transform` and `opacity`** (and `translate`, `scale`), which the compositor runs without layout. Floating labels move with `translate` and `scale`; popovers, menus and dialogs fade and scale. Never transition `top`, `left`, `width`, `height`, `margin` or `box-shadow` on something large or frequent.
- `Accordion` and `Collapsible` animate their panel's measured height; that's fine for a panel of text, not for a panel holding a long list. Show the list in a `SidePanel` or a page instead.
- Time transitions with the role tokens (`duration-micro` 140ms, `duration-panel` 180ms, `duration-dialog` 200ms, `ease-standard`), never longer: a slow transition reads as a slow app. Never `transition-all` on your own large surfaces; name the properties.
- `prefers-reduced-motion: reduce` collapses transitions in the theme already; add `motion-reduce:` only to swap a movement for a fade.

## Blur and glass

`backdrop-filter` re-renders everything behind the element on every frame it moves or the content under it changes.

- Keep it on small chrome: popovers, menus, toasts, a sidebar, cards in the `glass` theme. `surface-floating` and `backdrop-floating` blur by default; `backdrop-surface` blurs only under `data-theme="glass"`.
- A `backdrop-surface` inside another one doesn't blur again, so cards in a glass board column or panel cost one blur between them, not one each. Keep your own glass containers on `backdrop-surface` for that, rather than a `backdrop-blur-*` per item.
- Never put `backdrop-floating`, `backdrop-surface` or your own `backdrop-blur-*` on a large surface that animates, scrolls over moving content or covers most of the viewport. Dialogs and drawers are opaque in every theme for this reason, and for contrast.
- `data-elevation="flat"` on `<html>` or any ancestor drops the floating shadow, blur and translucency, also inside a glass scope: use it for a dense data screen or a low-end device.

## Links

- `Link`, `ButtonLink`, `NavigationMenuLink` and `FastLinkRegion` follow a same-origin link on mouse **press**, not release, so navigation starts sooner. Give them `onNavigate` (or `onFollow`, which also offers agents a `follow` action) with your router, so the press routes on the client instead of reloading.
- **Preload on intent.** `onIntent(href)` on `Link`, `SidebarItem`, `NavigationMenuLink`, `ButtonLink` and `Shell` runs on a 65 ms hover, focus or a mouse press: start the route's `lazy()` chunk and its data there. On the Eskais docs site, a page whose code wasn't loaded yet finishes about 20 ms after the press when the pointer rested on the link for 150 ms first, against about 415 ms without. Load route code through a promise you cache and read with `use`, not through `lazy()` alone: a lazy component suspends once even when its module is loaded, and React then keeps the fallback up for about 300 ms. Keep it idempotent; it can run more than once per visit.
- **Navigation only.** A press can't be cancelled by moving away (WCAG 2.5.2), so actions stay on `Button`s and menu items, and a link that confirms or changes something gets `fast={false}`. `data-no-fast-link` on an ancestor opts out a region, or the app on `<body>`.

## Loading

- `CodeBlock` loads each language's parser on first use, and `MarkdownView` defers re-parsing (`useDeferredValue`) and memoizes each top-level block: a long note re-renders only what changed. Don't pre-load parsers or re-render the whole document yourself.
- `DataState` keeps the last successful data on screen, `aria-busy`, during a refetch: no flash of a spinner and no layout jump. Pass `placeholderData` for a busy first paint instead of an empty one.
- Split big, rarely opened screens with `React.lazy` at the route, not inside a list row. The two heaviest items are `markdown-editor` (about 235 KB gzip with CodeMirror, plus about 500 KB of optional language parsers loaded on first use) and `chart` (about 120 KB with Recharts); `dialog` and `button` are about 54 KB, two thirds of it UI SDK shared by every item. Load the editor or chart where it shows: `const MarkdownEditor = lazy(() => import("@/components/ui/markdown-editor").then((m) => ({ default: m.MarkdownEditor })))` behind a `Suspense` with a placeholder of the same size, and start the import on intent (`onIntent`) when a link leads there.

## Load and layout shift

Content that moves while the page loads (Cumulative Layout Shift) makes people press the wrong thing. Eskais's own blocks and server-data components load at a CLS of 0.01 or less; keep yours there.

- Give every image its size: `width` and `height` (its own pixels) on an `<img>` or `ThemedImage`, or an `aspect-*` box. The theme's `height: auto` then reserves the box at that ratio before the image arrives. In Markdown, write the size after a `|` in the alt text (`A chart|640x360`, as Obsidian does), or answer `MarkdownView imageSize(src, alt)`. A `Carousel` slide, a card cover or a hero image of unknown size gets an `aspect-*` box.
- Keep a loading state the size of what replaces it. `DataTable` placeholder rows are one text line high; `ServerDataTable` and `ServerList` show as many placeholders as push their footer out of view, so the first page lands without moving it. In your own `DataState loading`, `Suspense fallback` or skeleton, match the content's height, or make it tall enough that nothing below it is in view.
- Put what sits below lazily loaded content inside the same `Suspense` boundary, so it appears with the content instead of under the spinner. A pager, a footer or the next section under a fallback moves when the content arrives.
- Don't wait for everything to show the top: render the title at once and let the part that needs the loaded code wait, behind a fallback as tall as the viewport. Making a whole docs page wait for its example cost 330 ms of LCP; this costs none.
- Prefer real size over `content-visibility: auto`. Measured on Eskais: 1,000 list rows mounted 2.2× slower with it; settings sections, dashboard cards and docs sections showed no gain; a long MarkdownView mounted 13–20% faster but scrolling to a heading landed 136 px off, as blocks above rendered at their real height. Use it only on a few large, independent blocks you never scroll to programmatically, and measure.
- Reserve space for content that arrives after load, like a banner or an ad: a `min-h-*` box, or insert it below the fold.

Eskais holds these per key press in CI, as exact counts on a production build: components React renders (the most any of 20 presses caused) and forced layouts (style or layout computed inside a script). Keep your screens in the same range, and treat a count that grows with the number of rows as a bug.

| Interaction                                   | Renders per press               | Forced layouts | Key to next paint, p95 (1× / 4× CPU) |
| --------------------------------------------- | ------------------------------- | -------------- | ------------------------------------ |
| `List`, 1,000 rows, j/k                       | 10, the two rows that change    | 2              | 8.5 / 25 ms                          |
| `List`, 10,000 rows, virtualized              | 36                              | 2.7            | 10.3 / 17 ms                         |
| `DataTable`, 1,000 rows, ↓                    | 95                              | 3.4            | 12.1 / 23 ms                         |
| `DataTable navigation="cells"`, arrows        | 4, two cells                    | 2.2            | 8.9 / 19 ms                          |
| `Board`, 200 cards, arrows and j/k            | 4, the two cards' primary parts | 4.9            | 11.5 / 32 ms                         |
| Menu, sidebar, Shell sidebar, a tree explorer | 0                               | 1–3            | 8.8 / 10.4 ms                        |
| Command palette of 300, ↓                     | 6, the row that scrolls in      | 1              | 10 / 14 ms                           |

Other numbers Eskais measures: a 20,000-line `TextDiff` or a 500-file `GitDiff` paints first in about 150 ms and j/k to the next hunk stays under 20 ms at the 95th percentile; a 50,000-commit history paints in about 70 ms and 100,000 files in a `GitTree` in about 140 ms, a held arrow in either under 13 ms; a 200-card board holds 16 composited layers at rest, 26 in the glass theme; the 300-command palette paints its first frame 26 ms after the key (141 ms at 4×); a docs page whose code was preloaded on a 150 ms hover is complete 19 ms after the press, against 413 ms without the preload. A frame is 16 ms at 60 Hz; on a 4× slower CPU (a mid-range phone) aim for under 50 ms.

In the Eskais repository, `bun run perf` measures all of this in Chrome (Playwright and the DevTools protocol) on the normal and React Compiler builds at 1× and 4× CPU, and `bun run perf:ci` checks the counts and every item's gzip size in about a minute. To check a change there:

1. Run `bun run perf:ci`. A count over budget names the scenario: read its renders first (an unstable prop or callback makes rows render that didn't change), then its forced layouts (a layout read right after a DOM write).
2. Compare times with interleaved runs: build the version before and after under names (`--builds=normal@before`, then `normal@after` after the change), run both with `--no-build --repeat=3 --only=<scenarios>`, and compare medians. One run at 4× can move by half; counts don't.
3. Read p50 and p95 key to next paint, then the held key at 4× (30 Hz autorepeat for 2 s): lag and dropped frames show whether the screen keeps up.

In your own project, measure a production build the same way (a development build is several times slower and misleads):

1. **React Profiler.** In React DevTools, Profiler tab: record the interaction, then read which components rendered and why ("Record why each component rendered while profiling" in its settings). A row that renders when another row changes means an unstable prop or callback. In code, wrap a subtree in `<Profiler id onRender>` to count renders per press.
2. **Performance panel.** In Chrome DevTools, Performance: set CPU throttling to 4× slowdown, record the interaction, and look for long tasks (over 50 ms), layout and paint after each input, forced reflows (purple inside a script), and "Recalculate style" spikes from blur or `transition-all`. The live metrics view shows Interaction to Next Paint for each click and key press.
3. **Rendering tools.** In Chrome DevTools, Rendering: "Paint flashing" shows what repaints while you scroll or animate, and "Layer borders" shows composited layers; a blurred surface that flashes on every frame is a `backdrop-filter` to remove.

Compare before and after on the same machine and build, and keep the change only if the numbers move.
