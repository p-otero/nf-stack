// Generates packages/core/test/fixtures/nf-v2.db and golden CLI outputs with the CURRENT nf.
// usage: node gen-v2.mjs <repo checkout> <out dir>
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [repoDir, outDir] = process.argv.slice(2);
const BIN = join(repoDir, "packages", "cli", "bin", "nf.js");
const V1 = join(repoDir, "packages", "core", "test", "fixtures", "tasks-v1.json");
const work = mkdtempSync(join(tmpdir(), "nf-gen-v2-"));
const home = join(work, "home");
const proj = join(work, "demo");
mkdirSync(proj);
execFileSync("git", ["init", "-q"], { cwd: proj });
execFileSync("git", ["remote", "add", "origin", "https://example.test/demo.git"], { cwd: proj });

const data = join(work, "data");
const t3 = join(data, "statev2.sqlite");
const piDir = join(data, "sessions", "proj");
const prices = join(data, "usage-model-rates.json");
mkdirSync(piDir, { recursive: true });

const env = {
  ...process.env,
  NF_HOME: home,
  NF_T3_STATE: t3,
  NF_PI_SESSIONS: join(data, "sessions"),
  NF_PRICES: prices,
};
function nf(args, input, cwd = proj, e = env) {
  const r = spawnSync("node", [BIN, ...args], { cwd, input, encoding: "utf8", env: e });
  if (r.status !== 0) throw new Error(`nf ${args.join(" ")} -> ${r.status}: ${r.stderr}`);
  return r.stdout;
}

nf(["init", "--name", "demo", "--coordinator-thread-id", "thread-coord"]);
nf(["import", V1]);
nf([
  "task",
  "add",
  "--title",
  "Usage attribution",
  "--goal",
  "attribute tokens",
  "--acceptance",
  "works",
  "--acceptance",
  "is cheap",
  "--profile",
  "bounded",
]);
nf([
  "task",
  "add",
  "--title",
  "Proposed follow-up",
  "--goal",
  "later",
  "--acceptance",
  "x",
  "--status",
  "proposed",
  "--depends-on",
  "T-004",
]);
nf(["task", "set", "T-004", "--status", "working", "--reason", "dispatched"]);
const key = nf([
  "attempt",
  "start",
  "T-004",
  "--kind",
  "implementation",
  "--mechanism",
  "delegate_task",
  "--provider",
  "claudeAgent",
  "--model",
  "claude-test",
  "--options",
  '{"effort":"high"}',
  "--reason",
  "fixture",
]).trim();
nf([
  "attempt",
  "update",
  key,
  "--status",
  "active",
  "--thread-id",
  "thread-a",
  "--add-commit",
  "abc",
  "--add-check",
  '{"command":"bun test","result":"pass"}',
  "--add-fallback",
  '{"route":"x","failure":"quota"}',
]);
nf(["attempt", "report", key, "--kind", "checkpoint"], "step 1\nnext\n");

