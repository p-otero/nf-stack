# Agents: refusals and end-to-end tests

## When an action can't run

UI SDK's bridge reports `ok: true` for any action that returns, so Eskais components throw when an agent's action doesn't run. `agent.act()` then resolves with `ok: false` and `error.message` saying why, and the steps after it don't run:

| Why                                                                          | `error.message`                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| your callback called `details.cancel()` (`onStart`, `onCancel`, `onFollow`…) | `start was refused by the app. [refused:start]`                                                              |
| the component's state doesn't offer it                                       | `start isn't available while listening. [unavailable:start]`, `undo has nothing to undo. [unavailable:undo]` |
| the component wasn't given the callback                                      | `reset isn't offered: there is no onResetRequest. [unavailable:reset]`                                       |

### Telling a refusal from another failure

UI SDK's `act` result keeps only the message of a failed step: `error` is `{ step, message }`, with no code, cause or data, from `agent.act()` and from the WebMCP `act` tool alike. So a refusal's message ends with a tag, `[refused:<action>]` or `[unavailable:<action>]`, and `parseActionRefusal` from `@/lib/action-refusal` reads it back:

```ts
import { parseActionRefusal } from "@/lib/action-refusal"

const result = await agent.act({ steps: [{ ref: "Voice input", action: "start" }] })
expect(parseActionRefusal(result.error)).toMatchObject({ action: "start", kind: "refused" })
// { action: "start", kind: "refused", text: "start was refused by the app." }
```

It takes the step's `error`, its `message` or the error itself, and returns `null` for any other failure (no such component, a bad argument, a plain `Error`, a redacted step). The tag stays at the end even when the bridge prefixes the message (`start on Voice input (c2) failed: …`). Assert on the parsed `action` and `kind` rather than the words, which may change. `ActionRefusedError` also has `text`, the sentence without the tag.

- Refuse an agent while people keep the control: `if (details.source === "agent") details.cancel()` in the change or event callback. The agent's step fails with "refused by the app" and nothing changes; a person's press still works.
- Actions that name an end state (`open`, `close`, `expand`, `collapse`, `setCollapsed`, `goTo` the current index) succeed when it's already there; actions that move (`start`, `confirm`, `next`, `previous`, `nextHunk`, `undo`, `loadOlder`) fail when there's nowhere to go.
- The same applies to your code: a controller method (`createSidebarController().collapse()`, `createDiffViewController().nextHunk()`…) or a component's `api` called without a press throws an `ActionRefusedError` from `@/lib/action-refusal`, with `action` and `kind` (`"refused"` or `"unavailable"`). Pass the press's `{ reason, event }` from your own handlers, as the components do, and a refused press just returns `false`.
- UI SDK's own components (Select, Input, Tabs…) keep UI SDK's rule: a cancelled `setValue` reports `ok: true` with no change for that step, so read the step's `changes` and the returned `values` there.
- A component you build with `definePrimitive`: return `settled(change(...), "action", { reason, event })` or `settled(!dispatch(...), …)`, and `unavailable("action", "isn't available while busy", { reason, event })` for a state that forbids it. Throw synchronously, before any `await`: a promise that rejects after the step ends doesn't fail it.

## Testing agent actions end to end

UI SDK's supported way to drive a page's agent from outside it is WebMCP. `registerTools(agent, { allow })` from `@ui-sdk/react/agent` publishes `snapshot`, `query` and `act` with `document.modelContext.registerTool`; the browser's agent, or your test, calls them. Nothing test-only goes in the app:

```ts
// agent.ts
import { createAgent, registerTools } from "@ui-sdk/react/agent"

export const agent = createAgent({ allow: (step) => !step.confirm || askPerson(step.confirm) })

// In production for a real browser agent (WebMCP), or only in dev and test builds:
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  registerTools(agent, { allow: (step) => !step.confirm })
}
```

`allow: (step) => !step.confirm` leaves every `data-agent-confirm` step to a person. `document.modelContext` needs Chromium 158 or later: Chrome 158 and later have it with `--enable-features=WebMCP`. In Electron, the first major on Chromium 158 or later is Electron 46 (Chromium 160), stable on 5 January 2027 by Electron's schedule (tentative, checked on 20 November 2026); Electron 45 (Chromium 156) and older don't have it, so use the stand-in below there. Playwright calls the tools over the DevTools protocol, as a browser agent does:

```ts
import { chromium, expect, test } from "@playwright/test"
import { parseActionRefusal } from "@/lib/action-refusal"

test("an agent can't start dictation the app keeps for people", async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-features=WebMCP"] })
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  const tools = new Map<string, { frameId: string }>()
  const responses = new Map<string, (output: unknown) => void>()
  cdp.on("WebMCP.toolsAdded", ({ tools: added }) => added.forEach((tool) => tools.set(tool.name, tool)))
  cdp.on("WebMCP.toolResponded", ({ invocationId, output }) => responses.get(invocationId)?.(output))
  await cdp.send("WebMCP.enable")
  await page.goto("http://localhost:5173/dictation")
  await expect.poll(() => tools.has("act")).toBe(true)

  const call = async (toolName: string, input: object) => {
    const { invocationId } = await cdp.send("WebMCP.invokeTool", {
      frameId: tools.get(toolName)!.frameId,
      toolName,
      input,
    })
    const output = await new Promise((resolve) => responses.set(invocationId, resolve))
    return typeof output === "string" ? JSON.parse(output) : output
  }

  const result = await call("act", { steps: [{ ref: "Voice input", action: "start" }] })
  expect(result.ok).toBe(false)
  expect(parseActionRefusal(result.error)).toMatchObject({ action: "start", kind: "refused" })
  await expect(page.getByRole("group", { name: "Voice input" })).toHaveAttribute("data-state", "idle")
  await browser.close()
})
```

Playwright's protocol types don't list the `WebMCP` domain yet; in TypeScript, cast the session where it complains. From inside the page the same tools run with `document.modelContext.getTools()` and `executeTool(tool, input)`, which returns the result as JSON text. On a browser without WebMCP (Firefox, WebKit, Chrome before 158, Electron 45 or older), give `registerTools` something to register into before the page loads, in the test only:

```ts
await page.addInitScript(() => {
  if (document.modelContext) return
  const tools = new Map()
  Object.defineProperty(document, "modelContext", {
    value: {
      registerTool: async (tool) => void tools.set(tool.name, tool),
      getTools: async () => [...tools.values()],
      executeTool: async (tool, input) => JSON.stringify(await tools.get(tool.name).execute(input, {})),
    },
  })
})
const result = await page.evaluate(async () => {
  const act = (await document.modelContext.getTools()).find((tool) => tool.name === "act")
  return JSON.parse(await document.modelContext.executeTool(act, { steps: [{ ref: "Voice input", action: "start" }] }))
})
```

Check what the step did in the page itself (`data-state`, `aria-pressed`, the text shown), not only `result.ok`.
