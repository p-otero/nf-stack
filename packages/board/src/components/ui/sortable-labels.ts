import { reorderMessage, transferMessage, type ReorderMessage, type TransferMessage } from "@ui-sdk/core"

type SortableLabels = {
  /** The list's `aria-roledescription`. */
  list: string
  /** Each item's (or handle's) `aria-roledescription`. */
  item: string
  /** The drag handle's name, from the item's. */
  handle: (item: string) => string
  /** How to move an item with the keyboard; every item and handle is described by it. */
  instructions: string
  /** What screen readers hear as an item is picked up, moved, dropped or put back. */
  message: (message: ReorderMessage) => string
}

const sortableLabels: SortableLabels = {
  list: "sortable list",
  item: "sortable item",
  handle: (item) => `Reorder ${item}`,
  instructions: "Press Space to pick up. Use the arrow keys to move, Space to drop, Escape to cancel.",
  message: reorderMessage,
}

type TransferLabels = {
  /** Each card's (or handle's) `aria-roledescription`. */
  item: string
  handle: (item: string) => string
  instructions: string
  message: (message: TransferMessage) => string
}

const transferLabels: TransferLabels = {
  item: "draggable card",
  handle: (item) => `Move ${item}`,
  instructions:
    "Press Space to pick up. Use the arrow keys to move within a column, Left and Right to change columns, Space to drop, Escape to cancel.",
  message: transferMessage,
}

export { sortableLabels, transferLabels }
export type { SortableLabels, TransferLabels }
