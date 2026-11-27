import { spawn, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const HEALTH_TIMEOUT_MS = 30_000;
const SERVE_READY = /^nf serve: (http:\/\/localhost:\d+\/)/m;
const UNREGISTERED = /is not registered|not inside a registered Git project/;

/** How `nf` is started: `node <bin>` in a checkout, the installed launcher after an npm install. */
export interface NfCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface SetupOptions {
  readonly nf: NfCommand;
  /** The `NF_HOME` the server must name, so a server of another store is not taken for this one. */
  readonly home: string;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}

export type ProjectRegistration =
  { readonly state: "registered"; readonly note: string } | { readonly state: "unregistered" };

export type PolicyAvailability =
  | { readonly state: "ok"; readonly note: string }
  | { readonly state: "missing" }
  | { readonly state: "stale"; readonly note: string };

/** What `nf setup` proves before it says the install is usable. */
export interface SetupChecks {
  readonly version: string;
  readonly status: ProjectRegistration;
  readonly policy: PolicyAvailability;
  readonly port: number;
}

export interface Tools {
  readonly node: { readonly version: string; readonly required: string };
  readonly git: string;
  /** `null` when `gh` is absent: only the board's pull request state needs it. */
  readonly gh: string | null;
}

type Version = readonly [number, number, number];

/** The numbers of `>=24.13` or `24.13.0`; `[0, 0, 0]` when the text has none. */
function parseVersion(text: string): Version {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function meetsMinimum(found: Version, minimum: Version): boolean {
  const [foundMajor, foundMinor, foundPatch] = found;
  const [minMajor, minMinor, minPatch] = minimum;
  if (foundMajor !== minMajor) return foundMajor > minMajor;
  if (foundMinor !== minMinor) return foundMinor > minMinor;
  return foundPatch >= minPatch;
}

/** `git version 2.43.0` -> `2.43.0`; `null` when the tool does not answer. */
function toolVersion(command: string): string | null {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) return null;
  const first = result.stdout.trim().split("\n")[0] ?? "";
  return first.replace(/^\S+ version /, "").trim();
}

const REQUIRED = {
  node: "install it from https://nodejs.org and open a new terminal",
  git: "install it from https://git-scm.com and open a new terminal",
};

/** Node at the package's minimum, git and optionally gh: what `nf` needs on the machine. */
export function checkTools(options: {
  readonly nodeVersion: string;
  readonly nodeRange: string;
}): Tools {
  const minimum = parseVersion(options.nodeRange);
  if (!meetsMinimum(parseVersion(options.nodeVersion), minimum)) {
    throw new Error(
      `Node ${minimum.join(".")} or newer is required (found ${options.nodeVersion}); ${REQUIRED.node}`,
    );
  }
  const git = toolVersion("git");
  if (git === null) throw new Error(`git is required; ${REQUIRED.git}`);
  return {
    node: { version: options.nodeVersion, required: options.nodeRange },
    git,
    gh: toolVersion("gh"),
  };
}

function capture(options: SetupOptions, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(options.nf.command, [...options.nf.args, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
  });
}

function detail(result: SpawnSyncReturns<string>): string {
  const text = `${result.stdout}${result.stderr}`.trim();
  return text === "" ? `exit code ${String(result.status)}` : text;
}

const Status = Schema.Struct({
  project: Schema.Struct({ name: Schema.String, prefix: Schema.String }),
});
const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(Status));

const Health = Schema.Struct({ app: Schema.String, nfHome: Schema.String });
const decodeHealth = Schema.decodeUnknownOption(Health);

function checkStatus(options: SetupOptions): ProjectRegistration {
  const result = capture(options, ["status", "--json"]);
  if (result.status !== 0) {
    if (UNREGISTERED.test(`${result.stdout}${result.stderr}`)) return { state: "unregistered" };
    throw new Error(`nf status failed: ${detail(result)}`);
  }
  const summary = decodeStatus(result.stdout);
  if (Option.isNone(summary)) {
    throw new Error(`nf status --json printed no JSON: ${result.stdout.trim()}`);
  }
  return {
    state: "registered",
    note: `${summary.value.project.name} [${summary.value.project.prefix}]`,
  };
}

function checkPolicy(options: SetupOptions): PolicyAvailability {
  if (!existsSync(join(options.home, "policy.yaml"))) return { state: "missing" };
  const result = capture(options, ["policy", "status"]);
  if (result.status === 0) return { state: "ok", note: result.stdout.trim() };
  if (result.status === 3) return { state: "stale", note: result.stdout.trim() };
  throw new Error(`nf policy status failed: ${detail(result)}`);
}

function readHealth(origin: string, home: string): Promise<number> {
  return fetch(new URL("/api/health", origin), { signal: AbortSignal.timeout(5_000) }).then(
    async (response) => {
      if (!response.ok) throw new Error(`/api/health answered ${response.status}`);
      const health = decodeHealth(await response.json());
      if (Option.isNone(health) || health.value.app !== "nf") {
        throw new Error("/api/health did not answer for nf");
      }
      if (resolve(health.value.nfHome) !== resolve(home)) {
        throw new Error(
          `/api/health serves NF_HOME ${health.value.nfHome}, expected ${resolve(home)}`,
        );
      }
      return Number(new URL(origin).port);
    },
  );
}

function checkServe(options: SetupOptions): Promise<number> {
  return new Promise((resume, reject) => {
    const child = spawn(options.nf.command, [...options.nf.args, "serve", "--port", "0"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let served: number | null = null;
    let done = false;
    const settle = (outcome: { readonly port: number } | { readonly error: Error }) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if ("error" in outcome) child.kill();
      child.stdout.destroy();
      child.stderr.destroy();
      if ("error" in outcome) reject(outcome.error);
      else resume(outcome.port);
    };
    const deadline = setTimeout(
      () => settle({ error: new Error(`nf serve did not answer within ${HEALTH_TIMEOUT_MS}ms`) }),
      HEALTH_TIMEOUT_MS,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const match = SERVE_READY.exec(output);
      if (match === null || served !== null) return;
      readHealth(match[1] ?? "", options.home).then(
        (port) => {
          served = port;
          child.kill();
          settle({ port });
        },
        (error: Error) => settle({ error }),
      );
    });
    child.on("error", (error) => settle({ error }));
    child.on("exit", (code) => {
      if (served !== null) return settle({ port: served });
      settle({ error: new Error(`nf serve exited with code ${String(code)}\n${output.trim()}`) });
    });
  });
}

/** Run `nf --version`, `nf status`, `nf policy status` and a temporary `nf serve` on a free port. */
export async function runSetupChecks(options: SetupOptions): Promise<SetupChecks> {
  const versionResult = capture(options, ["--version"]);
  if (versionResult.status !== 0) throw new Error(`nf --version failed: ${detail(versionResult)}`);
  return {
    version: versionResult.stdout.trim().replace(/^nf /, ""),
    status: checkStatus(options),
    policy: checkPolicy(options),
    port: await checkServe(options),
  };
}
