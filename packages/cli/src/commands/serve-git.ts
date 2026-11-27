import type { ServerResponse } from "node:http";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import {
  errorText,
  gitBranches,
  gitCommit,
  gitCompare,
  gitLog,
  gitRepos,
  gitWorktrees,
  gitWorktree,
  isNfError,
  t3StatePath,
  taskBranch,
} from "@nf/core";
import type { GitApiContext, NfError, PullRequestSource, StoreError } from "@nf/core";
import type { Cli } from "../context.ts";
import { sendJson } from "./serve-http.ts";

const GIT_API = "/api/git/";
const TASK_BRANCH_PATH = /^\/api\/tasks\/([A-Za-z0-9]+-[0-9]+)\/branch$/;

const STATUS_OF_CODE: Record<string, number> = {
  invalid_value: 400,
  repo_outside_workspace: 403,
  not_found: 404,
};

const failure = (res: ServerResponse, error: unknown): void => {
  if (!isNfError(error)) return sendJson(res, 500, { error: errorText(error) });
  sendJson(res, STATUS_OF_CODE[error.code] ?? 500, { error: error.message, code: error.code });
};

class MissingParameter extends Error {}

const required = (params: URLSearchParams, name: string): string => {
  const value = params.get(name);
  if (value === null || value.length === 0) throw new MissingParameter(name);
  return value;
};

const flag = (params: URLSearchParams, name: string): boolean => {
  const value = params.get(name);
  return value === "1" || value === "true";
};

type GitRead = Effect.Effect<unknown, NfError | StoreError | Schema.SchemaError>;

interface GitRouteContext {
  readonly cli: Cli["Service"];
  readonly readPullRequest: PullRequestSource;
}

/** The read a git route answers with, or null when the path is not one. */
const gitRead = (
  context: GitRouteContext,
  path: string,
  params: URLSearchParams,
): GitRead | null => {
  const { cli } = context;
  const api: GitApiContext = {
    home: cli.home,
    t3State: t3StatePath(cli.env),
    readPullRequest: context.readPullRequest,
  };
  const task = TASK_BRANCH_PATH.exec(path);
  if (task?.[1] !== undefined) return cli.withStore(taskBranch(api, task[1]));
  if (!path.startsWith(GIT_API)) return null;
  switch (path.slice(GIT_API.length)) {
    case "repos":
      return cli.withStore(gitRepos(api, required(params, "project")));
    case "worktrees":
      return cli.withStore(
        gitWorktrees(api, required(params, "project"), required(params, "repo")),
      );
    case "branches":
      return cli.withStore(
        gitBranches(
          api,
          required(params, "project"),
          required(params, "repo"),
          params.get("worktree"),
        ),
      );
    case "log":
      return cli.withStore(
        gitLog(api, required(params, "project"), required(params, "repo"), params.get("worktree"), {
          branch: params.get("branch"),
          all: flag(params, "all"),
          cursor: params.get("cursor"),
          limit: params.get("limit"),
        }),
      );
    case "commit":
      return cli.withStore(
        gitCommit(
          api,
          required(params, "project"),
          required(params, "repo"),
          required(params, "sha"),
        ),
      );
    case "compare":
      return cli.withStore(
        gitCompare(
          api,
          required(params, "project"),
          required(params, "repo"),
          required(params, "base"),
          required(params, "head"),
        ),
      );
    case "worktree":
      return cli.withStore(
        gitWorktree(api, {
          project: params.get("project"),
          repo: params.get("repo"),
          task: params.get("task"),
          worktree: params.get("worktree"),
        }),
      );
    default:
      return null;
  }
};

/** Answer a read-only git route; false when the path is not one, so the caller keeps routing. */
async function serveGit(context: GitRouteContext, res: ServerResponse, url: URL): Promise<boolean> {
  let read: GitRead | null;
  try {
    read = gitRead(context, url.pathname, url.searchParams);
  } catch (error) {
    if (!(error instanceof MissingParameter)) throw error;
    sendJson(res, 400, { error: `pass ${error.message}`, code: "invalid_value" });
    return true;
  }
  if (read === null) return false;
  try {
    const body = await Effect.runPromise(read);
    sendJson(res, 200, body, { "Cache-Control": "no-store" });
  } catch (error) {
    failure(res, error);
  }
  return true;
}

export { serveGit };
export type { GitRouteContext };
