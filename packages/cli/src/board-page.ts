import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boardPage, shippedBoardPage } from "@nf/core";

/** The page a published install ships beside `dist/`. */
const SHIPPED = fileURLToPath(new URL("./board/index.html", import.meta.url));
const CHECKOUT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CHECKOUT_BOARD = fileURLToPath(new URL("../../board", import.meta.url));

/**
 * The board page: the one beside the bundle when nf runs from an npm install, else the checkout's
 * own bundle (rebuilt first when it is missing or older than its sources).
 */
export const boardTemplate = existsSync(SHIPPED)
  ? shippedBoardPage(SHIPPED)
  : boardPage({ root: CHECKOUT_ROOT, board: CHECKOUT_BOARD });
