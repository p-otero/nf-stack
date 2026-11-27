---
name: eskais-mockup
description: Builds a throwaway, offline HTML mockup of a screen from a project's own React components, so a person can look at and click through a proposed interface without a build server, and shows the person every screen it built, in every state and theme, as images in the reply. Use when asked for a mockup, a preview, a design review or "show me what this screen would look like" in a project that ships components through a components.json and Tailwind. Runs with Bun only.
---

# Build a mockup

A mockup is one screen of the project's real components, with fixture data, built into a single HTML file that opens from disk, offline. It is a proposal, not a feature: no routes, no data fetching, no tests. The `screen.tsx` is the deliverable; `out.html` is a build artifact.

## Run the CLI

The CLI lives in the project at `.agents/tools/eskais-mockup/cli.ts`, installed from the registry like a component. It needs Bun 1.4 or newer and nothing else: no npm packages, and it builds with the project's own Tailwind, React and aliases, read from `components.json`, its stylesheet and `tsconfig.json`.

1. Look for it: `ls .agents/tools/eskais-mockup/cli.ts`. If it's missing, install it with `npx shadcn@latest add @eskais/eskais-mockup-cli` (the project's `components.json` names the `@eskais` registry).
2. Check Bun with `bun --version`. If it's missing or older than 1.4, ask the person before installing or upgrading it.
3. From the project root, run `bun .agents/tools/eskais-mockup/cli.ts <command>`. Below, `mockup` stands for that. `bun .agents/tools/eskais-mockup/cli.ts --version` prints the release it came from; update it with the same `add` and `--overwrite` when the project updates its components.
4. In a checkout of the eskais-ui repository (contributors), the same CLI is `packages/mockup/src/cli.ts`: run `bun <eskais-ui checkout>/packages/mockup/src/cli.ts <command>` from the project, where `<eskais-ui checkout>` is the path to your checkout of the repository.

## The five levels

Use the first level that can express the design, and never skip one:

1. **The project's components**, own or installed, through its aliases: `import { Button } from "@/components/ui/button"`. Aliases come from `components.json`, resolved through `tsconfig.json` `paths` or the package.json `imports` (`"#components/*": "./src/components/*"`, conditions and wildcards included), so `#components/ui/button` works too. `mockup inspect` lists them; `mockup inspect Button Card` prints each one's import line, `*Props` and `cva` variants.
2. **Eskais registry items the project has not installed**: `import { Badge } from "@registry/badge"`. `mockup inspect --registry` lists them with one-line descriptions. `build` fetches the item and its `registryDependencies` from the registry URL in `components.json` into `.mockups/.registry/<ref>/` (`<ref>` is the commit pinned in the URL, or a hash of it), and records `npx shadcn@latest add @eskais/badge` in `manifest.install`. Two items may ship the same file when the copies are byte-identical, as `shadcn add` overwrites it; different copies of one file are an environment error naming the file and both items. Only `inspect` and `build` use the network; `out.html` stays offline.
3. **Composition in `.mockups/<name>/parts/*.tsx`**, built from levels 1 and 2. A component with a `<Name>Props` type is recorded in `manifest.proposed` with its props:

   ```tsx
   export type MemberRowProps = { member: Member; onRemove?: (id: string) => void }
   export function MemberRow({ member, onRemove }: MemberRowProps) { … }
   ```

4. **UI SDK primitives** (`@ui-sdk/react/<subpath>`) only for behaviour Eskais has no part for. `mockup inspect --sdk` lists the installed subpaths; `mockup inspect --sdk file-input` gives one primitive's import line and parts. Style it only with the project's tokens, `cn`/`cva` and its visual parts (`buttonVariants`). The part file carries a reason, recorded in `manifest.sdkParts`; without it `validate` fails:

   ```tsx
   import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/react/file-input"

   // sdk-reason: Eskais has no file input; UI SDK's FileInput gives the dropzone, the picker and the agent actions
   export function AvatarDrop() { … }
   ```

5. **A gap, never a raw control.** No bare `<button>`, `<input>`, `<select>` or `<textarea>`. If levels 1–4 can't reach the design, record it in `.mockups/<name>/gaps.ts` and leave that part out, so a review sees what the screen costs:

   ```ts
   export const gaps = [
     {
       component: "Button",
       missing: "a split button with a menu of roles",
       reason: "no Eskais part or composition gives one control",
     },
   ]
   ```

## The loop

