const focusables =
  'a[href],button,input:not([type="hidden"]),select,textarea,iframe,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]'

const ownTabStops = /* @__PURE__ */ new WeakSet<Element>()

function isFocusable(node: Node, root: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement) || node === root || node.tabIndex < 0) return false
  if (!node.matches(focusables) || node.matches(":disabled")) return false
  const inert = node.closest("[inert]")
  return inert === null || inert === root || !root.contains(inert)
}

function focusableIn(node: Node, root: Element) {
  if (isFocusable(node, root)) return node
  if (!(node instanceof Element)) return undefined
  for (const candidate of node.querySelectorAll(focusables)) {
    if (isFocusable(candidate, root)) return candidate
  }
  return undefined
}

/**
 * Makes `el` a tab stop while `wanted()` and nothing focusable sits below it, as axe's scrollable-region-focusable
 * asks. One focusable descendant, the witness, proves it needs no stop, so a mutation costs a look at the nodes it
 * touched: a roving tabindex moving between rows never rescans the content, which only happens when the witness
 * itself goes. An authored `tabindex` wins and turns all of it off.
 */
function bindTabStop(el: HTMLElement, wanted: () => boolean) {
  if (el.hasAttribute("tabindex") && !ownTabStops.has(el)) return { check: () => {}, stop: () => {} }
  let witness = focusableIn(el, el)

  const check = () => {
    const stop = wanted() && !witness ? "0" : null
    if (el.getAttribute("tabindex") === stop) return
    if (stop === null) {
      el.removeAttribute("tabindex")
      ownTabStops.delete(el)
    } else {
      el.setAttribute("tabindex", stop)
      ownTabStops.add(el)
    }
  }
  check()
  if (typeof MutationObserver === "undefined") return { check, stop: () => {} }

  const observer = new MutationObserver((records) => {
    const before = witness
    const touched: Node[] = []
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target === el) continue
        touched.push(record.target)
        if (witness && record.target.contains(witness) && !isFocusable(witness, el)) witness = undefined
      } else {
        touched.push(...record.addedNodes)
        if (witness && record.removedNodes.length && !el.contains(witness)) witness = undefined
      }
    }
    for (const node of witness ? [] : touched) {
      if (node.isConnected && el.contains(node)) witness ??= focusableIn(node, el)
    }
    // Only a witness that left with no newcomer to replace it costs a look at the whole content.
    if (before && !witness) witness = focusableIn(el, el)
    check()
  })
  observer.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["tabindex", "disabled", "href", "contenteditable", "inert"],
  })
  return { check, stop: () => observer.disconnect() }
}

export { bindTabStop }
