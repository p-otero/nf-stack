import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

const render = async (element: ReactElement) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return async () => {
    await act(async () => root.unmount());
    container.remove();
  };
};

// The first render of a large component tree fetches and runs a lot of code; on a loaded machine
// that one-off cost lands in whichever test renders first and can outlast its timeout, so a file
// pays it up front.
const warmUp = async (element: ReactElement) => {
  const unmount = await render(element);
  await unmount();
};

export { render, warmUp };
