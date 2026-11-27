# Links, keyboard and long lists

Part of the `eskais-ui` skill.

## Fast links

`Link`, `ButtonLink`, `NavigationMenuLink` and a `CommandItem` with `href` follow a same-origin link on a primary mouse **press** (`pointerdown`), not on release, with `@fast-link/core`. Breadcrumb, Sidebar items, DocsPager, SiteHeader, SiteFooter, MobileNav and MarkdownView links get it through them (DocsToc too, but its in-page anchors stay native). `FastLinkRegion` (or `useFastLink()`, a ref) does the same for plain anchors in prose or rendered HTML.

- Keyboard, touch, pen, modified, middle and right presses, `target="_blank"`, `download`, external and cross-origin links and in-page anchors (`#section`) stay native, and so does a press that starts on a nested button or input.
- **Hash routers.** An `href` that starts with `#/` is a hash route and follows on press too: through `onFollow`, or by setting `location.hash`. Any other `#…` is an in-page anchor. Another router's prefix goes in `data-fast-link-hash-prefix` on any ancestor (`<body data-fast-link-hash-prefix="#!/">`) or `FastLinkRegion hashPrefix`; an empty value (`hashPrefix={false}`) makes every `#…` href an anchor.
- Navigation goes through `onFollow` or `onNavigate` when one is set (a router; `onNavigate` adds no agent action), and through `location.assign` otherwise. `onIntent(href)` runs when someone is about to follow (65 ms hover, focus, mouse press), to preload the route. A `render`ed router link or a link with its own `onClick` acts on the click, so without `onFollow` it stays native rather than navigate twice; pass `onFollow` to route on press.
- Opt out per link with `fast={false}`, per region with `data-no-fast-link` on any ancestor, or for the whole app with `<body data-no-fast-link>`.
- **Navigation only.** A press can't be cancelled by moving the pointer away (WCAG 2.5.2 Pointer Cancellation); that's acceptable for navigation, which Back undoes, and never for an action. Buttons, menu items, `DialogTrigger`s and links that confirm, submit or change something stay on click: give such a link `fast={false}`. A site that must conform to WCAG 2.5.2 strictly sets `data-no-fast-link` on `<body>`.

## Keyboard and long lists

