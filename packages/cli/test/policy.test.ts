import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Policy commands run through the real `nf` under node: no TypeScript build step.
setDefaultTimeout(60_000);

const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const FIXTURES = join(import.meta.dir, "..", "..", "core", "test", "fixtures");
const TEMPLATE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "skills",
  "nf-meta",
  "references",
  "policy.example.yaml",
);
const LOCAL = join(FIXTURES, "t3-capabilities-local.json");
const VPS = join(FIXTURES, "t3-capabilities-vps.json");
const FRONTIER = join(FIXTURES, "t3-capabilities-frontier.json");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0)
    rmSync(dirs.pop() as string, { recursive: true, force: true, maxRetries: 5 });
});

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
  /** Parsed stdout; each test narrows it to the shape its command writes. */
  json: () => any;
}

/** Tests never read the machine's rates or reach OpenRouter: a fixture file and offline. */
function runner(home: string, cwd: string, extraEnv: Record<string, string> = {}) {
  return (args: string[], input?: string): Run => {
    const r = spawnSync(NODE, [BIN, ...args], {
      cwd,
      ...(input === undefined ? {} : { input }),
      encoding: "utf8",
      env: {
        ...process.env,
        NF_HOME: home,
        NF_PRICES: join(home, "no-rates.json"),
        NF_OFFLINE: "1",
        ...extraEnv,
      },
    });
    return {
      code: r.status ?? -1,
      out: r.stdout,
      err: r.stderr,
      json: () => JSON.parse(r.stdout),
    };
  };
}

