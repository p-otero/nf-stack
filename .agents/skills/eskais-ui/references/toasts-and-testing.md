# Toasts and testing

Part of the `eskais-ui` skill.

## Toasts

- Place `<ToastStack />` once (or pass a `toaster` from `createToaster()`), and call `toast()`, `toast.success()`… from your handlers.
- Its close buttons are named "Dismiss". Pass `labels={{ close: "Cerrar" }}` in the page's language (`closeLabel` is deprecated).
- Each type leads with a decorative icon in its tone colour: `info` a circled i, `success` a check, `warning` a triangle, `error` a circled exclamation mark, `loading` a spinner, and `default` none. It is `aria-hidden`, so the title has to say what happened. In your own `Toast` composition, render `<ToastIcon type={item.type} />` before the title.
- The region takes no pointer events: only the toasts themselves cover the page, so buttons beside or behind the stack stay clickable.
- Timers pause while focus is in a toast, and while the pointer rests on one for `hoverDelay` ms (300 by default). A pointer that only passes over doesn't hold them.

## Testing toasts and alerts

UI SDK announces toasts through two visually hidden live regions it appends to `<body>`: `role="status"` (polite) and `role="alert"` (assertive), both marked `data-ui-sdk-announcer`. They stay for the page's life and keep the last text they announced, so after a toast closes `getByRole("alert")` and `getByText("Saved")` can still find its copy there.

- Find a toast by its part, not by text on the whole page: `[data-slot="toast"]`, or `within(screen.getByRole("region", { name: "Notifications" }))` while a toast is showing (the region is only a landmark then).
- `npx shadcn add @eskais/test-utils` adds the helpers to `lib/test-utils.ts`. It needs `@testing-library/dom` (a dev dependency).
  - `getToast(text)` / `queryToast(text)`: the showing toast with an element whose text matches; both throw when several match, `getToast` also when none does. `queryToasts()` lists them, newest first, without toasts animating out.
  - `queryAlerts()` / `queryStatuses()`: `role="alert"` / `role="status"` elements without the live regions.
  - `isAnnouncer(node)`: whether a node is in a live region. `ignoreAnnouncer` is an `ignore` for text queries: `screen.getByText("Saved", { ignore: ignoreAnnouncer })`.
  - `readAnnouncements()`: `{ polite, assertive }`, what the live regions hold. A toast is announced about 200ms after it shows.
  - `resetAnnouncer()`: removes the live regions; UI SDK makes new ones on the next announcement. UI SDK exports no reset of its own, so call it in `afterEach`, after Testing Library's `cleanup`.
