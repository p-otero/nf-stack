import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import { NfError, TaskStore, backupKeep, gitInfo, nfHome, storeLayer } from "@nf/core";
import type { Project, StoreError } from "@nf/core";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** Whole stdin as text; null when stdin is an interactive terminal. */
  readStdin(): Promise<string | null>;
}

export interface Globals {
  json: boolean;
  project: string | undefined;
}

/** Pick --json and --project out of a command line without knowing the command. */
export function scanGlobals(argv: string[]): Globals {
  let project: string | undefined;
  for (const [i, a] of argv.entries()) {
    if (a === "--project") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) project = next;
    } else if (a.startsWith("--project=")) project = a.slice("--project=".length);
  }
  return { json: argv.includes("--json"), project };
}

type StoreServices = TaskStore | SqlClient.SqlClient;

/** One CLI invocation: its I/O, environment, the lazily opened store and the current project. */
export class Cli extends Context.Service<
  Cli,
  {
    readonly io: Io;
    readonly env: Record<string, string | undefined>;
    readonly cwd: string;
    readonly json: boolean;
    readonly home: string;
    /** The store, opened (and migrated) on first use and closed when the command ends. */
    readonly store: Effect.Effect<TaskStore["Service"], StoreError>;
    /** Run a core workflow against the store. */
    readonly withStore: <A, E>(
      effect: Effect.Effect<A, E, StoreServices>,
    ) => Effect.Effect<A, E | StoreError>;
    /** Project from --project / NF_PROJECT, else from the Git checkout containing cwd. */
    readonly project: Effect.Effect<Project, StoreError>;
    readonly print: (text: string) => Effect.Effect<void>;
    /** Print `data` as one JSON line in --json mode, otherwise the human text. */
    readonly emit: (data: unknown, human: () => string) => Effect.Effect<void>;
  }
>()("nf/cli/Cli") {}

const make = Effect.fn("Cli.make")(function* (options: {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string;
  readonly globals: Globals;
}) {
  const { io, env, cwd, globals } = options;
  const home = nfHome(env);
  const scope = yield* Effect.acquireRelease(Scope.make(), (s, exit) => Scope.close(s, exit));
  const services = yield* Effect.cached(
    Layer.buildWithScope(
      storeLayer(home, { backupKeep: backupKeep(env), notice: (text) => io.err(text) }),
      scope,
    ),
  );
  const withStore = <A, E>(effect: Effect.Effect<A, E, StoreServices>) =>
    Effect.flatMap(services, (context) => Effect.provide(effect, context));
  const store = withStore(Effect.service(TaskStore));

  const resolve = Effect.fn("Cli.resolveProject")(function* () {
    const s = yield* store;
    const ref = globals.project ?? env["NF_PROJECT"];
    if (ref) return yield* s.resolveProject(ref);
    const git = yield* Effect.sync(() => gitInfo(cwd));
    if (git) {
      const byPath = yield* s.findProjectByPath(git.root);
      if (byPath) return byPath;
      if (git.remoteUrl) {
        const byRemote = (yield* s.listProjects()).filter((p) => p.remote_url === git.remoteUrl);
        const only = byRemote.length === 1 ? byRemote[0] : undefined;
        if (only !== undefined) return only;
      }
      return yield* new NfError({
        code: "no_project",
        message: `${git.root} is not registered; run 'nf init' there (or pass --project)`,
      });
    }
    const byCwd = yield* s.findProjectByPath(cwd);
    if (byCwd) return byCwd;
    return yield* new NfError({
      code: "no_project",
      message: "not inside a registered Git project; run 'nf init' in the repo or pass --project",
    });
  });
  const project = yield* Effect.cached(resolve());

  const print = (text: string) => Effect.sync(() => io.out(text + "\n"));
  return Cli.of({
    io,
    env,
    cwd,
    json: globals.json,
    home,
    store,
    withStore,
    project,
    print,
    emit: (data, human) => print(globals.json ? JSON.stringify(data) : human()),
  });
});

export const layer = (options: Parameters<typeof make>[0]) => Layer.effect(Cli, make(options));
