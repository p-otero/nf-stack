import { homedir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { isUsageSource, priceSourceText, syncUsage, t3StatePath } from "@nf/core";
import type { SyncResult, UsageSource } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";
import { loadCliPrices } from "../prices.ts";

export const sync = Effect.fn("cli.sync")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      source: { type: "string" },
      "dry-run": { type: "boolean" },
      "coordinator-thread": { type: "string", multiple: true },
    },
    0,
  );
  const requested = a.str("source") ?? "all";
  if (requested !== "all" && !isUsageSource(requested)) {
    return yield* new UsageError({ message: `invalid --source '${requested}' (t3|pi|all)` });
  }
  const source: UsageSource | "all" = requested;
  const env = cli.env;
  const prices = yield* loadCliPrices(cli.home, env);
  const result = yield* cli.withStore(
    syncUsage({
      t3State: t3StatePath(env),
      piSessions: env["NF_PI_SESSIONS"] ?? join(homedir(), ".pi", "agent", "sessions"),
      prices,
      source,
      dryRun: a.bool("dry-run"),
      coordinatorThreads: a.strs("coordinator-thread"),
    }),
  );
  return yield* cli.emit(result, () => syncText(result));
});

function syncText(result: SyncResult): string {
  const verb = result.dry_run ? "would insert" : "inserted";
  const lines = result.sources.map((s) => {
    if (s.status === "failed") return `${s.source}: failed: ${s.error ?? "unknown error"}`;
    const parts = [
      `${s.seen} seen`,
      `${s.inserted} ${verb}`,
      `${s.updated} updated`,
      `${s.skipped} skipped`,
      `${s.attributed} attributed`,
      `${s.coordination} coordination`,
      `${s.unattributed} unattributed`,
    ];
    if (s.duplicates > 0) parts.push(`${s.duplicates} replayed`);
    if (s.spawns > 0) parts.push(`${s.spawns} spawns`);
    return `${s.source}: ${parts.join(", ")}`;
  });
  lines.push(
    `total: ${result.seen} seen, ${result.inserted} ${verb}, ${result.updated} updated, ` +
      `${result.skipped} skipped, ${result.attributed} attributed`,
  );
  if (result.price_sources.length > 0)
    lines.push(`prices: ${priceSourceText(result.price_sources)}`);
  for (const s of result.sources) {
    for (const warning of s.warnings) lines.push(`warning (${s.source}): ${warning}`);
  }
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  return lines.join("\n");
}
