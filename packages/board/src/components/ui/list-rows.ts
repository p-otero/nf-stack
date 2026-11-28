import { Children, isValidElement, type KeyboardEvent, type ReactElement, type ReactNode } from "react"

import { isRecord } from "@/lib/narrow"

function defaultText(item: unknown) {
  if (typeof item === "string") return item
  if (isRecord(item)) {
    for (const key of ["title", "label", "name", "id"]) {
      const text = item[key]
      if (typeof text === "string") return text
    }
  }
  return ""
}

type ChildRow = ReactElement<{ id?: unknown; title?: unknown }>

function childRowsOf(children: ReactNode): ChildRow[] | undefined {
  const all = Children.toArray(children)
  if (all.length === 0) return undefined
  const rows: ChildRow[] = []
  for (const child of all) {
    if (!isValidElement<{ id?: unknown }>(child) || typeof child.props.id !== "string") return undefined
    rows.push(child)
  }
  return rows
}

const childId = (row: unknown) => (isValidElement<ChildRow["props"]>(row) ? String(row.props.id) : "")
const childText = (row: unknown) => {
  if (!isValidElement<ChildRow["props"]>(row)) return ""
  const { id, title } = row.props
  return typeof title === "string" ? title : String(id)
}
const renderChild = (row: unknown) => (isValidElement(row) ? row : null)

function defaultId(item: unknown) {
  if (typeof item === "object" && item !== null && "id" in item) return String(item.id)
  return String(item)
}

const arrowForLetterKey: Record<string, string> = { j: "ArrowDown", k: "ArrowUp" }

function listboxKeyDown(event: KeyboardEvent<HTMLElement>, setValue: (id: string) => void) {
  if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return
  const option = event.target.closest<HTMLElement>('[role="option"]')
  if (!option) return
  const arrow = arrowForLetterKey[event.key]
  if (arrow) {
    event.preventDefault()
    event.stopPropagation()
    option.dispatchEvent(new globalThis.KeyboardEvent("keydown", { key: arrow, bubbles: true, cancelable: true }))
    return
  }
  if (event.key !== "PageDown" && event.key !== "PageUp") return
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
  const viewport = event.currentTarget.closest<HTMLElement>("[data-slot=list]")?.parentElement?.clientHeight ?? 0
  const page = Math.max(1, Math.floor(viewport / Math.max(1, option.offsetHeight)) - 1)
  const from = options.indexOf(option)
  const target = options[Math.min(options.length - 1, Math.max(0, from + (event.key === "PageDown" ? page : -page)))]
  const id = target?.dataset.itemId
  if (!target || id === undefined) return
  event.preventDefault()
  target.scrollIntoView({ block: "nearest" })
  target.focus()
  setValue(id)
}

export { childId, childRowsOf, childText, defaultId, defaultText, listboxKeyDown, renderChild }