// T3 + Pi sources covering a priced turn, an otherUsage aggregate, an unknown model and Pi.
const db = new DatabaseSync(t3);
db.exec(`
  CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT NOT NULL, provider_instance_id TEXT, updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL);
  CREATE TABLE orchestration_v2_projection_provider_turns (provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, provider_thread_id TEXT NOT NULL, run_attempt_id TEXT, ordinal INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT, payload_json TEXT NOT NULL);
  CREATE TABLE orchestration_v2_projection_subagents (subagent_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, parent_node_id TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, provider_thread_id TEXT, child_thread_id TEXT, origin TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE orchestration_v2_projection_run_attempts (attempt_id TEXT PRIMARY KEY, run_id TEXT);
`);
const now = new Date();
const iso = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();
const th = db.prepare(
  "INSERT INTO orchestration_v2_projection_provider_threads (provider_thread_id, thread_id, provider, payload_json) VALUES (?,?,?,?)",
);
th.run(
  "pt-a",
  "thread-a",
  "claudeAgent",
  JSON.stringify({ nativeThreadRef: { nativeId: "uuid-a" } }),
);
th.run(
  "pt-c",
  "thread-coord",
  "claudeAgent",
  JSON.stringify({ nativeThreadRef: { nativeId: "uuid-c" } }),
);
const tu = db.prepare(
  "INSERT INTO orchestration_v2_projection_provider_turns (provider_turn_id, thread_id, provider_thread_id, started_at, completed_at, payload_json) VALUES (?,?,?,?,?,?)",
);
const usage = (over = {}) => ({
  inputTokens: 1000,
  outputTokens: 100,
  cachedInputTokens: 200,
  cacheCreationTokens: 50,
  reasoningTokens: 10,
  usageStatus: "complete",
  models: ["claude-test"],
  otherUsage: { inputTokens: 0, outputTokens: 0 },
  ...over,
});
tu.run(
  "turn-1",
  "thread-a",
  "pt-a",
  iso(1),
  iso(2),
  JSON.stringify({
    model: "claude-test",
    turnTokenUsage: usage({ otherUsage: { inputTokens: 500, outputTokens: 20 } }),
  }),
);
tu.run(
  "turn-2",
  "thread-a",
  "pt-a",
  iso(2),
  iso(3),
  JSON.stringify({ model: "mystery", turnTokenUsage: usage({ models: ["mystery"] }) }),
);
tu.run(
  "turn-3",
  "thread-coord",
  "pt-c",
  iso(1),
  iso(2),
  JSON.stringify({ model: "claude-test", turnTokenUsage: usage() }),
);
tu.run(
  "turn-4",
  "thread-zzz",
  "pt-zzz",
  iso(1),
  iso(2),
  JSON.stringify({ model: "claude-test", turnTokenUsage: usage() }),
);
db.close();
writeFileSync(
  join(piDir, "a.jsonl"),
  [
    { type: "session", version: 3, id: "pi-a", timestamp: iso(0) },
    {
      type: "message",
      id: "e1",
      timestamp: iso(1),
      message: {
        role: "assistant",
        provider: "pi-provider",
        model: "pi-model",
        responseId: "resp-1",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { total: 0.0002 },
        },
      },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n") + "\n",
);
writeFileSync(
  prices,
  JSON.stringify({
    fetchedAtMs: 1767225600000,
    document: {
      "claude-test": {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
        cache_read_input_token_cost: 0.0000001,
        cache_creation_input_token_cost: 0.0000005,
      },
    },
  }),
);

nf(["sync"]);
nf(["attempt", "finish", key, "--status", "succeeded", "--outcome", "ok"]);
nf(["task", "set", "T-004", "--status", "review"]);
nf(["task", "check", "T-004", "--item", "1", "--result", "pass", "--evidence", "e"]);

mkdirSync(outDir, { recursive: true });
const backupFile = JSON.parse(nf(["backup", "--json"])).file;
copyFileSync(backupFile, join(outDir, "nf-v2.db"));
copyFileSync(join(home, "machine-id"), join(outDir, "nf-v2.machine-id"));
// neutral root path so the fixture carries no local user path
const fx = new DatabaseSync(join(outDir, "nf-v2.db"));
fx.exec("UPDATE projects SET root_path = 'C:/fixture/demo'");
// the replaced row keeps the generator's real temp path in a freed page until the file is rewritten
fx.exec("VACUUM");
fx.close();

// Golden outputs of read-only commands against a fresh copy of the fixture.
const goldenHome = join(work, "golden-home");
mkdirSync(goldenHome);
copyFileSync(join(outDir, "nf-v2.db"), join(goldenHome, "nf.db"));
copyFileSync(join(outDir, "nf-v2.machine-id"), join(goldenHome, "machine-id"));
const outside = mkdtempSync(join(tmpdir(), "nf-gen-cwd-"));
// `nf status` reads liveness from T3; recording against a fixed absent path keeps the replay
// independent of the machine's own state database (where the fixture threads do not exist).
const absent = join(outDir, "statev2-absent.sqlite");
const ge = { ...process.env, NF_HOME: goldenHome, NF_T3_STATE: absent };
const commands = [
  ["status", "--project", "demo"],
  ["status", "--project", "demo", "--json"],
  ["task", "list", "--project", "demo"],
  ["task", "list", "--project", "demo", "--json"],
  ["task", "list", "--all-projects"],
  ["task", "show", "T-001", "--project", "demo"],
  ["task", "show", "T-002", "--project", "demo", "--json"],
  ["task", "show", "T-004", "--project", "demo", "--events"],
  ["task", "show", "T-004", "--project", "demo", "--events", "--json"],
  ["task", "next", "--project", "demo", "--json"],
  ["attempt", "show", "T-004-A1", "--project", "demo", "--reports"],
  ["attempt", "show", "T-004-A1", "--project", "demo", "--json"],
  ["attempt", "show", "T-002-A2", "--project", "demo"],
  ["stats", "--project", "demo"],
  ["stats", "--project", "demo", "--json"],
  ["stats", "--project", "demo", "--by", "model"],
  ["stats", "--project", "demo", "--by", "strategy"],
  ["stats", "--project", "demo", "--by", "context"],
  ["stats", "--project", "demo", "--by", "attempt", "--json"],
  ["stats", "--all-projects"],
  ["stats", "--all-projects", "--by", "month", "--json"],
  ["stats", "task", "T-004", "--project", "demo"],
  ["stats", "task", "T-004", "--project", "demo", "--json"],
  ["task", "show", "T-404", "--project", "demo"],
  ["task", "set", "T-001", "--project", "demo"],
  ["frobnicate"],
];
const golden = commands.map((args) => {
  const r = spawnSync("node", [BIN, ...args], { cwd: outside, encoding: "utf8", env: ge });
  return { args, code: r.status, out: r.stdout, err: r.stderr };
});
writeFileSync(join(outDir, "nf-v2.golden.json"), JSON.stringify(golden, null, 2) + "\n");
console.log("ok", readdirSync(outDir), work);
