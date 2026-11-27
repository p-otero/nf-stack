import { homedir } from "node:os";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { NfError, checkTools, errorText, linkSkills, runSetupChecks } from "@nf/core";
import type {
  LinkResult,
  PolicyAvailability,
  ProjectRegistration,
  SetupChecks,
  Tools,
} from "@nf/core";
import { parse } from "../args.ts";
import { Cli } from "../context.ts";
import { linkResultText } from "../format.ts";
import { manifest, version } from "../version.ts";

const ROW = 12;
const ADVICE = 26;

const row = (label: string, text: string) => `  ${label.padEnd(ROW)}${text}`;

const adviceRow = (command: string, text: string) => `  ${command.padEnd(ADVICE)}${text}`;

const section = (title: string, lines: readonly string[]) => [title, ...lines].join("\n");

/** `nf` as this process was started, so the smoke checks exercise the installed launcher. */
function selfNf(): { command: string; args: string[] } {
  const entry = process.argv[1];
  return entry === undefined
    ? { command: "nf", args: [] }
    : { command: process.execPath, args: [entry] };
}

const failed = (error: unknown) => new NfError({ code: "setup_failed", message: errorText(error) });

const attempt = <A>(run: () => A | Promise<A>) =>
  Effect.tryPromise({ try: async () => run(), catch: failed });

function policyText(policy: PolicyAvailability): string {
  if (policy.state === "ok") return policy.note;
  if (policy.state === "missing") return "no policy.yaml yet: run /nf-autoconfigure in T3";
  return "policy catalog stale: run /nf-autoconfigure in T3";
}

function statusText(status: ProjectRegistration): string {
  return status.state === "registered"
    ? `ok (${status.note})`
    : "this project is not registered yet: run nf init";
}

function toolRows(tools: Tools): readonly string[] {
  return [
    row("node", `${tools.node.version}  (required ${tools.node.required})`),
    row("git", `${tools.git}  (required)`),
    row("gh", `${tools.gh ?? "absent"}  (optional: pull request state on the board)`),
  ];
}

function checkRows(checks: SetupChecks, home: string): readonly string[] {
  return [
    row("version", checks.version),
    row("status", statusText(checks.status)),
    row("policy", policyText(checks.policy)),
    row("store", resolve(home)),
    row("live board", `/api/health ok on port ${String(checks.port)}, server stopped`),
  ];
}

function nextSteps(checks: SetupChecks, skills: readonly LinkResult[]): readonly string[] {
  const advice: string[] = [];
  if (checks.status.state === "unregistered") {
    advice.push(adviceRow("nf init", "register this checkout"));
  }
  if (checks.policy.state !== "ok") {
    advice.push(adviceRow("/nf-autoconfigure", "routing policy for this machine"));
  }
  if (skills.some((result) => result.action === "skipped")) {
    advice.push(adviceRow("nf skills link --force", "replace the skill targets it skipped"));
  }
  return advice;
}

export const setup = Effect.fn("cli.setup")(function* (argv: string[]) {
  const cli = yield* Cli;
  yield* parse(argv, {}, 0);
  const out = (text = "") => Effect.sync(() => cli.io.out(`${text}\n`));

  yield* out(`nf setup  ${version()}`);
  yield* out();

  const tools = yield* attempt(() =>
    checkTools({
      nodeVersion: process.versions.node,
      nodeRange: manifest().engines?.node ?? ">=24",
    }),
  );
  yield* out(section("prerequisites", toolRows(tools)));
  yield* out();

  const skills = yield* attempt(() => linkSkills({ home: homedir() }));
  yield* out(
    section(
      "skills",
      skills.map((result) => `  ${linkResultText(result)}`),
    ),
  );
  yield* out();

  const checks = yield* attempt(() =>
    runSetupChecks({ nf: selfNf(), home: cli.home, cwd: cli.cwd, env: cli.env }),
  );
  yield* out(section("checks", checkRows(checks, cli.home)));
  yield* out();

  const next = nextSteps(checks, skills);
  if (next.length > 0) {
    yield* out(section("next", next));
    yield* out();
  }
  yield* out("nf setup: done");
});