1. **`mockup inspect`** prints the project, stylesheet, Tailwind and React versions, themes, providers and the exports of every aliased file. Add `--json` to any `inspect` for JSON. Read this instead of opening component sources.
2. **Write** `.mockups/<name>/screen.tsx`, `fixtures.ts`, optional `parts/*.tsx`, optional `gaps.ts` and an optional shared `.mockups/wrapper.tsx`.
3. **`mockup validate <name>`** builds the page, checks types (with the referenced tsconfig that sets `jsx` when the root one only lists `references`), server-renders it, and prints every problem as `file:line:col rule message`, then a four-line summary:

   ```text
   ok .mockups/team/out.html  485 kB (305 kB js, 179 kB css, 75 kB fonts)
   install 2: badge, tone
   proposed 2: AvatarDrop (0 props), MemberRow (2 props)
   sdkParts 1: AvatarDrop ← @ui-sdk/react/file-input
   gaps 1: Button (a split button with a menu of roles)
   ```

   Rules: `no-network`, `bare-control`, `viewport-unit` (`h-screen`, `100dvh` and the like in the mockup's own files; installed blocks such as `Shell` may size to the viewport), `import-specifier` (an alias, a relative path, `@registry/` or a declared package), `sdk-subpath` (only public `@ui-sdk/react/<subpath>` entries), `sdk-reason`, `shadcn/no-raw-colors` and `shadcn/no-arbitrary-values` (in `parts/`), `type` and `render`. A UI SDK primitive that duplicates a part the project installs (a `dialog`, `select`, `tabs`…) is a warning. Exit codes: `0` fine, `1` problems to fix, `2` environment or usage error (no `components.json`, an unknown flag, an unreachable registry, or a fetched item whose npm packages the project doesn't declare). Fix and re-run until it prints `ok`.

4. **Build every state and theme** the person should see, one page each, named `out-<state>-<theme>.html` in the mockup's folder. A state is the same screen with other props: empty, loading, error, a long list. Export them from `fixtures.ts` as `states` (below), then `mockup build <name> --state empty --scheme dark` writes `out-empty-dark.html`, and `--state all` one page per state (`--state all --scheme dark` gives `out-empty-dark.html`, `out-loading-dark.html`…). The theme is the last segment (a theme name such as `compact` when `--theme` is set, or else the scheme: `light`, `dark` or `system`); `out.html` is the screen without props in the system theme, as `build` without `--state` writes it. `--out` names the page by hand; with `--state all` it needs `{state}`: `--out .mockups/<name>/out-{state}-dark.html`. `validate --state <name>|all` server-renders those states too and lists them (`states 3: empty, loading, error`).
5. **Capture each page as a PNG with the same name beside it** (`out-empty-dark.html` → `out-empty-dark.png`), with the host's browser or preview tool, or headless Chrome: `chrome --headless --hide-scrollbars --window-size=1280,800 --screenshot=out-empty-dark.png file:///<absolute path>/out-empty-dark.html`. Never read `out*.html` yourself: it is hundreds of kilobytes of inlined code.
6. **`mockup gallery`** writes `.mockups/gallery.html`, one offline page with every screenshot grouped by screen, state and theme, each linked to its page, and prints one line per screenshot (`screen  state  theme  png  html`) and then `gallery .mockups/gallery.html  6 screenshots: 2 screens, 4 states, 2 themes`. It exits `1` with `no screenshots in …` when there are none, and names every page that has no PNG. `validate --gallery` and `build --gallery` print the same last line, and `validate` reports `screenshots <n> (<pages> pages)` for its mockup. `--json` gives the list as JSON.
7. **Present** every screen (below). Then report the summary: what to install, the parts proposed, the UI SDK parts and why, and the gaps.

## Present every screen

This step is mandatory and finishes every mockup task. The person must see every screen you produced, in every state and theme, in your reply. Never only list, name or describe a screen they haven't seen.

1. Run `mockup gallery` (or `mockup gallery --json`) and take its list: every screenshot by screen, state and theme, with its PNG and its `out-*.html`. It walks the folders the CLI writes; `manifest.json` doesn't list screenshots. If it names a page with no screenshot, capture it and run `gallery` again.
2. In your reply, under a heading per screen, embed each PNG as an image, alt text `<screen>, <state> state, <theme> theme`, with its `out-*.html` path beside it:

   ```markdown
   ### team

   ![team, empty state, dark theme](/abs/path/.mockups/team/out-empty-dark.png)
   `.mockups/team/out-empty-dark.html`
   ```

   Use the path form your host renders as an image (an absolute path, or a path relative to the project); a link to the PNG is not an image.

