import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Byte-for-byte output of the read commands, recorded from the plain-TypeScript nf against the
// v2 fixture store (packages/core/test/fixtures/gen-v2.mjs), replayed with *node*.
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const BIN = join(import.meta.dir, "..", "bin", "nf.js");
const FIXTURES = join(import.meta.dir, "..", "..", "core", "test", "fixtures");

interface Golden {
  args: string[];
  code: number;
  out: string;
  err: string;
}

const golden = JSON.parse(readFileSync(join(FIXTURES, "nf-v2.golden.json"), "utf8")) as Golden[];

setDefaultTimeout(60_000);

const home = realpathSync(mkdtempSync(join(tmpdir(), "nf-golden-home-")));
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "nf-golden-cwd-")));
copyFileSync(join(FIXTURES, "nf-v2.db"), join(home, "nf.db"));
copyFileSync(join(FIXTURES, "nf-v2.machine-id"), join(home, "machine-id"));

afterAll(() => {
  for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

beforeAll(() => {
  // The recordings come from the nf that migrated this store silently. A pending migration now
  // names the copy it writes on stderr, and that path belongs to this temporary home, so migrate
  // once here and replay the read commands against the migrated store.
  const migrated = spawnSync(NODE, [BIN, "status", "--project", "demo"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NF_HOME: home, NF_T3_STATE: join(FIXTURES, "statev2-absent.sqlite") },
  });
  expect(migrated.status).toBe(0);
});

describe("nf output matches the previous implementation byte for byte", () => {
  for (const g of golden) {
    test(`nf ${g.args.join(" ")}`, () => {
      const r = spawnSync(NODE, [BIN, ...g.args], {
        cwd,
        encoding: "utf8",
        // Liveness reads T3's state database: a fixed absent path keeps the replay hermetic.
        env: {
          ...process.env,
          NF_HOME: home,
          NF_T3_STATE: join(FIXTURES, "statev2-absent.sqlite"),
        },
      });
      expect({ code: r.status, out: r.stdout, err: r.stderr }).toEqual({
        code: g.code,
        out: g.out,
        err: g.err,
      });
    });
  }
});
