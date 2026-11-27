import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = join(import.meta.dir, "..");
const PACKAGES = join(PACKAGE, "..");
const ROOT = join(PACKAGES, "..");

function manifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const shipped = manifest(join(PACKAGE, "package.json"));
const cli = manifest(join(PACKAGES, "cli", "package.json"));

describe("the published package", () => {
  test("is the scoped @p-otero/nf-stack with the nf bin", () => {
    expect(shipped["name"]).toBe("@p-otero/nf-stack");
    expect(shipped["bin"]).toEqual({ nf: "./bin/nf.js" });
    expect(shipped["engines"]).toEqual({ node: ">=24.13" });
    expect(shipped["publishConfig"]).toEqual({ access: "public", provenance: true });
    expect(shipped["repository"]).toEqual({
      type: "git",
      url: "git+https://github.com/p-otero/nf-stack.git",
      directory: "packages/nf",
    });
  });

  test("ships the built CLI, board, skills, licence and notices only", () => {
    expect(shipped["files"]).toEqual([
      "bin",
      "dist",
      "skills",
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
      "README.md",
    ]);
  });

  test("depends on the native modules the bundle leaves external", () => {
    expect(shipped["dependencies"]).toEqual({ sharp: "0.35.5" });
    expect(Object.keys(shipped)).not.toContain("devDependencies");
  });

  test("installs nothing that needs Bun", () => {
    expect(Object.keys(shipped["scripts"] as object)).toEqual(["build", "prepack"]);
  });

  test("reports the workspace version, so nf --version and the tag agree", () => {
    expect(shipped["version"]).toBe(cli["version"]);
    expect(cli["engines"]).toEqual(shipped["engines"]);
  });

  test("keeps every other workspace package private", () => {
    const published = readdirSync(PACKAGES)
      .filter((entry) => entry !== "nf")
      .map((entry) => manifest(join(PACKAGES, entry, "package.json")))
      .filter((other) => other["private"] !== true);
    expect(published.map((other) => other["name"])).toEqual([]);
    expect(manifest(join(ROOT, "package.json"))["private"]).toBe(true);
  });
});
