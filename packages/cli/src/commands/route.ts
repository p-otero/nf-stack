import * as Effect from "effect/Effect";
import {
  ROUTE_BLOCK_REASONS,
  listRouteBlocks,
  oneOf,
  removeRouteBlock,
  routeKey,
  ulid,
  upsertRouteBlock,
} from "@nf/core";
import type { RouteBlock } from "@nf/core";
import { UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";
import { routeBlockLine, routeBlockText } from "../format.ts";

const block = Effect.fn("cli.route.block")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      provider: { type: "string" },
      model: { type: "string" },
      reason: { type: "string" },
      "reset-at": { type: "string" },
      evidence: { type: "string" },
    },
    0,
  );
  const provider = yield* a.need("provider");
  const model = yield* a.need("model");
  const reason = yield* oneOf("block reason", a.str("reason"), ROUTE_BLOCK_REASONS);
  const resetAt = a.str("reset-at") ?? null;
  if (resetAt !== null && Number.isNaN(Date.parse(resetAt)))
    return yield* new UsageError({
      message: `--reset-at must be an ISO 8601 date, got '${resetAt}'`,
    });
  const store = yield* cli.store;
  const now = new Date().toISOString();
  const route: RouteBlock = {
    provider_instance_id: provider,
    model,
    reason,
    reset_at: resetAt,
    evidence: a.str("evidence") ?? null,
    blocked_at: now,
  };
  yield* cli.withStore(
    upsertRouteBlock({ id: ulid(), machine: store.machine, block: route, at: now }),
  );
  return yield* cli.emit(route, () => routeBlockText(route));
});

const unblock = Effect.fn("cli.route.unblock")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    { provider: { type: "string" }, model: { type: "string" }, all: { type: "boolean" } },
    0,
  );
  const all = a.bool("all");
  const provider = a.str("provider");
  const model = a.str("model");
  const target = provider !== undefined && model !== undefined ? { provider, model } : null;
  if (all && (provider !== undefined || model !== undefined))
    return yield* new UsageError({ message: "use --all alone, or --provider with --model" });
  if (!all && target === null)
    return yield* new UsageError({ message: "missing --provider/--model, or --all" });
  const removed = yield* cli.withStore(
    removeRouteBlock(target?.provider ?? null, target?.model ?? null),
  );
  return yield* cli.emit(removed, () =>
    removed.length === 0
      ? "no matching route block"
      : removed.map((b) => `unblocked ${routeKey(b.provider_instance_id, b.model)}`).join("\n"),
  );
});

const list = Effect.fn("cli.route.list")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const blocks = yield* cli.withStore(listRouteBlocks());
  const now = Date.now();
  yield* cli.emit(blocks, () =>
    blocks.length === 0 ? "no route blocks" : blocks.map((b) => routeBlockLine(b, now)).join("\n"),
  );
});

export const route = Effect.fn("cli.route")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "block":
      return yield* block(rest);
    case "unblock":
      return yield* unblock(rest);
    case "list":
      return yield* list(rest);
    default:
      return yield* new UsageError({
        message: `unknown route command '${sub ?? ""}' (block|unblock|list)`,
      });
  }
});
