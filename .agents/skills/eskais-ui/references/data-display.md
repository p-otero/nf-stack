# Data display

Part of the `eskais-ui` skill.

## Description lists

- `DescriptionList` is a real `dl` of `DescriptionItem`s, each a `div` holding a `DescriptionTerm` (`dt`) and its `DescriptionDetails` (`dd`). Screen readers announce terms with their definitions.
- `layout="stacked"` (default) puts each term above its details. `"inline"` puts them side by side, the term at `--description-term-width` (33%), divided by rules, and stacks them again once the list's own width drops under 24rem: a container query, so it works in a side panel. `"grid"` lays items out in as many columns as fit at `--description-column-min` (12rem), never more than `columns` (3).
- An empty `DescriptionDetails` (nothing, `null` or `""`) shows an `aria-hidden` dash and reads `labels.empty` ("Not set"). `mono` sets ids and hashes in the monospace face.
- `copyable` adds a copy button after the value (`copyValue` when the details aren't plain text, `onCopy`): the value is a group named by its term with a `copy` action for agents, the button is hidden from them, and "Copied" (`labels.copied`) is announced. Pass `labels={{ empty, copy, copied }}` in the page's language.

## Stats and deltas

- `StatDelta value comparison` sits under a `StatValue`: an arrow (mirrored in right to left) and the size of the change in a soft tone chip, then your `comparison` ("vs. last week").
- `value` is a ratio by default, so 0.12 reads "12%"; `format` takes `Intl.NumberFormat` options or a function, `locale` the locale. Without `locale`, both it and `StatValue` follow the page's `<html lang>` (`useLocale` from `@/lib/locale`, also in RelativeTime, QuantityValue and charts), so they agree; set `lang` on `<html>`.
- Its sign gives the direction (zero is flat), or pass `direction`. The direction gives the tone: up is success, down destructive, flat neutral; `invert` swaps them for a metric where down is good, like cost or errors; `tone` overrides.
- `StatMedia tone label` is an icon (or a small chart) in a soft tone chip at the end of a `Stat`, top-aligned beside the label, value and hint, with no wrapper of your own: write it among the parts. It is decorative unless `label` names it (`role="img"`). `DashboardStat icon tone iconLabel` renders one.
- Screen readers hear `labels.up/down/flat(formatted)` ("up 12%") and then the comparison, never the arrow or the colour. Override the labels in the page's language.

## Meters and progress

- `Meter variant="ring"` with a `MeterRing size` child (`sm`, `md`, `lg`) draws the reading as a ring with the value in the centre (`children` replaces it) and the label below. The root keeps `role="meter"` and its value for screen readers; the ring is `aria-hidden`, `tone` colours the arc, it fills the other way round in right to left and doesn't animate under reduced motion.
- `format` on the root (`Intl.NumberFormat` options, or a function of the value) changes the visible value and what screen readers hear together; `locale` pins the locale. `formatValue={(value, { min, max, percent, text }) => …}` on `MeterValue` or `ProgressValue` replaces only the visible value, with any node; `getValueLabel` on the root changes what screen readers hear. A progress bar's `value` and `percent` are null while it is indeterminate.
- The default text follows the locale as CLDR writes it: es-ES, fr-FR and de-DE put a no-break space (U+00A0) before the percent sign ("21 %"), en-US none. That is correct; change it with `format` only when a design asks for it.

## Tables

- `TableCell` keeps its text on one line up to `max-w-80`, with an ellipsis; when the pointer arrives at a cell that is cut off, its `title` becomes the whole text (a `title` you pass stays). Screen readers and agents always get the whole text.
- `TableCell wrap` wraps long text onto more lines instead, for descriptions and summaries. In a `DataTable`, a column takes `wrap`, `cellClassName` (classes on every body cell, such as a width) and `headerClassName`.

## Charts

- `ChartDataTable data labelKey keys` is generic over the row type, so rows typed by an `interface` pass as they are, and `labelKey` and `keys` must name their fields.