- **Shortcuts.** `useShortcut` registers in UI SDK's shared `shortcuts` (reuse UI SDK's own `shortcut` props on triggers; `useShortcut` is for the rest). Plain keys never fire while typing in an input, textarea or contenteditable, nor during IME composition; a modal pauses page shortcuts. A space makes a sequence (`g i`). A symbol or digit (`?`, `/`, `1`) matches the character typed, whatever Shift, AltGr or Option the layout needed; letters keep exact modifiers. Give each a `description` so `ShortcutsDialog` lists it; `extra` adds rows for keys that aren't registered, like a list's j/k. `formatShortcutSteps(keys)` formats them.
- **Scopes.** `<ShortcutScope name label>` is active while focus is inside (`active="focus"`), or while mounted (`active`), like an open panel. Shortcuts inside take its scope; `scope: null` makes one global.
- **People only.** Shortcuts add nothing for agents: they press the same buttons and menu items by name. Hints are `aria-hidden` `Kbd`; controls get `aria-keyshortcuts` (single steps only). A `Button` with an `aria-label` and a visible hint fails axe's label-content-name-mismatch: put the hint beside it, as `SidePanel` does, or `shortcutHint={false}`.
- **Collections.** `List` (link or button rows), the AgentTaskBoard table and backlog, and `DataTable` give rows one tab stop through `row-navigation` (UI SDK roving focus, no role added): ↓/j and ↑/k move, Home/End and PageUp/PageDown jump, Enter opens (the row's link or button, or `DataTable onRowOpen`), Space or x toggle selection where there is one (`List checkedIds`, `DataTable selectable`). The row moved to scrolls in with the least scrolling. A selectable `List` is a UI SDK Listbox, which moves itself; j/k and the page keys map onto its arrows.
- **Table cells.** `DataTable navigation="cells"` moves by cell on UI SDK's grid focus (the table takes `role="grid"`): ←/→ along a row (text direction), ↑/↓ keeping the column, Home/End to a row's ends and with Ctrl/⌘ to the table's corners, PageUp/PageDown ten rows, Space toggles the row's selection, Enter calls `onRowOpen`. One tab stop for the cells; a move renders two cells; unrendered rows scroll in first. Use it for data people scan across; keep the default rows for lists of things people open.
- **Board.** A `Board`'s cards are one tab stop, Linear-style: ↓/j and ↑/k within a column, ←/→ to the next column at the same row (or its last card), Home/End to the column's ends and with Ctrl/⌘ to the board's, Enter opens. `TaskCard` takes part on its own; a card of yours wraps its primary control in `<BoardCard id render={<Button …/>} />` (from `@/components/ui/board-navigation`). Tab from the focused card reaches that card's own controls, then leaves the board; other cards' controls are out of the tab order until their card is focused. A move renders two cards. Agents still select and act through the board's actions.
- **Virtualization.** `virtual-rows` (UI SDK's virtualizer) renders rows in document flow between `aria-hidden` gaps, so `ul > li` and `tbody > tr` stay valid; list rows carry `aria-setsize`/`aria-posinset`, table rows `aria-rowindex` under `aria-rowcount`. It scrolls with the nearest scrolling ancestor, else the window: give the list a bounded height (`min-h-0 flex-1 overflow-y-auto` parent, or `className="max-h-96"` on a DataTable). The focused row stays rendered, agents' `select`/`setSelection` take ids that aren't rendered, and the text of unrendered rows sits in UI SDK's findable layers (`hidden="until-found"` stand-ins) so find in page reaches them. A row list whose children are all elements with a string `id` (`<ListItem id title>`, or a row of your own that takes `id`) virtualizes the same way, its `title` standing in for `itemText`. Cards and grouped lists don't virtualize.
- **Cost.** Measured on a 2,000-row list in the Eskais repository, the first paint takes about 100 ms instead of 800 ms, and j/k reach the next paint in under 16 ms at the 95th percentile on a desktop CPU. Keep `renderItem` cheap: rows are memoized, so scrolling renders only the rows that enter.

## Reorder and move

- **A list or grid.** `Sortable aria-label value onValueChange` renders its items from a children function, `({ order }) => order.map((id) => <SortableItem key={id} value={id}>…</SortableItem>)`, so they follow the draft while one moves; `onValueChange(order, details)` runs once per drop (`details.reason`: `drag`, `move-key` or `imperative`). A controlled value the parent doesn't change keeps the old order. `orientation` is `vertical`, `horizontal` or `grid`.
- **Keyboard.** Space or Enter lifts the focused item, the arrows, Home and End move it, Space or Enter drops it, Escape puts it back and Tab cancels. Without `handle` the sortable is a listbox, one tab stop over its options; arrows only move focus until something is lifted.
- **Items with controls.** Add `handle` and a `SortableHandle label` inside each item: the handles are the tab stop and the drag target, so the item's own buttons and links keep working. `List sortable onReorder(ids)` does this for `ListItem` rows (needs `items` or `ListItem id` children and no `value`); the row's link or button keeps its own tab stop, checked rows (`checkedIds`) move together, and a sortable list renders every row instead of virtualizing.
- **Several at once.** `selected`/`onSelectedChange` (Ctrl or Cmd with Space or a click, Shift+click to extend) are items that move together; `disabledKeys` can't be picked up but make room.
- **Long lists.** `preview` drags a copy above the page, so a scrolling list neither clips the item nor grows, and holding it near the edge scrolls (`autoScroll={{ edge, speed }}`, or `false`).
- **Styling.** Nothing re-renders while the pointer moves: core writes `--drag-x`/`--drag-y` on the grabbed item, and items carry `data-grabbed` (a pointer drag), `data-moving` (lifted, by keyboard too), `data-checked` and `data-disabled`; the root `data-moving` and `data-dragging`. The neighbours slide with the panel motion token and stay still under reduced motion (`useFlip(ref, selector, trigger)` does it for your own markup).
- **Words.** Every item or handle is described by keyboard instructions, and each pickup, move and drop is announced. `labels` (`list`, `item`, `handle(name)`, `instructions`, `message(step)`) overrides the English defaults; `itemLabel(id)` names items for announcements and agents.
- **Between columns.** `Board value={lists} onValueChange={(lists, { key, from, to, index }) => …}` with `BoardColumn value="todo"` whose children are a function of the column's ids rendering `BoardItem value`s. Left and Right change columns, `order` sets their order, `accepts(id, list)` skips a column that won't take a card (a WIP limit), `handle` + `BoardItemHandle` keeps a card's buttons clickable. The handles are one tab stop of their own; when the cards already are the board's stops (a primary control in `BoardCard id render`, as `TaskCard` does), pass `handleFocus="card"` and each handle becomes one of its card's controls. A pointer drags a copy and scrolls the board near its edges.
- **Agents.** A sortable gets `move(id, index)` and `reorder(ids)`, a moving board `move(id, list, index)`, each on its label and with errors that list what's allowed. For a move that needs a person, pass `agentMoves={false}` and offer your own action on an element with `data-agent-confirm`, as `AgentTaskBoard onMoveTask` does.

## Global search (⌘K)

A search that loads results from the server, opened from the `Topbar` with `mod+k`. Only the triggers go in the Topbar's slots; the `CommandDialog` goes beside the `Topbar`, bound by the same controller:

```tsx
import { useAsyncOptions } from "@ui-sdk/react/async-options"

function AppTopbar() {
  const [search] = useState(() => createCommandDialogController())
  return (
    <>
      <Topbar
        center={
          <CommandDialogTrigger controller={search} shortcut="mod+k">
            <SearchIcon />
            Search the workspace
            <CommandDialogShortcut />
          </CommandDialogTrigger>
        }
        centerCompact={
          <CommandDialogOpenButton controller={search} variant="ghost" size="icon" aria-label="Search the workspace">
            <SearchIcon />
          </CommandDialogOpenButton>
        }
      />
      <GlobalSearch controller={search} />
    </>
  )
}

function GlobalSearch({ controller }: { controller: CommandDialogController }) {
  const results = useAsyncOptions(searchWorkspace, { debounce: 200, immediate: true }) // (query, { signal }) => Promise<{ value, label }[]>
  return (
    <CommandDialog controller={controller}>
      <CommandDialogContent title="Search the workspace">
        <Command
          filter={false}
          status={results.status}
          onQueryChange={(query) => results.setQuery(query)}
          onLoadMore={results.loadMore}
          onAction={(value) => {
            navigate(value)
            controller.close()
          }}
        >
          <CommandInput aria-label="Search the workspace" />
          <CommandStatus>{(state) => (state.loading ? "Searching…" : `${state.count} results`)}</CommandStatus>
          <CommandEmpty>
            {(state) => (state.empty && !state.loading ? `Nothing matches “${state.query}”` : null)}
          </CommandEmpty>
          <CommandList>
            {results.items.map((item) => (
              <CommandItem key={item.value} value={item.value} label={item.label}>
                {item.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialogContent>
    </CommandDialog>
  )
}
```

- **Never put the dialog in a Topbar slot.** A dialog renders where it is placed (in the browser's top layer), and `center` is hidden on narrow screens once `centerCompact` is set, so a dialog inside it opens with no box. The same goes for any slot you hide with `narrow:hidden`. The triggers can live anywhere: the main trigger's `mod+k` still listens while its slot is hidden.
- Every `options`, `items`, `stages`, `steps` and `columns` prop in the registry takes a readonly array, so `as const` data and `useAsyncOptions` results pass as they are. UI SDK 0.1.0-beta.12's `useAsyncOptions` itself still types its loader's result as a mutable array: return `[...rows]` from a loader whose source is readonly.
- `filter={false}` keeps the server's order; `useAsyncOptions` debounces, aborts stale requests through `signal` and keeps the last results while loading. Pass `status` so the list gets `aria-busy` and `CommandStatus` announces counts.
- Each open starts with an empty search (or the `Command`'s `defaultQuery`) on the first page, the first command highlighted and focus in the search, also when the closed content stays mounted (`keepMounted`). A `query` or `pages` you control is yours to reset.
- `<CommandFooter>` after the `CommandList` is a line for hints, like the keys that move and close.
- One Escape closes the dialog whatever the search holds. `<CommandDialog escapeKey="clear">` keeps UI SDK's order instead: clear the search, go back a page, then close. A `dismissible={false}` dialog leaves Escape to the search.
- The dialog returns focus to the trigger that opened it, and `onOpenChange` on `CommandDialog` reports both ways. `shortcut` is opt-in and only listens while the trigger is mounted.
- **Go to a page from the palette.** `<CommandItem value="ideas" href="#/ideas">` is a link command: Enter, a click, its `shortcut` and a mouse press (fast links, `#/…` hash routes and same-origin paths) follow it, and it never runs `Command onAction`, which stays for actions. Pass `onFollow={() => { controller.close(); router.push("/ideas") }}` to route on the client and close the palette first; without it a hash route sets `location.hash` and a path loads with `location.assign`. Modified clicks stay native (a new tab); `fast={false}` waits for the click.
- Outside a Topbar, prefer one trigger whose text goes `narrow:sr-only`. For a second way in, like a `Topbar`'s `centerCompact` icon, use `CommandDialogOpenButton` as above: it opens through the controller, gets focus back on close, and is hidden from agents, who open the dialog by its main trigger's name. Not a second `CommandDialogTrigger`: in UI SDK 0.1.0-beta.12 that still drops the dialog's agent label.

## Application shell

`Shell` builds the frame from one list of routes: the sidebar, the bottom bar on narrow screens, its More sheet and the palette's Go to group.

- **Bottom bar.** Routes with `mobile` take its four slots and More opens the rest. `mobile: { order }` orders the bar apart from the sidebar: by `order`, then by the routes' place in the list, `true` counting as order 0.
- **Placements.** `placements` on a route, a subset of `"sidebar"`, `"mobile"`, `"more"` and `"palette"`, limits where it shows; without it a route shows everywhere it would. `["sidebar"]` makes a sidebar-only route; leave out `"palette"` or `"more"` to keep it out of just that. `placements` decides over `mobile`: without `"mobile"` the route never takes a bar slot, even with `mobile` set, and listing `"mobile"` gives it one as `mobile: true` does. Keep a route reachable somewhere on narrow screens: the sidebar's drawer, the bar or More.
- **Full-height pages.** `main="fill"` on the Shell, or `main: "fill"` on a route while it is current, gives `<main>` the height left under the topbar and above the bottom bar. A `DocumentWorkspace` (its default height is 100%) or any `h-full`/`flex-1` child fills it and scrolls inside; don't size a wrapper yourself, and never with viewport units. The default, `flow`, lets the page scroll.
- **Palette.** Go to's commands are link commands to the routes' hrefs: Ctrl/Cmd+click opens a new tab, and following one closes the palette and goes through `onNavigate`. Each open starts empty and one Escape closes it, focus back on the trigger. `searchQuery`/`onSearchQueryChange` control the search, `defaultSearchQuery` starts each open, `commandGroups` with `onCommand` add your commands, and `searchFooter` puts hints at the bottom (`<Kbd>↑</Kbd><Kbd>↓</Kbd>` with your own words; there is no default copy).
- **Sidebar.** `sidebarHeader` (a brand, a workspace switcher, a caption) and `sidebarFooter` (an account, a plan) go above and below the routes; the header hides while the sidebar is a rail. `sidebarShortcut="mod+b"` (off by default) presses the topbar's sidebar trigger: it collapses or expands the sidebar on wide screens and opens the drawer on narrow ones. Inside the Shell, `useShellSidebar()` returns `{ collapsed, setCollapsed, controller }`. To hold that state above the Shell, call `useSidebarState({ storageKey })` yourself and pass it as `sidebar`.
