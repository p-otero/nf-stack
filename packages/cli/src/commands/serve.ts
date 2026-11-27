import { createHash, randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  NfError,
  artifactMimeType,
  boardData,
  errorText,
  isNfError,
  locationCache,
  renderBoardSource,
  t3StatePath,
} from "@nf/core";
import type { BoardPageData, LocationCache, PriceFile } from "@nf/core";
import { parse, portValue } from "../args.ts";
import { boardTemplate } from "../board-page.ts";
import { Cli } from "../context.ts";
import { loadBoardPrices } from "../prices.ts";
import { version } from "../version.ts";
import { serveGit } from "./serve-git.ts";
import { ifNoneMatch, json, notModified, send, sendJson } from "./serve-http.ts";
import { TASK_ACTION_PATH, serveTaskAction, writeGuard } from "./serve-write.ts";
import type { WriteGuard } from "./serve-write.ts";

const HOST = "127.0.0.1";
export const DEFAULT_BOARD_PORT = 4646;
const SERVER_APP = "nf";
const BOARD_API = "/api/board";
const TASKS_API = "/api/tasks";
const HEALTH_API = "/api/health";
const ARTIFACT_BASE = "/artifacts";
const ARTIFACT_PATH = /^\/artifacts\/([A-Za-z0-9]+)$/;

const Health = Schema.Struct({
  app: Schema.String,
  version: Schema.String,
  nfHome: Schema.String,
});
type Health = typeof Health.Type;
const decodeHealth = Schema.decodeUnknownOption(Health);

interface ServeContext {
  readonly cli: Cli["Service"];
  /** The live page: the prebuilt bundle pointed at this server's API. */
  readonly page: string;
  /** PR facts and git answers kept between polls, so only a cold board waits for them. */
  readonly locations: LocationCache;
  /** Cached rates, read once: a board shows what the store holds and never refreshes them. */
  readonly prices: PriceFile;
}

interface Bound {
  readonly port: number;
  /** The `nf serve` this port already answers with, when starting one was not needed. */
  readonly running: Health | null;
}

const healthOf = (cli: Cli["Service"]): Health => ({
  app: SERVER_APP,
  version: version(),
  nfHome: cli.home,
});

/**
 * What the ETag covers: the board's data. The render time is not data, so it is zeroed out: a
 * snapshot's `generatedAt`, and the range an empty telemetry view falls back to.
 */
const etagPayload = (data: BoardPageData) => ({
  ...data,
  generatedAt: "",
  telemetry: {
    strategy: { ...data.telemetry.strategy, range: { from: "", to: "" } },
    model: { ...data.telemetry.model, range: { from: "", to: "" } },
    coordinator: { ...data.telemetry.coordinator, range: { from: "", to: "" } },
  },
});

const dataEtag = (data: BoardPageData): string =>
  `"${createHash("sha256")
    .update(json(etagPayload(data)))
    .digest("hex")}"`;

const errnoCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const asNfError = (error: unknown): NfError =>
  isNfError(error) ? error : new NfError({ code: "serve_failed", message: errorText(error) });

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resume, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resume(typeof address === "object" && address !== null ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

/** The `nf serve` answering on this port, `null` when the holder is something else. */
async function runningServer(port: number): Promise<Health | null> {
  try {
    const response = await fetch(`http://${HOST}:${port}${HEALTH_API}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const health = decodeHealth(body);
    return Option.isSome(health) && health.value.app === SERVER_APP ? health.value : null;
  } catch {
    return null;
  }
}

async function bind(server: Server, port: number): Promise<Bound> {
  try {
    return { port: await listen(server, port), running: null };
  } catch (error) {
    if (errnoCode(error) !== "EADDRINUSE") {
      throw new NfError({
        code: "port_unavailable",
        message: `cannot listen on ${HOST}:${port}: ${errorText(error)}`,
      });
    }
    const running = await runningServer(port);
    if (running === null) {
      throw new NfError({
        code: "port_in_use",
        message: `port ${port} is already in use by another process; pass --port <n> (nf serve defaults to ${DEFAULT_BOARD_PORT})`,
      });
    }
    return { port, running };
  }
}

async function serveBoard(
  context: ServeContext,
  req: IncomingMessage,
  res: ServerResponse,
  ref: string | null,
): Promise<void> {
  const { cli } = context;
  const store = await Effect.runPromise(cli.store);
  const projects = await Effect.runPromise(store.listProjects());
  const selected =
    ref === null
      ? null
      : (projects.find((project) => project.prefix === ref.toUpperCase()) ?? null);
  if (ref !== null && selected === null) {
    const known = projects.map((project) => project.prefix).join(", ") || "none";
    return sendJson(res, 404, { error: `project '${ref}' is not registered (known: ${known})` });
  }
  const data = await Effect.runPromise(
    cli.withStore(
      boardData({
        projectId: selected?.id ?? null,
        at: new Date().toISOString(),
        home: cli.home,
        t3State: t3StatePath(cli.env),
        artifactBase: ARTIFACT_BASE,
        prices: context.prices,
        readPullRequest: context.locations.readPullRequest,
        gitProbe: context.locations.gitProbe,
      }),
    ),
  );
  const etag = dataEtag(data);
  if (ifNoneMatch(req, etag)) return notModified(res, etag);
  send(res, 200, json(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ETag: etag,
  });
}

async function serveArtifact(
  cli: Cli["Service"],
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const store = await Effect.runPromise(cli.store);
  const attachment = await Effect.runPromise(store.findAttachment(id));
  if (attachment === null) {
    return sendJson(res, 404, { error: `attachment '${id}' is not recorded` });
  }
  const root = resolve(cli.home, "artifacts");
  const path = resolve(attachment.path);
  if (!path.startsWith(`${root}${sep}`)) {
    return sendJson(res, 404, { error: `attachment '${id}' is outside the artifact tree` });
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return sendJson(res, 404, { error: `attachment '${id}' cannot be read` });
  }
  const etag = `"${attachment.sha256}"`;
  if (ifNoneMatch(req, etag)) return notModified(res, etag);
  send(res, 200, bytes, {
    "Content-Type": artifactMimeType(path) ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    ETag: etag,
  });
}

async function answer(
  context: ServeContext,
  guard: WriteGuard,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const taskAction = TASK_ACTION_PATH.exec(url.pathname);
  if (taskAction !== null) {
    const taskRef = taskAction[1];
    const action = taskAction[2];
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "review actions answer POST only" }, { Allow: "POST" });
    }
    if (taskRef === undefined || (action !== "accept" && action !== "reject")) {
      return sendJson(res, 404, { error: `'${url.pathname}' is not an nf serve route` });
    }
    return serveTaskAction(context, guard, req, res, taskRef, action);
  }
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "nf serve answers GET only" }, { Allow: "GET" });
  }
  if (url.pathname === "/") {
    return send(res, 200, context.page, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
  }
  if (url.pathname === HEALTH_API) return sendJson(res, 200, healthOf(context.cli));
  if (url.pathname === BOARD_API) {
    return serveBoard(context, req, res, url.searchParams.get("project"));
  }
  if (
    await serveGit(
      { cli: context.cli, readPullRequest: context.locations.readPullRequest },
      res,
      url,
    )
  ) {
    return;
  }
  const artifact = ARTIFACT_PATH.exec(url.pathname);
  if (artifact !== null) {
    const id = artifact[1];
    if (id !== undefined) return serveArtifact(context.cli, req, res, id);
  }
  return sendJson(res, 404, { error: `'${url.pathname}' is not an nf serve route` });
}

const sameHome = (left: string, right: string): boolean => {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
};

const failResponse = (res: ServerResponse, error: unknown): void => {
  if (res.headersSent) res.end();
  else sendJson(res, 500, { error: errorText(error) });
};

/** Read the next PR facts and git answers after a response, so no poll waits for them. */
function refreshLocations(locations: LocationCache): void {
  void Effect.runPromise(locations.refresh).catch(() => undefined);
}

const waitForStop = (server: Server) =>
  Effect.callback<void>((resume) => {
    const stop = () => {
      server.closeAllConnections();
      server.close(() => resume(Effect.void));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return Effect.sync(() => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    });
  });

export const serve = Effect.fn("cli.serve")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { port: { type: "string" } });
  const port = yield* portValue(a.str("port"), DEFAULT_BOARD_PORT, 0);
  const token = randomBytes(32).toString("base64url");
  const page = renderBoardSource(yield* boardTemplate, {
    kind: "live",
    api: BOARD_API,
    actions: TASKS_API,
    token,
  });
  const prices = yield* loadBoardPrices(cli.home, cli.env);
  const context: ServeContext = { cli, page, locations: locationCache(), prices };
  const guard = writeGuard(token, port);
  const server = createServer((req, res) => {
    void answer(context, guard, req, res)
      .catch((error: unknown) => failResponse(res, error))
      .then(() => refreshLocations(context.locations));
  });
  const bound = yield* Effect.tryPromise({ try: () => bind(server, port), catch: asNfError });
  guard.port = bound.port;
  const url = `http://localhost:${bound.port}/`;
  if (bound.running !== null) {
    if (!sameHome(bound.running.nfHome, cli.home)) {
      return yield* new NfError({
        code: "nf_home_mismatch",
        message: `nf serve is already running on port ${bound.port} with NF_HOME ${bound.running.nfHome}; one server serves one store, so use that one or pass another --port`,
      });
    }
    yield* cli.emit(
      { url, port: bound.port, reused: true },
      () => `nf serve: already running at ${url}`,
    );
    return yield* Effect.void;
  }
  yield* cli.emit(
    { url, port: bound.port, reused: false },
    () => `nf serve: ${url} (live board with review actions, ${HOST} only)`,
  );
  return yield* waitForStop(server);
});
