import { describe, expect, test } from "bun:test";

import { pageProblems, reactDevBanner, viewportHeightUnit } from "./page-checks.mjs";

const page = (body) =>
  `<!doctype html><html><head><style>body { margin: 0 }</style></head><body>${body}<!-- nf-board-data --></body></html>`;

describe("page checks", () => {
  test("accepts a self-contained page that takes its height from its content", () => {
    expect(pageProblems(page('<main class="bg-background p-surface">board</main>'))).toEqual([]);
  });

  test("rejects a page that sizes itself against the viewport", () => {
    expect(pageProblems(page('<main class="min-h-screen">board</main>'))).toEqual([
      "uses a viewport height unit: min-h-screen",
    ]);
    expect(viewportHeightUnit("h-screen")).toBe("h-screen");
    expect(viewportHeightUnit("max-h-[calc(100dvh-2rem)]")).toBe("100dvh");
  });

  test("rejects an external asset and a lost data marker", () => {
    const html = page('<link rel="stylesheet" href="board.css" />').replace(
      "<!-- nf-board-data -->",
      "",
    );
    expect(pageProblems(html)).toEqual([
      'still loads an external stylesheet (/<link[^>]+rel="?(stylesheet|preload|modulepreload)/i)',
      "lost the <!-- nf-board-data --> placeholder",
    ]);
  });

  test("accepts a font shipped as bytes and rejects a font file next to the page", () => {
    const inlined = page(
      '<style>@font-face { font-family: "Geist Variable"; src: url("data:font/woff2;base64,d09GMg") format("woff2") }</style>',
    );
    expect(pageProblems(inlined)).toEqual([]);
    const rule = String(/url\((?!\s*["']?data:)/i);
    expect(
      pageProblems(page("<style>@font-face { src: url(./files/geist.woff2) }</style>")),
    ).toEqual([`still loads an asset that is not inlined (${rule})`]);
  });

  test("finds the React DevTools banner only in a development bundle", () => {
    expect(
      reactDevBanner(
        'console.info("Download the React DevTools for a better development experience")',
      ),
    ).toBe("Download the React DevTools for a better development experience");
    expect(reactDevBanner("var a=`production`;")).toBeUndefined();
  });
});
