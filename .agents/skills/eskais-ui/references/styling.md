# Styling

Part of the `eskais-ui` skill.

## Spacing

Pick spacing by the relationship between the things it separates, never by a number; each role tightens under `data-density="compact"` (or the `data-theme="compact"` alias).

| Utility                           | Role                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `gap-inline`                      | icon + text, or parts inside one control, chip or row                            |
| `gap-items`                       | siblings in a list or stack: cards in a column, chips, buttons, form fields      |
| `gap-group`                       | groups inside a surface: header vs body, dialog sections                         |
| `gap-section`                     | surfaces on a page                                                               |
| `px-inset-chip` / `py-inset-chip` | pills, badges, chips, kbd                                                        |
| `px-inset-item` / `py-inset-item` | menu and list items, small cards, table cells                                    |
| `px-control-x`                    | buttons, inputs, selects                                                         |
| `p-inset-surface`                 | cards, dialogs, panels, popovers (`p-surface` is an alias)                       |
| `p-control-inset`                 | the rim of a control-height bar around `-sm` items (tab list, segmented control) |

- `inline`, `items`, `group`, `section` and `inset-surface` work with any spacing utility (`p-inline`, `pb-group`, `-mx-inline`). The chip and item insets are `px-`/`py-` only; otherwise use the variable, as in `-mx-(--item-padding-x)`.
- Components never set their own outer margin; the parent spaces children with `gap-*`. Pass margin through `className` only when composing.
- Sizes (`size-*`, `h-*`, `w-*`) aren't spacing; prefer `h-control` and friends.
- With `@eskais/lint-rules`, `p-otero/spacing-tokens` warns on numeric spacing (`gap-2`, `md:px-1`). The exceptions are `0`, `px`, and a disable comment that gives the reason.

## Tone

Status meaning has one vocabulary across Badge, Alert, StatusPill, StatusDot, Progress, Meter and Toast: `tone` is `neutral`, `info`, `success`, `warning` or `destructive` (`Tone` from `@/lib/tone`). Badge's `variant` is only its untoned look (`default`, `secondary`, `outline`); `variant="success"` and friends still work but are deprecated. A toast's tone comes from its type (`toastTone`: `error` is `destructive`).

## Elevation

Surfaces (cards, columns, panels) use `shadow-surface`. Anything that floats (popover, menu, list popup, toast, dialog, a `Floating` bar) uses the floating level: `surface-floating`, or its parts `shadow-floating`, `rounded-floating`, `bg-floating`, `backdrop-floating`, `border-floating-border`. Tokens: `--floating-shadow`, `--floating-radius`, `--floating-backdrop`, `--floating-opacity`, `--floating-border`, `--floating-offset`. The fill is translucent and blurred by default, opaque without `backdrop-filter` or with reduced transparency. `data-elevation="flat"` on any ancestor removes the depth. Never use viewport-height units (`vh`, `dvh`, `h-screen`) to place floating UI; it takes its position from its container.

## Density and radius

Two separate axes, each an attribute on `<html>` or any element: `data-density="default|compact"` (controls, spacing and type; the `theme-compact` item) and `data-radius="none|sm|md|lg|full"` (controls, choices, surfaces and floating UI; without it the shape derives from `--radius`, which is `lg`). `data-theme="compact"` still works: compact density with the `md` radius, and a `data-density` or `data-radius` on the same element wins. Set them with `createAppearance({ density, radius, storage: { density, radius } })` and `appearance.density.set("compact")`, `appearance.radius.set("sm")`; components follow through tokens, so never branch on either. An `AgentTaskBoard`'s own `density` is `data-board-density`.

## Current page

The current page in a sidebar or a navigation menu uses `nav-current` (`aria-[current=page]:nav-current`): a soft translucent fill (`--nav-current`, the foreground at 6%, 9% in dark mode), a hairline inside its edge (`--nav-current-border`), the foreground text and a medium weight over the items' normal one, so it never rests on colour alone. `SidebarItem` (and so `Shell` and `DocsLayout`) and `NavigationMenuLink variant="top"` use it; reuse it for your own nav rather than a solid `bg-primary` pill.

