import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom, unregisterDom } from "./dom";

// A saturated CPU stretches each await in a render-and-assert test to hundreds of milliseconds;
// the dialog needs a handful of them, which the default 5 s does not cover.
setDefaultTimeout(15_000);

registerDom("http://127.0.0.1:4646/?project=SS");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { warmUp } = await import("./render");
const { NfTaskDetailDialog } = await import("../src/components/nf/task-detail-dialog");

afterAll(unregisterDom);

const task = {
  id: "SS-001",
  title: "Back off webhook retries exponentially",
  status: "working" as const,
  dependsOn: [],
  acceptance: [{ text: "A delivery gives up after 8 attempts", result: "unverified" as const }],
  attempts: [],
  updatedAt: "2026-11-19T21:39:00Z",
};

function Harness({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  return createElement(NfTaskDetailDialog, {
    task: open ? task : undefined,
    live: false,
    now: "2026-11-19T22:00:00Z",
    onClose: () => {
      setOpen(false);
      onClosed();
    },
  });
}

const dialog = (onClosed: () => void) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    createElement(Harness, { onClosed }),
  );

const mount = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let closed = 0;
  await act(async () => root.render(dialog(() => (closed += 1))));
  return {
    closed: () => closed,
    dialog: () => document.querySelector<HTMLElement>('[data-task-detail="dialog"]'),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

await warmUp(dialog(() => undefined));

describe("task detail dialog", () => {
  test("opens on the task with its git line", async () => {
    const view = await mount();
    expect(view.dialog()?.textContent).toContain("Back off webhook retries exponentially");
    expect(view.dialog()?.textContent).toContain("No branch data: this board is a snapshot");
    await view.unmount();
  });

  test("closes on Escape", async () => {
    const view = await mount();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(view.closed()).toBe(1);
    expect(view.dialog()).toBeNull();
    await view.unmount();
  });

  test("closes on its close button", async () => {
    const view = await mount();
    const close = view
      .dialog()
      ?.querySelector<HTMLButtonElement>('button[aria-label="Close task details"]');
    expect(close).toBeTruthy();
    await act(async () => close?.click());
    expect(view.closed()).toBe(1);
    expect(view.dialog()).toBeNull();
    await view.unmount();
  });
});
