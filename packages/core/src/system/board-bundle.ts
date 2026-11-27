import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { NfError } from "@nf/contracts";
import { BOARD_DATA_MARKER } from "./board-page.ts";

/** `dist/index.html` inside `packages/board`: the prebuilt page `nf board` injects data into. */
export const BOARD_PAGE = join("dist", "index.html");

/** What the page is built from: the sources, the registry pin and the manifest that holds them. */
const BOARD_INPUTS = ["package.json", "components.json"] as const;
const BOARD_SOURCE = "src";

/** Files the page is built from, relative to the board package. */
function boardInputFiles(board: string): string[] {
  const out = BOARD_INPUTS.map((name) => join(board, name));
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(join(board, BOARD_SOURCE));
  return out;
}

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export interface BoardBundleSnapshot {
  /** `null` when the page has not been built yet. */
  readonly pageMtimeMs: number | null;
  /** Every input mtime; a file that disappeared simply is not in the list. */
  readonly inputMtimes: readonly number[];
}

export function boardBundleSnapshot(board: string): BoardBundleSnapshot {
  const inputs = boardInputFiles(board).flatMap((path) => {
    const mtime = mtimeOf(path);
    return mtime === null ? [] : [mtime];
  });
  return { pageMtimeMs: mtimeOf(join(board, BOARD_PAGE)), inputMtimes: inputs };
}

export type BoardBundleState = "fresh" | "missing" | "outdated";

/**
 * Whether `nf board` may embed the page as it is. Equal mtimes count as fresh: some filesystems
 * only keep whole seconds, and a source saved in the same second as the build is not newer.
 */
export function boardBundleState(snapshot: BoardBundleSnapshot): BoardBundleState {
  if (snapshot.pageMtimeMs === null) return "missing";
  const page = snapshot.pageMtimeMs;
  return snapshot.inputMtimes.some((mtime) => mtime > page) ? "outdated" : "fresh";
}

/** The tail of a failed build's output, so the error message says what broke. */
function buildFailure(result: SpawnSyncReturns<string>): string {
  if (result.error !== undefined) return ` (${result.error.message})`;
  const output = `${result.stderr}${result.stdout}`.trim();
  const last = output.split("\n").slice(-3).join("\n").trim();
  return last.length === 0 ? "" : `: ${last}`;
}

/**
 * Guarantees the prebuilt page is newer than everything it is built from, rebuilding it with the
 * board's own build script when it is missing or stale. A board that cannot be rebuilt is a
 * failure, never a snapshot of an old bundle.
 */
export const ensureBoardBundle = Effect.fn("Board.ensureBoardBundle")(function* (options: {
  /** The NF checkout, where `bun run board:build` is defined. */
  readonly root: string;
  /** `packages/board`. */
  readonly board: string;
}) {
  const snapshot = yield* Effect.sync(() => boardBundleSnapshot(options.board));
  const state = boardBundleState(snapshot);
  if (state === "fresh") return yield* Effect.void;
  const result = yield* Effect.sync(() =>
    spawnSync("bun", ["run", "board:build"], { cwd: options.root, encoding: "utf8" }),
  );
  const why =
    state === "missing"
      ? "the board bundle is missing"
      : "the board bundle is older than packages/board/src or its registry pin";
  if (result.status !== 0) {
    return yield* new NfError({
      code: "board_build_failed",
      message: `${why} and 'bun run board:build' failed${buildFailure(result)}`,
    });
  }
  const rebuilt = yield* Effect.sync(() => boardBundleSnapshot(options.board));
  if (boardBundleState(rebuilt) !== "fresh") {
    return yield* new NfError({
      code: "board_build_failed",
      message: `${why} and 'bun run board:build' left ${join(options.board, BOARD_PAGE)} unreadable`,
    });
  }
  return yield* Effect.void;
});

const NOT_BUILT = "the board bundle is missing; run 'bun run board:build' in the NF checkout";

const readPage = Effect.fnUntraced(function* (path: string, problem: string) {
  const page = yield* Effect.try({
    try: () => readFileSync(path, "utf8"),
    catch: () =>
      new NfError({ code: "board_not_built", message: `${path} cannot be read; ${problem}` }),
  });
  if (!page.includes(BOARD_DATA_MARKER)) {
    return yield* new NfError({
      code: "board_not_built",
      message: `${path} is not an NF Board page; ${problem}`,
    });
  }
  return page;
});

/**
 * The prebuilt page as it is, rebuilt first when it is missing or older than its sources, so
 * `nf board` can embed a snapshot and `nf serve` can hand the same bundle to a browser.
 */
export const boardPage = Effect.fn("Board.boardPage")(function* (options: {
  /** The NF checkout, where `bun run board:build` is defined. */
  readonly root: string;
  /** `packages/board`. */
  readonly board: string;
}) {
  yield* ensureBoardBundle(options);
  return yield* readPage(join(options.board, BOARD_PAGE), NOT_BUILT);
});

/**
 * The page a published install ships beside the bundle. There is no checkout to rebuild it from,
 * so a page that is missing or not an NF Board page means a broken install.
 */
export const shippedBoardPage = Effect.fn("Board.shippedBoardPage")(function* (path: string) {
  return yield* readPage(path, "reinstall @p-otero/nf-stack");
});
