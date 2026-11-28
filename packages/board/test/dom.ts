import { GlobalRegistrator } from "@happy-dom/global-registrator";

const TIMERS = [
  "queueMicrotask",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
] as const;

// react-dom keeps the timers it finds when it is first imported, and bun shares that module across
// test files, so it must keep the runtime's own: a happy-dom window's stop when it is unregistered.
export const registerDom = (
  url: string,
  size: { width: number; height: number } = { width: 1440, height: 1000 },
): void => {
  const native = TIMERS.map((name) => [name, globalThis[name]] as const);
  GlobalRegistrator.register({ url, ...size });
  for (const [name, timer] of native) Object.assign(globalThis, { [name]: timer });
};

export const unregisterDom = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await GlobalRegistrator.unregister();
};