## Layers and motion

Stack with `z-sticky` < `z-overlay` (dialogs) < `z-popover` < `z-toast`, never a number. Time transitions with `duration-micro` (140ms: hover, popovers, tooltips), `duration-panel` (180ms: accordion, sidebar, toasts) or `duration-dialog` (200ms), with `ease-standard`. Reduced motion is handled globally by the theme.

## Touch targets

On touch screens (`pointer: coarse`) buttons, toggles, tabs, segmented items, checkboxes, radios and switches get an invisible hit area of at least 44px (`--control-height-touch`); sidebar items and label rows around a choice grow to 44px. Desktop looks the same. Give a new small control the `touch-target` class; where controls stack tighter than 44px, grow the row with `pointer-coarse:min-h-(--control-height-touch)` instead.

## Narrow screens

`narrow:` applies at 760px viewport width and below (`flex-row narrow:flex-col`). It is unrelated to compact density (`data-density="compact"`), which changes sizes at any width. Prefer container queries for components placed in panels of different widths.

`SidePanel narrow` decides where an inspector goes at that width: `"stack"` (default) keeps it in the page flow, full width, and wraps its flex parent so it lands below the list, hiding nothing and trapping no focus; `"overlay"` covers its positioned parent, for a panel that should show instead of the list (a tall scroller in a bounded column); `"sheet"` opens it as a modal bottom `Drawer` that takes focus and returns it to `returnFocus()` on close.

## Typography

Pick text size by role, not by number: `text-meta` (eyebrows; with `tracking-meta`, uppercase if you want), `text-caption`, `text-body-sm`, `text-body`, `text-title-sm` (card titles), `text-title` (dialog titles), `text-display-sm` (page titles, stat values), `text-display`, and `text-entry` for text a person types (16px on touch screens, so iOS doesn't zoom into a focused field; never set `maximum-scale` or `user-scalable=no` instead). Each sets size, line height and weight, and tightens under `data-theme="compact"`: 11, 12, 13, 14, 15, 18, 24 and 28px by default. `tracking-tight` (-0.012em) suits titles; `font-mono` is Geist Mono (installed by `font-geist`).

## Icons

Components import their icons from `lucide-react` by name (`ChevronDownIcon`, `XIcon`, `CheckIcon`, `SearchIcon`…), and every item that does lists it in `dependencies` without a version, so shadcn installs it in a project that doesn't have it and leaves an existing `lucide-react` as it is. The icons need 1.68.0 or newer: upgrade an older one. Browse the set on lucide.dev; the site's Icons guide shows the ones the registry uses.

- **Decorative**: lucide sets `aria-hidden` unless the icon gets an `aria-*`, `role` or `title` prop, so an icon beside text needs nothing. An icon-only button is named by the button, and shows that name in a tooltip: `<Button size="icon" aria-label="Delete"><TrashIcon /></Button>`.
- **Meaningful**: when nothing else says it, `<Icon icon={TriangleExclamationPointIcon} label="Blocked" />` renders `role="img"` with that name. `Icon` takes any SVG component.
- **Size**: controls set it (`[&_svg]:size-4` in Button, Toggle, menu items, inputs; `size-3` in Badge), and those classes beat lucide's `size` prop. Elsewhere: `size-3.5` beside `text-body-sm`, `size-4` beside `text-body`, `size-5` beside a title. Unsized, an icon is 24px.
- **Colour**: `currentColor`; use a tone's text colour (`text-success`), and still say the status in words. Alert colours its first-child icon by tone; Toast draws its tone's icon itself.
- **Swap the set**: only the import lines change. Don't hand-draw an icon as inline `<svg>`; drawings that aren't icons (a spinner's arc, status rings) are the exception.
