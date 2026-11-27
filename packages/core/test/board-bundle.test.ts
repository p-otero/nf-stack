import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { isNfError } from "@nf/contracts";
import {
  BOARD_PAGE,
  boardBundleSnapshot,
  boardBundleState,
  ensureBoardBundle,
} from "../src/index.ts";

const at = (seconds: number) => new Date(seconds * 1000);
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function board(sourceMtimes: { css: number; pin: number; page?: number }): string {
  const dir = join(tmpdir(), `nf-bundle-${Math.random().toString(36).slice(2)}`);
  dirs.push(dir);
  mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "components.json"), "{}");
  writeFileSync(join(dir, "src", "components", "ui", "badge.tsx"), "");
  writeFileSync(join(dir, "src", "index.css"), "");
  utimesSync(join(dir, "package.json"), at(1), at(1));
  utimesSync(join(dir, "components.json"), at(sourceMtimes.pin), at(sourceMtimes.pin));
  utimesSync(join(dir, "src", "index.css"), at(sourceMtimes.css), at(sourceMtimes.css));
  utimesSync(
    join(dir, "src", "components", "ui", "badge.tsx"),
    at(Math.min(sourceMtimes.css, sourceMtimes.pin)),
    at(Math.min(sourceMtimes.css, sourceMtimes.pin)),
  );
  if (sourceMtimes.page !== undefined) {
    writeFileSync(join(dir, "dist", "index.html"), "<!doctype html>");
    utimesSync(join(dir, "dist", "index.html"), at(sourceMtimes.page), at(sourceMtimes.page));
  }
  return dir;
}

describe("board bundle staleness", () => {
  test("a missing page is rebuilt, a page older than any input too, and a newer one is used", () => {
    expect(boardBundleState({ pageMtimeMs: null, inputMtimes: [1, 2, 3] })).toBe("missing");
    expect(boardBundleState({ pageMtimeMs: 5, inputMtimes: [1, 2, 3] })).toBe("fresh");
    // Equal times are fresh: a source saved in the same second as the build is not newer.
    expect(boardBundleState({ pageMtimeMs: 3, inputMtimes: [1, 2, 3] })).toBe("fresh");
    expect(boardBundleState({ pageMtimeMs: 2, inputMtimes: [1, 2, 3] })).toBe("outdated");
    expect(boardBundleState({ pageMtimeMs: 1, inputMtimes: [] })).toBe("fresh");
  });

  test("collects the page and every input that would change it", async () => {
    const missing = boardBundleSnapshot(board({ css: 100, pin: 100 }));
    expect(missing.pageMtimeMs).toBeNull();
    expect(missing.inputMtimes).toHaveLength(4);
    expect(boardBundleState(missing)).toBe("missing");

    const fresh = board({ css: 100, pin: 100, page: 200 });
    expect(boardBundleState(boardBundleSnapshot(fresh))).toBe("fresh");

    // The registry pin moved after the page was built: the page no longer matches the sources.
    const repinned = board({ css: 100, pin: 300, page: 200 });
    expect(boardBundleState(boardBundleSnapshot(repinned))).toBe("outdated");
    expect(BOARD_PAGE).toBe(join("dist", "index.html"));
  });

  test("a stale page whose rebuild fails is an error with the build output, not a snapshot", async () => {
    const root = board({ css: 100, pin: 100 });
    const error = await Effect.runPromise(
      Effect.flip(ensureBoardBundle({ root, board: join(root, "packages", "board") })),
    );
    expect(isNfError(error)).toBe(true);
    if (isNfError(error)) {
      expect(error.code).toBe("board_build_failed");
      expect(error.message).toContain("bun run board:build");
    }
  });
});
