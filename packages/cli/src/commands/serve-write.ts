import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ACTOR_ROLE, errorText, isNfError, loadProjectConfig, uiChangeOf } from "@nf/core";
import type { Cli } from "../context.ts";
import { sendJson } from "./serve-http.ts";

const TASK_ACTION_PATH = /^\/api\/tasks\/([A-Za-z0-9]+-[0-9]+)\/(accept|reject)$/;
const TOKEN_HEADER = "x-nf-board-token";
const MAX_ACTION_BODY_BYTES = 16 * 1024;
/** The page and its API share one origin; both ways of naming this loopback host are it. */
const OWN_HOSTS = ["localhost", "127.0.0.1"] as const;

const TaskActionBody = Schema.Struct({ comment: Schema.optionalKey(Schema.String) });
const decodeTaskActionBody = Schema.decodeUnknownOption(Schema.fromJsonString(TaskActionBody));

/** Why a served page, and no other origin, may write: its own random token and its own origin. */
interface WriteGuard {
  /** The token's digest, so the compare is constant-time whatever length it is given. */
  readonly tokenDigest: Buffer;
  /** The port the server bound, known once listening. */
  port: number;
}

/** What a review action needs from the running server. */
interface TaskActionContext {
  readonly cli: Cli["Service"];
}

/** A review action's body above the small limit the page can ever need. */
class BodyTooLarge extends Error {}

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

const writeGuard = (token: string, port: number): WriteGuard => ({
  tokenDigest: digest(token),
  port,
});

const sameOrigin = (port: number): readonly string[] =>
  OWN_HOSTS.map((host) => `http://${host}:${port}`);

const givenToken = (req: IncomingMessage): string | undefined => {
  const value = req.headers[TOKEN_HEADER];
  return typeof value === "string" ? value : undefined;
};

/** Only a page this server served writes: its own token, and the origin and host it was opened at. */
const pageMayWrite = (guard: WriteGuard, req: IncomingMessage): boolean => {
  const token = givenToken(req);
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (token === undefined || origin === undefined || host === undefined) return false;
  const origins = sameOrigin(guard.port);
  return (
    origins.includes(origin) &&
    origins.includes(`http://${host}`) &&
    timingSafeEqual(digest(token), guard.tokenDigest)
  );
};

/** Reads at most `MAX_ACTION_BODY_BYTES`: the body is text the page itself wrote. */
function readActionBody(req: IncomingMessage): Promise<string> {
  return new Promise((resume, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      req.pause();
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > MAX_ACTION_BODY_BYTES) return fail(new BodyTooLarge());
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resume(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

const actionFailure = (res: ServerResponse, error: unknown): void => {
  if (!isNfError(error)) return sendJson(res, 500, { error: errorText(error) });
  const status = error.code === "not_found" ? 404 : error.code === "invalid_value" ? 400 : 409;
  sendJson(res, status, { error: error.message });
};

/**
 * Accept or reject one review task from the page: the same acceptance gate as
 * `nf task accept --approved-by-user`, with its message returned verbatim when it refuses.
 */
async function serveTaskAction(
  context: TaskActionContext,
  guard: WriteGuard,
  req: IncomingMessage,
  res: ServerResponse,
  taskRef: string,
  action: "accept" | "reject",
): Promise<void> {
  if (!pageMayWrite(guard, req)) {
    return sendJson(res, 403, { error: "review actions come from this board's own page" });
  }
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) {
    return sendJson(res, 415, { error: "review actions take an application/json body" });
  }
  const body = await readActionBody(req).catch((error: unknown) => {
    if (error instanceof BodyTooLarge) return null;
    throw error;
  });
  if (body === null) {
    return sendJson(res, 413, { error: `the body is larger than ${MAX_ACTION_BODY_BYTES} bytes` });
  }
  const decoded = decodeTaskActionBody(body);
  if (Option.isNone(decoded)) {
    return sendJson(res, 400, { error: 'the body must be JSON like {"comment": "..."}' });
  }
  const comment = decoded.value.comment ?? null;
  const store = await Effect.runPromise(context.cli.store);
  const task = await Effect.runPromise(store.findTaskByKey(taskRef));
  if (task === null) return sendJson(res, 404, { error: `task '${taskRef}' is not recorded` });
  try {
    const decided =
      action === "accept"
        ? await Effect.runPromise(
            Effect.gen(function* () {
              const project = yield* store.getProject(task.project_id);
              const config = yield* loadProjectConfig(context.cli.home, project.prefix);
              const uiChange = task.ui
                ? yield* uiChangeOf({
                    root: project.root_path,
                    attempts: yield* store.listAttempts(task.project_id, task.key),
                    review: config.uiReview,
                  })
                : null;
              return yield* store.acceptTask(task.project_id, task.key, {
                actor: ACTOR_ROLE.USER,
                approvedByUser: true,
                reason: comment,
                themes: config.themes,
                uiChange,
              });
            }),
          )
        : await Effect.runPromise(
            store.rejectReview(task.project_id, task.key, comment ?? "", {
              actor: ACTOR_ROLE.USER,
            }),
          );
    sendJson(res, 200, { key: decided.key, action, status: decided.status });
  } catch (error) {
    actionFailure(res, error);
  }
}

export { TASK_ACTION_PATH, serveTaskAction, writeGuard };
export type { TaskActionContext, WriteGuard };