3. Link the gallery: `.mockups/gallery.html` opens from disk, and the `.mockups` folder can be zipped and shared as it is.
4. Count the images in your reply. The count must equal the number in the `gallery` line (`6 screenshots`). If it doesn't, add the missing ones before you finish.
5. Relaying another agent's mockups (a coordinator reporting a worker's result): keep every image and its path in your reply. Never summarise screenshots into words, and run the count again on what you pass on.

## The files

- `screen.tsx` default-exports a component taking its data as props: `{ members = sampleMembers }: { members?: Member[] }`. Presentational only: no fetching, no `window`, no router. Behaviour is React state plus `setTimeout` promises for a saving or deleting state.
- **Start a screen from a layout block** when one fits, and fill its slots instead of laying out the page by hand: `@registry/master-detail` for a list with a detail pane, `@registry/dashboard-grid` for a dashboard, `@registry/settings-page` for a settings page.
- `fixtures.ts` types the data and exports a sample of it. Reuse the project's own types when they import cleanly through an alias. It may export `states`: an object of named states, each the props the screen gets in it. Names are letters, digits, `-` and `_` (not `all`); they name the files.

  ```ts
  export type Environment = { id: string; name: string; status: "running" | "stopped" }
  export type ScreenProps = { environments?: Environment[]; loading?: boolean; error?: string }

  export const sampleEnvironments: Environment[] = [{ id: "web", name: "web", status: "running" }]

  export const states = {
    empty: { environments: [] },
    loading: { loading: true },
    error: { error: "The environments could not be listed" },
    "long-list": {
      environments: Array.from({ length: 40 }, (_, index) => ({
        id: `env-${index}`,
        name: `env-${index}`,
        status: "stopped" as const,
      })),
    },
  } satisfies Record<string, ScreenProps>
  ```

  The screen takes those props with defaults, `export default function Environments({ environments = sampleEnvironments, loading = false, error }: ScreenProps)`, so `out.html` still shows the sample.

- `parts/<part>.tsx`, `gaps.ts`: levels 3–5 above.
- `.mockups/wrapper.tsx` (optional, shared by every mockup) is `({ children }) => providers`, for a theme, i18n or query provider the app entry installs.
- `build` writes `.mockups/.gitignore` with `*`: mockups and the registry cache stay out of the repository. Never edit the project's own `.gitignore`.
- `out-<state>-<theme>.html` and `.png`: one page and one screenshot per state and theme; `gallery.html` in the folder you pass to `gallery`.
- `manifest.json`, written by `build`, records the hashes, the project components the page bundled, `install`, `proposed`, `sdkParts`, `gaps` and the size.

The page ships with no network: every font and image is inlined. Set `font-sans` on the screen's root when the project's font comes from its theme.

## Rules

- Read the project's `AGENTS.md` first, if it has one: spacing, colour and typography roles apply to the screen as much as to a component.
- Start a whole screen from a block rather than composing its frame: an application screen inside `Shell` (`@registry/shell`, from a list of routes), a documentation page inside `DocsLayout`, a landing page from `landing-page`. Put only the page's own content in `parts/`.
- A notes, wiki or docs-editing screen starts from `@registry/document-workspace`: fill its slots (`explorer`, `tabs`, `document`, `aside`, `quickOpen`…) with `MarkdownEditor` or `MarkdownView` instead of laying out columns, drawers and a mode switch in `parts/`.
- `parts/` use theme tokens and the Tailwind scale: no `bg-white`, `text-[#hex]`, `w-[13px]` or other raw colours and arbitrary sizes (`max-h-[calc(100%-2rem)]` and `w-[calc(100%-2rem)]` are allowed).
- If a component can't do what the design needs, change the screen or record a gap, not the project: never edit `src/components/`, the theme or installed registry files for a mockup.
- One page per scheme when the person wants both: `mockup build <name> --scheme light --out .mockups/<name>/out-light.html` and `--scheme dark --out .mockups/<name>/out-dark.html`. `--theme compact` applies a density theme; `--scheme system` (the default) follows the viewer.
- `mockup clean <name>` removes one mockup; `mockup clean` removes the whole `.mockups` folder, registry cache included.
- Other flags: `--project <dir>` when the project isn't the current folder, `--css <file>` to use another stylesheet (it chooses only the stylesheet; the tsconfig stays the project's), `--tsconfig <file>` for another tsconfig, `--max <n>` to print more than 20 problems.
- In a workspace, where `components.json` sits in a package (`packages/ui`) and only an app (`apps/web`) installs Tailwind or React, the CLI finds them from the workspace root, its packages and pnpm's or Bun's store, hoisted or not; never copy stylesheets or link `node_modules` by hand. If it picks the wrong copy, or none, pass `--tailwind apps/web`, the folder of a package that installs Tailwind.
