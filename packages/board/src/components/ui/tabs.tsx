"use client"

import {
  Tabs as TabsPrimitive,
  TabsIndicator,
  TabsList as TabsListPrimitive,
  TabsPanel as TabsPanelPrimitive,
  TabsTab as TabsTabPrimitive,
  TabsTabIcon,
  createTabsController,
  type TabsController,
} from "@ui-sdk/react/tabs"
import { createContext, use, useState, type ComponentProps, type PointerEvent } from "react"

import { TabsScroll, type TabsScrollLabels } from "@/components/ui/tabs-scroll"
import { cn, cnState } from "@/lib/utils"
import { assumeType } from "@/lib/narrow"

// Set only while activateOnPress is on: the controller a tab selects through on pointerdown.
const TabsPressContext = createContext<TabsController | null>(null)

type TabsProps<T extends string = string> = ComponentProps<typeof TabsPrimitive<T>> & {
  /**
   * Selects a tab as soon as a mouse or pen presses it, before release, like native tab bars. Touch still selects
   * on release, so scrolling a tab bar doesn't select. Keyboard and agents are unchanged. Off by default.
   */
  activateOnPress?: boolean
}

function Tabs<T extends string = string>({ className, activateOnPress = false, controller, ...props }: TabsProps<T>) {
  const [ownController] = useState(() => createTabsController<T>())
  const active = controller ?? ownController
  // UI SDK types a tab's `value` as a string, so the tabs below select through a controller of strings; each of them
  // passes its own value, one of this Tabs' `T`.
  const pressController = activateOnPress ? assumeType<TabsController>(active) : null
  return (
    <TabsPressContext value={pressController}>
      <TabsPrimitive<T>
        controller={active}
        className={cnState("flex flex-col gap-items data-[orientation=vertical]:flex-row", className)}
        {...props}
      />
    </TabsPressContext>
  )
}

const tabsListClassName =
  "relative inline-flex w-fit items-center rounded-control bg-muted p-control-inset text-muted-foreground data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch"

// A scrolling list clips on both axes, so a tab's focus ring drops its offset to fit inside the list's rim.
// The fades are masks over the list itself, so they work on any surface; each side's width is 0 until it overflows.
// The scroll padding is the fade's width, so a tab TabsScroll reveals lands clear of it.
const scrollClassName = [
  // oxlint-disable-next-line eskais/scroll-area -- a scrolling tab list hides its scrollbar on purpose: edge fades and scroll buttons stand for it
  "max-w-full overflow-x-auto overscroll-x-contain [--tabs-fade:2.5rem] scroll-px-(--tabs-fade) [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_[data-slot=tabs-tab]]:focus-visible:ring-offset-0",
  "[--fade-left:0px] [--fade-right:0px] group-data-overflow-left/tabs-scroll:[--fade-left:var(--tabs-fade)] group-data-overflow-right/tabs-scroll:[--fade-right:var(--tabs-fade)]",
  "[mask-image:linear-gradient(to_right,transparent,black_var(--fade-left),black_calc(100%-var(--fade-right)),transparent)]",
].join(" ")

type TabsListProps = ComponentProps<typeof TabsListPrimitive> & {
  /**
   * `"auto"` (default) lets a horizontal list scroll when its tabs don't fit, with edge fades and, on fine pointers,
   * scroll buttons; the selected or focused tab scrolls into view clear of the fades. `false` keeps it a plain list
   * that never scrolls.
   */
  scrollable?: "auto" | false
  scrollLabels?: Partial<TabsScrollLabels>
}

function TabsList({ className, scrollable = "auto", scrollLabels, ...props }: TabsListProps) {
  if (scrollable === false) return <TabsListPrimitive className={cnState(tabsListClassName, className)} {...props} />
  return (
    <TabsScroll labels={scrollLabels}>
      {(ref) => (
        <TabsListPrimitive
          ref={ref}
          className={cnState(cn(tabsListClassName, scrollClassName), className)}
          {...props}
        />
      )}
    </TabsScroll>
  )
}

// A solid primary fill on muted, so the selected tab reads at 3:1 rather than as a faint tint.
function TabsTab({ className, onPointerDown, ...props }: ComponentProps<typeof TabsTabPrimitive>) {
  const pressController = use(TabsPressContext)
  // Selecting on press is allowed by WCAG 2.5.2 (Pointer Cancellation) because it's reversible: pressing another
  // tab undoes it. It goes through the controller, so onValueChange, cancel() and controlled values still apply.
  const selectOnPress = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event)
    if (!pressController || event.defaultPrevented || event.button !== 0 || event.pointerType === "touch") return
    pressController.select(props.value, { reason: "item-press", event: event.nativeEvent })
  }
  return (
    <TabsTabPrimitive
      onPointerDown={selectOnPress}
      className={cnState(
        "touch-target inline-flex h-control-sm shrink-0 cursor-pointer items-center justify-center gap-inline rounded-control px-control-x text-sm font-medium whitespace-nowrap transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:text-muted-foreground data-selected:bg-primary data-selected:text-primary-foreground data-selected:hover:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: ComponentProps<typeof TabsPanelPrimitive>) {
  return (
    <TabsPanelPrimitive
      className={cnState(
        "flex-1 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    />
  )
}

export { createTabsController, Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab, TabsTabIcon }
export type { TabsListProps, TabsProps }
