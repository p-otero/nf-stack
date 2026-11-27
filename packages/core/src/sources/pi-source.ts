import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import * as Effect from "effect/Effect";
import { COST_QUALITY, NfError, USAGE_SOURCE, USAGE_STATUS } from "@nf/contracts";
import type { TokenFields, UsageEventInput, UsageStatus } from "@nf/contracts";
import { estimateCost, unknownCost } from "../domain/prices.ts";
import type { CostEstimate, PriceFile } from "../domain/prices.ts";
import {
  emptyTokens,
  money,
  obj,
  parseJsonObject,
  textId,
  tokenCount,
  usageStatus,
  utcTimestamp,
} from "../domain/usage.ts";
import type { PiThread } from "./t3-source.ts";

interface PiHeader {
  file: string;
  id: string | null;
  parent: string | null;
  depth: number;
}

export interface PiRead {
  events: UsageEventInput[];
  duplicates: number;
  warnings: string[];
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function jsonlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
    }
  };
  walk(root);
  return out.toSorted();
}

function firstLine(file: string): string | null {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const newline = text.indexOf("\n");
    return newline < 0 ? text : text.slice(0, newline);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Session headers ordered parents first, so a fork's replayed entries dedupe to the parent. */
function readPiHeaders(paths: string[]): PiHeader[] {
  const headers = new Map<string, PiHeader>();
  const byPath = new Map<string, PiHeader>();
  for (const file of paths) {
    const line = firstLine(file);
    const head = line ? parseJsonObject(line) : null;
    const header: PiHeader = {
      file,
      id: textId(head?.["id"]),
      parent: textId(head?.["parentSession"]),
      depth: 0,
    };
    headers.set(file, header);
    byPath.set(normPath(file), header);
  }
  const depthOf = (header: PiHeader, seen: Set<string>): number => {
    if (header.parent === null) return 0;
    const key = normPath(header.file);
    if (seen.has(key)) return 0;
    seen.add(key);
    const parent = byPath.get(normPath(header.parent));
    return parent ? depthOf(parent, seen) + 1 : 1;
  };
  const withDepth = (header: PiHeader): PiHeader => ({
    ...header,
    depth: depthOf(header, new Set()),
  });
  return [...headers.values()]
    .map(withDepth)
    .toSorted((a, b) =>
      a.depth === b.depth
        ? a.file.toLowerCase().localeCompare(b.file.toLowerCase())
        : a.depth - b.depth,
    );
}

/**
 * Pi entries already use the normalized shape: totalTokens = input + output + cacheRead +
 * cacheWrite, input excludes cache and output includes reasoning. A line that is not a JSON
 * object, or an assistant entry with no stable key, is skipped and counted as malformed.
 */
function readSessions(
  root: string,
  prices: PriceFile,
  piFiles: ReadonlyMap<string, PiThread>,
): PiRead {
  const headers = readPiHeaders(jsonlFiles(root));
  const sessionThread = new Map<string, PiThread>();
  for (const header of headers) {
    if (!header.id) continue;
    const thread = piFiles.get(basename(header.file).toLowerCase());
    if (thread) sessionThread.set(header.id, thread);
  }

  const events: UsageEventInput[] = [];
  const seenKeys = new Set<string>();
  let duplicates = 0;
  let malformed = 0;
  let undated = 0;
  for (const header of headers) {
    let lines: string[];
    try {
      lines = readFileSync(header.file, "utf8").split("\n");
    } catch {
      malformed++;
      continue;
    }
    const thread = header.id ? sessionThread.get(header.id) : undefined;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const entry = parseJsonObject(line);
      if (!entry) {
        // JSON that is not an object (e.g. a bare number) was never an entry either
        if (!isJson(line)) malformed++;
        continue;
      }
      if (entry["type"] !== "message") continue;
      const message = obj(entry["message"]);
      if (message?.["role"] !== "assistant") continue;
      const usage = obj(message["usage"]);
      const tokens: TokenFields = usage
        ? {
            input_tokens: tokenCount(usage["input"]),
            output_tokens: tokenCount(usage["output"]),
            cache_read_tokens: tokenCount(usage["cacheRead"]),
            cache_write_tokens: tokenCount(usage["cacheWrite"]),
            reasoning_tokens: tokenCount(usage["reasoning"]),
          }
        : emptyTokens();
      const status: UsageStatus = usage ? usageStatus(tokens, undefined) : USAGE_STATUS.UNAVAILABLE;
      const ts = utcTimestamp(entry["timestamp"]);
      if (!ts) {
        undated++;
        continue;
      }
      const responseId = textId(message["responseId"]);
      const entryId = textId(entry["id"]);
      const sourceKey = responseId
        ? `pi:r:${responseId}`
        : entryId
          ? `pi:e:${entryId}:${ts}`
          : null;
      if (!sourceKey) {
        malformed++;
        continue;
      }
      if (seenKeys.has(sourceKey)) {
        duplicates++;
        continue;
      }
      seenKeys.add(sourceKey);
      const model = textId(message["model"]);
      const reported = money(obj(usage?.["cost"])?.["total"]);
      let cost: CostEstimate;
      if (reported !== null && reported > 0) {
        cost = {
          cost_usd: reported,
          cost_quality: COST_QUALITY.REPORTED,
          price_source: "pi",
          price_date: null,
        };
      } else if (status === USAGE_STATUS.UNAVAILABLE) {
        cost = unknownCost();
      } else {
        cost = estimateCost(prices, model, tokens);
      }
      events.push({
        source: USAGE_SOURCE.PI,
        source_key: sourceKey,
        t3_thread_id: thread?.thread_id ?? null,
        native_session_id: header.id,
        run_id: null,
        turn_id: entryId,
        provider: textId(message["provider"]),
        model,
        ts,
        usage_status: status,
        is_subagent: thread?.is_subagent ?? false,
        cost_usd: cost.cost_usd,
        cost_quality: cost.cost_quality,
        price_source: cost.price_source,
        price_date: cost.price_date,
        ...tokens,
      });
    }
  }
  const warnings: string[] = [];
  if (malformed > 0) warnings.push(`Pi: ${malformed} malformed entries were skipped`);
  if (undated > 0)
    warnings.push(`Pi: ${undated} assistant entries without a timestamp were skipped`);
  return { events, duplicates, warnings };
}

function isJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/** Read assistant usage from every Pi session under `root` (read-only). */
export const readPi = Effect.fn("Pi.read")(function* (
  root: string,
  prices: PriceFile,
  piFiles: ReadonlyMap<string, PiThread>,
) {
  const isDir = yield* Effect.sync(() => existsSync(root) && statSync(root).isDirectory());
  if (!isDir) {
    return yield* new NfError({
      code: "source_missing",
      message: `Pi sessions directory not found: ${root}`,
    });
  }
  return yield* Effect.try({
    try: () => readSessions(root, prices, piFiles),
    catch: (cause) =>
      new NfError({
        code: "source_unavailable",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
});
