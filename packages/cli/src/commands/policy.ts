import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  LOCAL_ENVIRONMENT,
  NfError,
  applyPolicy,
  checkPolicy,
  defaultSkillsDir,
  ensurePolicyFile,
  initPolicy,
  loadPolicy,
  parseRouteRef,
  policyStatus,
  proposalFile,
  proposePolicy,
  resolveCandidate,
  routeKey,
} from "@nf/core";
import { ExitStatus, UsageError, parse } from "../args.ts";
import { Cli } from "../context.ts";
import { loadCliPrices } from "../prices.ts";
import {
  policyApplyText,
  policyCheckText,
  policyProposalText,
  policyResolveText,
  policyStatusText,
  policyText,
  profileText,
} from "../format.ts";

// The template ships with the skills: beside the bundle in an install, in this checkout otherwise.
const TEMPLATE = join(defaultSkillsDir(), "nf-meta", "references", "policy.example.yaml");

const show = Effect.fn("cli.policy.show")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { profile: { type: "string" } });
  const { file, created } = yield* ensurePolicyFile(cli.home, TEMPLATE);
  const policy = yield* loadPolicy(cli.home);
  const profile = a.str("profile");
  const prefix = created ? `created ${file} from ${TEMPLATE}\n` : "";
  if (profile !== undefined) {
    const entry = policy.profiles[profile];
    if (!entry)
      return yield* new NfError({
        code: "unknown_profile",
        message: `profile '${profile}' is not in ${file} (${Object.keys(policy.profiles).join("|")})`,
      });
    yield* cli.emit(
      { file, created, profile, ...entry },
      () => prefix + profileText(profile, entry),
    );
    return yield* Effect.void;
  }
  return yield* cli.emit({ file, created, policy }, () => prefix + policyText(policy));
});

const readCatalog = Effect.fn("cli.policy.readCatalog")(function* (file: string | undefined) {
  const cli = yield* Cli;
  if (file === undefined) {
    const text = yield* Effect.promise(() => cli.io.readStdin());
    if (text === null)
      return yield* new UsageError({
        message:
          "no catalog to check: pipe the orchestrator_capabilities JSON on stdin or pass --file",
      });
    return { text, source: "stdin" };
  }
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () => new NfError({ code: "bad_catalog", message: `${file} cannot be read` }),
  });
  return { text, source: file };
});

const check = Effect.fn("cli.policy.check")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { file: { type: "string" }, env: { type: "string" } }, 0);
  const { text, source } = yield* readCatalog(a.str("file"));
  const store = yield* cli.store;
  const result = yield* cli.withStore(
    checkPolicy({
      home: cli.home,
      machine: store.machine,
      environment: a.str("env") ?? LOCAL_ENVIRONMENT,
      source,
      text,
      now: new Date(),
    }),
  );
  return yield* cli.emit(result, () => policyCheckText(result));
});

const propose = Effect.fn("cli.policy.propose")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      file: { type: "string" },
      env: { type: "string" },
      reorder: { type: "boolean" },
      init: { type: "boolean" },
    },
    0,
  );
  const { text, source } = yield* readCatalog(a.str("file"));
  const store = yield* cli.store;
  const prices = yield* loadCliPrices(cli.home, cli.env);
  const now = new Date();
  const environment = a.str("env") ?? LOCAL_ENVIRONMENT;
  if (a.bool("init")) {
    const result = yield* cli.withStore(
      initPolicy({
        home: cli.home,
        machine: store.machine,
        environment,
        source,
        text,
        template: TEMPLATE,
        prices,
        now,
      }),
    );
    return yield* cli.emit(result, () => `created ${result.file}\n${policyText(result.policy)}`);
  }
  const result = yield* cli.withStore(
    proposePolicy({
      home: cli.home,
      machine: store.machine,
      environment,
      source,
      text,
      prices,
      now,
      reorder: a.bool("reorder"),
    }),
  );
  return yield* cli.emit({ ...result.proposal, proposal_file: result.file }, () =>
    policyProposalText(result),
  );
});

const applyProposal = Effect.fn("cli.policy.apply")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(argv, { file: { type: "string" } }, 0);
  const file = a.str("file") ?? proposalFile(cli.home);
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: () =>
      new NfError({
        code: "no_proposal",
        message: `${file} not found; run 'nf policy propose' first (or pass --file)`,
      }),
  });
  const result = yield* applyPolicy({
    home: cli.home,
    template: TEMPLATE,
    text,
    source: file,
    now: new Date(),
  });
  return yield* cli.emit(result, () => policyApplyText(result));
});

const status = Effect.fn("cli.policy.status")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const result = yield* cli.withStore(policyStatus({ home: cli.home, now: new Date() }));
  yield* cli.emit(result, () => policyStatusText(result));
  return yield* result.state === "ok" ? Effect.void : new ExitStatus({ code: 3 });
});

const resolve = Effect.fn("cli.policy.resolve")(function* (argv: string[]) {
  const cli = yield* Cli;
  const a = yield* parse(
    argv,
    {
      env: { type: "string" },
      exclude: { type: "string", multiple: true },
      approved: { type: "boolean" },
    },
    1,
  );
  const profile = yield* a.pos(0, "profile");
  const exclude = a.strs("exclude");
  for (const ref of exclude)
    if (!parseRouteRef(ref))
      return yield* new UsageError({ message: `--exclude takes provider:model, got '${ref}'` });
  const prices = yield* loadCliPrices(cli.home, cli.env);
  const result = yield* cli.withStore(
    resolveCandidate({
      home: cli.home,
      profile,
      environment: a.str("env") ?? LOCAL_ENVIRONMENT,
      exclude,
      prices,
      approved: a.bool("approved"),
      now: new Date(),
    }),
  );
  yield* cli.emit(result, () => policyResolveText(result));
  if (result.eligible && result.target) return yield* Effect.void;
  const tried = result.verdicts
    .map((v) => routeKey(v.candidate.provider, v.candidate.model))
    .join(", ");
  return yield* new NfError({
    code: "no_candidate",
    message: `no eligible candidate for profile '${profile}' (tried ${tried})`,
  });
});

export const policy = Effect.fn("cli.policy")(function* (argv: string[]) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "show":
      return yield* show(rest);
    case "check":
      return yield* check(rest);
    case "propose":
      return yield* propose(rest);
    case "apply":
      return yield* applyProposal(rest);
    case "status":
      return yield* status(rest);
    case "resolve":
      return yield* resolve(rest);
    default:
      return yield* new UsageError({
        message: `unknown policy command '${sub ?? ""}' (show|check|propose|apply|status|resolve)`,
      });
  }
});
