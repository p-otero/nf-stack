import { spawn } from "node:child_process";
import * as Effect from "effect/Effect";
import { NfError } from "@nf/contracts";

/**
 * Every read disables what could write behind it: optional locks (the index refresh `status` and
 * `diff` do), fsmonitor hooks, external diff and textconv programs, prompts and pagers.
 */
const READ_ONLY_ARGS = [
  "--no-optional-locks",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "color.ui=never",
  "-c",
  "log.showSignature=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.relative=false",
] as const;

const REDIRECTING_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"] as const;

const readOnlyEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
  };
  for (const name of REDIRECTING_ENV) delete env[name];
  return env;
};

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export interface GitOutput {
  readonly stdout: string;
  /** Git printed more than `maxBytes`; `stdout` holds the first `maxBytes`. */
  readonly cut: boolean;
}

export interface GitReadOptions {
  readonly maxBytes?: number;
  /** Exit codes that are answers rather than failures (`merge-base` prints nothing and exits 1). */
  readonly okCodes?: readonly number[];
}

const gitFailed = (cwd: string, args: readonly string[], detail: string) =>
  new NfError({
    code: "git_failed",
    message: `git ${args.join(" ")} failed in ${cwd}: ${detail}`,
  });

/** Run one read-only git command in `cwd`, keeping at most `maxBytes` of its output. */
export const readGit = (
  cwd: string,
  args: readonly string[],
  options: GitReadOptions = {},
): Effect.Effect<GitOutput, NfError> =>
  Effect.callback<GitOutput, NfError>((resume) => {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const okCodes = options.okCodes ?? [0];
    const child = spawn("git", [...READ_ONLY_ARGS, ...args], {
      cwd,
      env: readOnlyEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: TIMEOUT_MS,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    let stderr = "";
    let settled = false;
    const settle = (effect: Effect.Effect<GitOutput, NfError>) => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (cut) return;
      const room = maxBytes - size;
      if (chunk.byteLength > room) {
        chunks.push(chunk.subarray(0, room));
        size = maxBytes;
        cut = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
      size += chunk.byteLength;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => settle(Effect.fail(gitFailed(cwd, args, error.message))));
    child.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf8");
      if (cut || (code !== null && okCodes.includes(code))) {
        return settle(Effect.succeed({ stdout, cut }));
      }
      const detail = stderr.trim().split("\n")[0] ?? "";
      settle(Effect.fail(gitFailed(cwd, args, detail.length > 0 ? detail : `exit ${code}`)));
    });
    return Effect.sync(() => {
      if (!settled) child.kill();
    });
  });

/** The output of a read that must succeed, trimmed of its final newline. */
export const gitText = (cwd: string, args: readonly string[]) =>
  readGit(cwd, args).pipe(Effect.map((output) => output.stdout.replace(/\n$/, "")));

/** The output, or null when git refuses (an unknown ref, no upstream, no HEAD yet). */
export const gitTextOrNull = (cwd: string, args: readonly string[]) =>
  gitText(cwd, args).pipe(
    Effect.map((text): string | null => text),
    Effect.catchTags({ NfError: () => Effect.succeed(null) }),
  );

/** `-z` output split into its NUL-terminated fields. */
export const nulFields = (text: string): string[] => {
  const fields = text.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
};