describe("nf policy under node", () => {
  test("show creates the machine policy from the repo template and validates it", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    const first = nf(["policy", "show"]);
    expect(first.code).toBe(0);
    expect(first.err).toBe("");
    expect(first.out.split("\n")[0]).toContain("created ");
    expect(first.out).toContain(TEMPLATE);
    expect(existsSync(join(home, "policy.yaml"))).toBe(true);
    expect(readFileSync(join(home, "policy.yaml"), "utf8")).toBe(readFileSync(TEMPLATE, "utf8"));
    expect(first.out).toContain("policy v1 · analysis review · 5 profiles · 0 disabled");
    expect(first.out).toContain(
      "bounded: pi opencode-go/deepseek-v4.1-flash (thinking=max) → pi opencode-go/glm-5.3-flash (thinking=max)",
    );
    expect(first.out).toContain(" · max output $15/M");
    expect(first.out).toContain(
      "frontier: claudeAgent claude-fable-5-2 (effort=max) → pi openai-codex/gpt-6-astra (thinking=high) · models: claude-fable-5-2, gpt-6-astra · needs approval",
    );

    const second = nf(["policy", "show"]);
    expect(second.code).toBe(0);
    expect(second.out).not.toContain("created ");
    const profile = nf(["policy", "show", "--profile", "lookup"]);
    expect(profile.out.trim()).toBe(
      "lookup: pi openai-codex/gpt-6-luna (thinking=medium) → pi opencode-go/deepseek-v4.1-flash (thinking=max) · max output $15/M",
    );
    const json = nf(["policy", "show", "--json"]).json();
    expect(json.created).toBe(false);
    expect(Object.keys(json.policy.profiles)).toEqual([
      "bounded",
      "reasoning",
      "lookup",
      "review",
      "frontier",
    ]);
    expect(json.policy.profiles.frontier.requires_approval).toBe(true);
    expect(nf(["policy", "show", "--profile", "nope"]).code).toBe(1);
  });

  test("show reports every offending path of an invalid policy", () => {
    const home = tmp("nf-policy-bad-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    writeFileSync(
      join(home, "policy.yaml"),
      readFileSync(TEMPLATE, "utf8")
        .replace("version: 1", "version: 2")
        .replace("disabled: []", 'disabled: [ "glm" ]'),
    );
    const r = nf(["policy", "show"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("invalid policy");
    expect(r.err).toContain("version: Expected 1");
  });

  test("check merges stdin and file payloads per environment", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);

    const local = nf(["policy", "check"], readFileSync(LOCAL, "utf8"));
    expect(local.code).toBe(0);
    expect(local.err).toBe("");
    expect(local.out).toBe(
      [
        "pi:openai-codex/gpt-6.1-sol  missing everywhere",
        "claudeAgent:claude-fable-5-2  missing everywhere",
        "pi:openai-codex/gpt-6-astra  missing everywhere",
        "catalog: local · 3 missing · 0 only elsewhere",
        "",
      ].join("\n"),
    );

    const vps = nf(["policy", "check", "--env", "vps", "--file", VPS]);
    expect(vps.code).toBe(0);
    expect(vps.out).toBe(
      [
        "claudeAgent:claude-fable-5-2  missing everywhere",
        "pi:openai-codex/gpt-6-astra  missing everywhere",
        "pi:openai-codex/gpt-6.1-sol  only in vps",
        "catalog: local, vps · 2 missing · 1 only elsewhere",
        "",
      ].join("\n"),
    );

    const json = nf(["policy", "check", "--file", LOCAL, "--json"]).json();
    expect(json.environment).toBe("local");
    expect(json.drift.missing).toEqual([
      expect.objectContaining({ model: "claude-fable-5-2" }),
      expect.objectContaining({ model: "openai-codex/gpt-6-astra" }),
    ]);
    expect(json.drift.elsewhere[0].route.model).toBe("openai-codex/gpt-6.1-sol");
    expect(json.environments).toEqual(["local", "vps"]);

    const bad = nf(["policy", "check"], "not json");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("not valid JSON");
    expect(nf(["policy", "check", "--file", join(home, "nope.json")]).code).toBe(1);
  });

  test("status is one line and branches on freshness", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);

    const never = nf(["policy", "status"]);
    expect(never.code).toBe(3);
    expect(never.out).toBe(
      "catalog never checked — run orchestrator_capabilities and pipe it to nf policy check\n",
    );

    expect(nf(["policy", "check", "--file", LOCAL]).code).toBe(0);
    const fresh = nf(["policy", "status"]);
    expect(fresh.code).toBe(0);
    expect(fresh.out).toBe("policy ok · catalog checked just now (local) · 3 missing\n");
    expect(fresh.out.trim().split("\n").length).toBe(1);
    expect(nf(["policy", "status", "--json"]).json().state).toBe("ok");

    const db = new DatabaseSync(join(home, "nf.db"));
    try {
      db.exec("UPDATE catalog_snapshots SET checked_at = '2020-01-01T00:00:00.000Z'");
    } finally {
      db.close();
    }
    const stale = nf(["policy", "status"]);
    expect(stale.code).toBe(3);
    expect(stale.out).toBe(
      "catalog stale (>24h) — run orchestrator_capabilities and pipe it to nf policy check\n",
    );
  });

  test("resolve returns the first eligible candidate and its delegate_target target", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);
    expect(nf(["policy", "check", "--file", LOCAL]).code).toBe(0);

    const bounded = nf(["policy", "resolve", "bounded"]);
    expect(bounded.code).toBe(0);
    expect(bounded.out).toBe(
      'bounded · pi opencode-go/deepseek-v4.1-flash · options {"thinking":"max"}\n',
    );
    const json = nf(["policy", "resolve", "bounded", "--json"]).json();
    expect(json.target).toEqual({
      providerInstanceId: "pi",
      model: "opencode-go/deepseek-v4.1-flash",
      options: [{ id: "thinking", value: "max" }],
    });

    const reasoning = nf(["policy", "resolve", "reasoning"]);
    expect(reasoning.out).toBe('reasoning · pi zai/glm-5.3 · options {"thinking":"high"}\n');

    expect(nf(["policy", "check", "--env", "vps", "--file", VPS]).code).toBe(0);
    const linked = nf(["policy", "resolve", "reasoning", "--env", "vps", "--json"]).json();
    expect(linked.target).toEqual({
      providerInstanceId: "pi",
      model: "openai-codex/gpt-6.1-sol",
      options: [{ id: "thinking", value: "medium" }],
      environmentId: "vps",
    });

    expect(nf(["policy", "resolve", "nope"]).code).toBe(1);
    expect(nf(["policy", "resolve", "bounded", "--exclude", "nope"]).code).toBe(2);
  });

  test("resolve skips blocked routes and explains every candidate when none is left", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);
    expect(nf(["policy", "check", "--file", LOCAL]).code).toBe(0);

    const first = nf([
      "route",
      "block",
      "--provider",
      "pi",
      "--model",
      "opencode-go/deepseek-v4.1-flash",
      "--reason",
      "quota",
      "--reset-at",
      "2999-01-01T00:00:00Z",
      "--evidence",
      "usage limit",
    ]);
    expect(first.code).toBe(0);
    expect(first.out).toBe(
      "blocked pi:opencode-go/deepseek-v4.1-flash · quota · until 2999-01-01T00:00:00Z · usage limit\n",
    );

    const next = nf(["policy", "resolve", "bounded"]);
    expect(next.code).toBe(0);
    expect(next.out).toBe('bounded · pi opencode-go/glm-5.3-flash · options {"thinking":"max"}\n');

    const exclude = nf([
      "policy",
      "resolve",
      "bounded",
      "--exclude",
      "pi:opencode-go/glm-5.3-flash",
      "--exclude",
      "pi:openai-codex/gpt-6-luna",
    ]);
    expect(exclude.out).toContain("claudeAgent claude-sonnet-5-5");

    const list = nf(["route", "list"]);
    expect(list.out).toMatch(
      /^pi:opencode-go\/deepseek-v4\.1-flash  quota  blocked just now  until 2999-01-01T00:00:00Z\n$/,
    );
    const listJson = nf(["route", "list", "--json"]).json();
    expect(listJson[0]).toMatchObject({ reason: "quota", reset_at: "2999-01-01T00:00:00Z" });

    const unblock = nf([
      "route",
      "unblock",
      "--provider",
      "pi",
      "--model",
      "opencode-go/deepseek-v4.1-flash",
    ]);
    expect(unblock.out).toBe("unblocked pi:opencode-go/deepseek-v4.1-flash\n");
    expect(nf(["route", "list"]).out).toBe("no route blocks\n");

    expect(
      nf(["route", "block", "--provider", "pi", "--model", "zai/glm-5.3", "--reason", "nope"]).code,
    ).toBe(1);
    expect(
      nf([
        "route",
        "block",
        "--provider",
        "pi",
        "--model",
        "zai/glm-5.3",
        "--reason",
        "auth",
        "--reset-at",
        "tomorrow",
      ]).code,
    ).toBe(2);
    expect(nf(["route", "unblock"]).code).toBe(2);
  });

  test("propose prints a diff with each price's source, saves the proposal and apply writes it", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"), { NF_PRICES: join(home, "prices.json") });
    writeFileSync(
      join(home, "prices.json"),
      JSON.stringify({
        fetchedAtMs: 1763200000000,
        document: { "gpt-6.1-sol": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 } },
      }),
    );
    writeFileSync(
      join(home, "openrouter-models.json"),
      JSON.stringify({
        fetched_at: new Date().toISOString(),
        models: { "deepseek/deepseek-v4.1-flash": { input: 1.4e-7, output: 4.2e-7 } },
      }),
    );

    const proposal = nf(["policy", "propose", "--file", FRONTIER]);
    expect(proposal.code).toBe(0);
    expect(proposal.err).toBe("");
    expect(proposal.out).toContain("policy proposal ·");
    expect(proposal.out).toContain("bounded · create");
    expect(proposal.out).toContain("+ pi opencode-go/deepseek-v4.1-flash (thinking=max)  rank 1");
    expect(proposal.out).toContain("$0.14/$0.42 per M (openrouter)");
    expect(proposal.out).toContain("$2/$10 per M (litellm)");
    expect(proposal.out).toContain("review the diff, then run nf policy apply");
    expect(existsSync(join(home, "policy.yaml"))).toBe(false);
    expect(existsSync(join(home, "policy.proposal.json"))).toBe(true);

    const json = nf(["policy", "propose", "--file", FRONTIER, "--json"]).json();
    expect(json.policy_hash).toBeNull();
    expect(json.proposal_file).toBe(join(home, "policy.proposal.json"));
    expect(json.profiles.map((p: { name: string }) => p.name)).toEqual([
      "bounded",
      "reasoning",
      "lookup",
      "review",
      "frontier",
    ]);

    const applied = nf(["policy", "apply"]);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain(`applied ${join(home, "policy.yaml")} · 5 profiles · 0 disabled`);
    expect(nf(["policy", "show"]).code).toBe(0);
    const resolved = nf(["policy", "resolve", "bounded"]).out.trimEnd();
    expect(resolved.startsWith("bounded · pi opencode-go/deepseek-v4.1-flash · options")).toBe(
      true,
    );
    expect(resolved).toContain("· $0.14/$0.42 per M (openrouter)");

    const stale = nf(["policy", "apply"]);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("changed since the proposal was made");

    const settled = nf(["policy", "propose", "--file", FRONTIER]);
    expect(settled.code).toBe(0);
    expect(settled.out).toContain("no changes");
    expect(settled.out).toContain("nothing to apply");
  });

  test("resolve refuses a profile that needs the user's approval until --approved", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);
    expect(nf(["policy", "check", "--file", LOCAL]).code).toBe(0);
    writeFileSync(
      join(home, "policy.yaml"),
      `version: 1
analysis_mode: review
profiles:
  frontier:
    requires_approval: true
    models: [ claude-opus-5-5 ]
    candidates:
      - { provider: claudeAgent, model: claude-opus-5-5, options: { effort: high } }
disabled: []
context_transfer: { default: fresh, never_reuse_for: [ review ] }
recovery: { pi_usage_limit_with_reset: schedule_task, max_repair_cycles: 2, reasoning_escalations: 1 }
`,
    );

    const denied = nf(["policy", "resolve", "frontier"]);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("profile 'frontier' needs the user's approval");
    expect(denied.err).toContain("nf policy resolve frontier --approved");

    const approved = nf(["policy", "resolve", "frontier", "--approved"]);
    expect(approved.code).toBe(0);
    expect(approved.out).toBe(
      'frontier · claudeAgent claude-opus-5-5 · options {"effort":"high"}\n',
    );
    expect(nf(["policy", "resolve", "frontier", "--approved", "--json"]).json().profile).toBe(
      "frontier",
    );
  });

  test("apply explains how to create a missing proposal", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    const r = nf(["policy", "apply"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("policy.proposal.json not found");
    expect(r.err).toContain("nf policy propose");
    expect(nf(["policy", "propose"]).code).toBe(1);
  });

  test("resolve without any eligible candidate exits non-zero with a reason per candidate", () => {
    const home = tmp("nf-policy-home-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    expect(nf(["policy", "show"]).code).toBe(0);
    expect(nf(["policy", "check", "--file", LOCAL]).code).toBe(0);
    for (const model of [
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/glm-5.3-flash",
      "openai-codex/gpt-6-luna",
    ])
      expect(
        nf(["route", "block", "--provider", "pi", "--model", model, "--reason", "quota"]).code,
      ).toBe(0);
    const r = nf(["policy", "resolve", "lookup"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no eligible candidate for profile 'lookup'");
    expect(r.out).toContain("pi:openai-codex/gpt-6-luna  route blocked (quota, no reset)");
    expect(r.out).toContain("pi:opencode-go/deepseek-v4.1-flash  route blocked (quota, no reset)");

    const all = nf(["route", "unblock", "--all"]);
    expect(all.out.split("\n").filter(Boolean).length).toBe(3);
  });
});

describe("nf policy propose --init", () => {
  test("writes the policy from the catalog, then refuses to do it twice", () => {
    const home = tmp("nf-policy-init-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    const file = join(home, "policy.yaml");

    const init = nf(["policy", "propose", "--init", "--file", FRONTIER]);
    expect(init.code).toBe(0);
    expect(init.err).toBe("");
    expect(init.out).toContain(`created ${file}`);
    expect(init.out).toContain("policy v1 · analysis review · 5 profiles");
    expect(init.out).toContain(
      "frontier: claudeAgent claude-fable-5-2 (effort=max) → pi openai-codex/gpt-6-astra (thinking=high) → codex gpt-6-astra (reasoningEffort=high) · models: claude-fable-5-2, gpt-6-astra · needs approval",
    );
    expect(readFileSync(file, "utf8")).toContain("max_output_per_m: 15");
    expect(existsSync(join(home, "policy.proposal.json"))).toBe(false);
    expect(nf(["policy", "show", "--profile", "bounded"]).out).toContain(
      "bounded: pi opencode-go/deepseek-v4.1-flash (thinking=max)",
    );

    const again = nf(["policy", "propose", "--init", "--file", FRONTIER]);
    expect(again.code).toBe(1);
    expect(again.out).toBe("");
    expect(again.err).toContain("already exists");
    expect(again.err).toContain("nf policy propose");
  });
});

describe("nf policy propose removals", () => {
  test("a candidate whose provider instance is gone is printed as a removal and dropped", () => {
    const home = tmp("nf-policy-remove-");
    const nf = runner(home, tmp("nf-policy-cwd-"));
    const file = join(home, "policy.yaml");
    writeFileSync(
      file,
      readFileSync(TEMPLATE, "utf8")
        .replace(
          "      - { provider: claudeAgent, model: claude-sonnet-5-5, options: { effort: high } }\n",
          "      - { provider: claudeAgent, model: claude-sonnet-5-5, options: { effort: high } }\n      - { provider: ghost, model: retired/model-x }\n",
        )
        .replace(
          "      - { provider: pi, model: zai/glm-5.3, options: { thinking: high } }\n",
          "      - { provider: pi, model: zai/glm-5.3, options: { thinking: high } }\n      - { provider: ghost, model: retired/model-y, pinned: true }\n",
        ),
    );
    expect(nf(["policy", "show"]).code).toBe(0);

    const proposal = nf(["policy", "propose", "--file", LOCAL]);
    expect(proposal.code).toBe(0);
    expect(proposal.out).toContain(
      "- ghost retired/model-x  provider 'ghost' not in local catalog",
    );
    expect(proposal.out).toContain("1 remove");
    expect(proposal.out).toContain("= ghost retired/model-y  pinned");
    expect(proposal.out).toContain("broken: provider 'ghost' not in local catalog");

    expect(nf(["policy", "apply"]).code).toBe(0);
    const applied = readFileSync(file, "utf8");
    expect(applied).not.toContain("retired/model-x");
    expect(applied).toContain("model: retired/model-y, pinned: true");
    expect(applied).not.toContain("ghost:");
  });
});
