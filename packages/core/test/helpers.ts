import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as SqlClient from "effect/sql/SqlClient";
import { PRICE_SOURCE } from "@nf/contracts";
import { NfError, TaskStore, errorText, storeLayer } from "../src/index.ts";
import type {
  AddTaskInput,
  ModelRates,
  ModelTraits,
  PriceFile,
  PricedRates,
  StartAttemptInput,
  StoreError,
  StoreLayerOptions,
  Task,
} from "../src/index.ts";

const cleanups: (() => unknown)[] = [];

/** Run all registered cleanups (call from afterEach). */
export async function cleanupAll(): Promise<void> {
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()?.();
    } catch {
      // best effort on Windows file locks
    }
  }
}

export function tempDir(prefix = "nf-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

const FAKE_GH_SCRIPT = `
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const log = process.env["NF_FAKE_GH_LOG"];
if (log !== undefined) {
  appendFileSync(log, JSON.stringify({ args, token: process.env["GH_TOKEN"] ?? null }) + "\\n");
}
const config = JSON.parse(readFileSync(process.env["NF_FAKE_GH_CONFIG"] ?? "", "utf8"));

if (args[0] === "--version") {
  process.stdout.write("gh version 2.92.0\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "token") {
  const token = config.tokens?.[args[3]];
  if (token === undefined) process.exit(1);
  process.stdout.write(token + "\\n");
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "view") {
  if (config.view === undefined) process.exit(1);
  process.stdout.write(JSON.stringify(config.view));
  process.exit(0);
}
if (args[0] === "pr" && args[1] === "list") {
  if (config.list === undefined) process.exit(1);
  process.stdout.write(JSON.stringify(config.list));
  process.exit(0);
}
process.exit(1);
`;

export interface FakeGhCall {
  readonly args: readonly string[];
  readonly token: string | null;
}

export interface FakeGhConfig {
  readonly tokens?: Record<string, string>;
  readonly view?: unknown;
  readonly list?: readonly unknown[];
}

export interface FakeGh {
  readonly command: readonly string[];
  configure(config: FakeGhConfig): void;
  calls(): readonly FakeGhCall[];
}

/** A `gh` script that answers from a config file and records how each call was authenticated. */
export function fakeGh(): FakeGh {
  const dir = tempDir("nf-fake-gh-");
  const script = join(dir, "gh.mjs");
  const configPath = join(dir, "config.json");
  const logPath = join(dir, "calls.jsonl");
  writeFileSync(script, FAKE_GH_SCRIPT, "utf8");
  process.env["NF_FAKE_GH_CONFIG"] = configPath;
  process.env["NF_FAKE_GH_LOG"] = logPath;
  const configure = (config: FakeGhConfig): void => {
    writeFileSync(configPath, JSON.stringify(config), "utf8");
  };
  configure({});
  return {
    command: [process.execPath, script],
    configure,
    calls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as FakeGhCall)
        : [],
  };
}

/** Traits table without entries, for tests that only exercise the price chain. */
export const EMPTY_TRAITS: ModelTraits = { version: 1, profiles: [], limit: 6, models: [] };

/** LiteLLM rates in the unit a price file reports: USD per token. */
export function litellmRates(input: number, output: number): PricedRates {
  return { input, output, cache_read: null, cache_write: null, source: PRICE_SOURCE.LITELLM };
}

/** A price file over one LiteLLM-style lookup, for workflows that take prices as input. */
export function pricesOf(
  rates: (model: string) => ModelRates | null,
  date = "2026-01-01",
): PriceFile {
  return {
    date,
    warnings: [],
    sources: [{ source: PRICE_SOURCE.LITELLM, date }],
    rates: (model) => {
      const found = rates(model);
      return found === null ? null : { ...found, source: PRICE_SOURCE.LITELLM };
    },
  };
}

type Services = TaskStore | SqlClient.SqlClient;
type StoreApi = TaskStore["Service"];

/** The TaskStore with every operation run to a Promise (rejecting with its NfError). */
export type StoreFacade = {
  [K in keyof StoreApi]: StoreApi[K] extends (
    ...args: infer A
  ) => Effect.Effect<infer R, infer _E, infer _R>
    ? (...args: A) => Promise<R>
    : StoreApi[K];
};

export interface OpenStore {
  store: StoreFacade;
  /** Run an Effect against this store (TaskStore + SqlClient). */
  run<A, E>(effect: Effect.Effect<A, E, Services>): Promise<A>;
  /** Run raw SQL against the store; a failing statement rejects with the driver's message. */
  sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** Open (creating and migrating) the store of `home`; the runtime is disposed by `close`. */
export async function openStore(home: string, options: StoreLayerOptions = {}): Promise<OpenStore> {
  const runtime = ManagedRuntime.make(storeLayer(home, options));
  const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runtime.runPromise(effect);
  let service: TaskStore["Service"];
  try {
    service = await run(Effect.service(TaskStore));
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  const store = new Proxy(service, {
    get(target, prop: string) {
      const value = target[prop as keyof StoreApi];
      if (typeof value !== "function" || prop === "transaction") return value;
      return (...args: unknown[]) =>
        run((value as (...a: unknown[]) => Effect.Effect<unknown, StoreError>)(...args));
    },
  }) as unknown as StoreFacade;
  const sql = <T>(query: string, ...params: unknown[]) =>
    run(
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient;
        return yield* client.unsafe(query, params);
      }).pipe(Effect.mapError((e) => new NfError({ code: "store_error", message: errorText(e) }))),
    ) as Promise<T[]>;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await runtime.dispose();
  };
  return { store, run, sql, close };
}

/** The rejection of `promise` (fails the test if it resolves). */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(outcome instanceof Error)) throw new Error("expected a rejection");
  return outcome;
}

export interface Fixture extends OpenStore {
  home: string;
  projectId: string;
  root: string;
}

/** A store in a temp NF_HOME with one registered project. */
export async function fixture(name = "demo"): Promise<Fixture> {
  const home = tempDir("nf-home-");
  const root = tempDir("nf-proj-");
  const opened = await openStore(home);
  cleanups.push(() => opened.close());
  const { project } = await opened.store.registerProject({
    name,
    prefix: "T",
    rootPath: root,
    remoteUrl: "https://example.test/demo.git",
  });
  return { ...opened, home, projectId: project.id, root };
}

export function addTask(f: Fixture, over: Partial<AddTaskInput> = {}): Promise<Task> {
  return f.store.addTask(f.projectId, {
    title: "A task",
    goal: "Something observable",
    acceptance: ["it works"],
    ...over,
  });
}

export function startImpl(f: Fixture, taskKey: string, over: Partial<StartAttemptInput> = {}) {
  return f.store.startAttempt(f.projectId, taskKey, {
    kind: "implementation",
    mechanism: "delegate_task",
    provider: "codex",
    model: "gpt-x",
    profile: "bounded",
    reason: "test",
    ...over,
  });
}

/** Mark every acceptance item of a task as passing. */
export async function passAll(f: Fixture, taskKey: string): Promise<void> {
  const t = await f.store.getTask(f.projectId, taskKey);
  for (const a of t.acceptance)
    await f.store.checkItem(f.projectId, taskKey, a.position, "pass", "ok");
}
