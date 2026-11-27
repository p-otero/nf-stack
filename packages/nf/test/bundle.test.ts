import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The published layout: `dist/` beside the manifest is what makes nf read the shipped board, the
// shipped skills and the shipped package version.
const PACKAGE = join(import.meta.dir, "..");
const BIN = join(PACKAGE, "bin", "nf.js");
const NODE = process.env["NF_TEST_NODE"] ?? "node";
const VERSION = (
  JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { version: string }
).version;

setDefaultTimeout(120_000);

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function env(home: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    NF_HOME: home,
    NF_T3_STATE: join(home, "absent.sqlite"),
    NF_PRICES: join(home, "absent-rates.json"),
    NF_OFFLINE: "1",
  };
}

beforeAll(() => {
  execFileSync(process.execPath, [join(PACKAGE, "scripts", "build.mjs")], { stdio: "pipe" });
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("the built package", () => {
  test("bundles the CLI into one JavaScript file", () => {
    const bundle = readFileSync(join(PACKAGE, "dist", "main.js"), "utf8");
    const specifiers = [...bundle.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(bundle.length).toBeGreaterThan(100_000);
    expect(bundle).not.toContain("sourceMappingURL");
    expect(specifiers.filter((name) => name.endsWith(".ts"))).toEqual([]);
  });

  test("carries the board page and the model traits it reads", () => {
    const page = readFileSync(join(PACKAGE, "dist", "board", "index.html"), "utf8");
    expect(page).toContain("<!-- nf-board-data -->");
    expect(existsSync(join(PACKAGE, "dist", "model-traits.yaml"))).toBe(true);
    expect(existsSync(join(PACKAGE, "skills", "nf-meta", "SKILL.md"))).toBe(true);
  });

  test("carries the third-party notices beside the licence", () => {
    const notices = readFileSync(join(PACKAGE, "THIRD-PARTY-NOTICES.md"), "utf8");
    expect(notices).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(notices).toContain("Apache License");
    expect(notices).toContain("`effect`");
    expect(notices).toContain("`recharts`");
  });

  test("reports its own version under node", () => {
    const home = tmp("nf-package-home-");
    const result = spawnSync(NODE, [BIN, "--version"], { encoding: "utf8", env: env(home) });
    expect(result.stdout.trim()).toBe(`nf ${VERSION}`);
    expect(result.stderr).not.toContain("SQLite is an experimental");
  });

  test("links the skills it ships, not a checkout", () => {
    const home = tmp("nf-package-skills-");
    const result = spawnSync(NODE, [BIN, "skills", "link", "--dry-run", "--home", home], {
      encoding: "utf8",
      env: env(home),
    });
    expect(result.stdout).toContain(join(PACKAGE, "skills", "nf-meta"));
  });

  test("serves the shipped board page", async () => {
    const home = tmp("nf-package-serve-");
    const child = spawn(NODE, [BIN, "serve", "--port", "0"], {
      env: env(home),
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const origin = await new Promise<string>((resume, reject) => {
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          output += chunk;
        });
        child.stdout.on("data", (chunk: string) => {
          output += chunk;
          const match = /^nf serve: (http:\/\/localhost:\d+\/)/m.exec(output);
          if (match !== null && match[1] !== undefined) resume(match[1]);
        });
        child.on("exit", (code) => reject(new Error(`nf serve exited with ${String(code)}`)));
      });
      const page = await fetch(new URL("/", origin));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('id="board-source"');
      const health = await (await fetch(new URL("/api/health", origin))).json();
      expect(health).toMatchObject({ app: "nf", nfHome: home });
    } finally {
      child.kill();
    }
  });
});
