import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { utcStamp } from "./home.ts";

export interface LinkOptions {
  /** Home directory holding `.agents` and `.claude` (default: the user's home). */
  home?: string;
  /** Skills source directory (default: this checkout's `skills/`). */
  skillsDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

export type LinkAction =
  "created" | "linked" | "replaced" | "skipped" | "would-create" | "would-replace";

export interface LinkResult {
  name: string;
  source: string;
  target: string;
  action: LinkAction;
  note?: string;
}

/**
 * `skills/` of the checkout this code runs from, or of the package that ships it: a published
 * install carries the same folder beside its `dist/` bundle.
 */
export function defaultSkillsDir(): string {
  const shipped = fileURLToPath(new URL("../skills", import.meta.url));
  return existsSync(shipped)
    ? shipped
    : fileURLToPath(new URL("../../../../skills", import.meta.url));
}

function lstatSafe(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function realSafe(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

function sameDir(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return norm(a) === norm(b);
}

/** Skill names in the source dir: `nf-*` folders that contain a SKILL.md. */
export function listSkills(skillsDir: string): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        e.name.startsWith("nf-") &&
        existsSync(join(skillsDir, e.name, "SKILL.md")),
    )
    .map((e) => e.name)
    .toSorted();
}

/**
 * Link `~/.agents/skills/nf-*` and `~/.claude/skills/nf-*` to this checkout's skills.
 * Junctions on Windows (no admin needed), symlinks elsewhere. Idempotent. A target that is a
 * real folder or points elsewhere is reported and skipped unless `force` (a real folder is
 * moved aside, never deleted).
 */
export function linkSkills(opts: LinkOptions = {}): LinkResult[] {
  const home = opts.home ?? homedir();
  const skillsDir = opts.skillsDir ?? defaultSkillsDir();
  const dry = opts.dryRun === true;
  const results: LinkResult[] = [];
  const kind = process.platform === "win32" ? "junction" : "dir";

  for (const dest of [join(home, ".agents", "skills"), join(home, ".claude", "skills")]) {
    for (const name of listSkills(skillsDir)) {
      const source = join(skillsDir, name);
      const target = join(dest, name);
      const base = { name, source, target };
      const st = lstatSafe(target);

      const create = (action: "created" | "replaced", note?: string) => {
        mkdirSync(dest, { recursive: true });
        symlinkSync(source, target, kind);
        results.push({ ...base, action, ...(note ? { note } : {}) });
      };

      if (!st) {
        if (dry) results.push({ ...base, action: "would-create" });
        else create("created");
        continue;
      }
      if (st.isSymbolicLink()) {
        if (sameDir(realSafe(target), realSafe(source))) {
          results.push({ ...base, action: "linked", note: "already linked" });
          continue;
        }
        const where = realSafe(target) ?? readlinkSafe(target) ?? "unknown";
        if (!opts.force) {
          results.push({
            ...base,
            action: "skipped",
            note: `points elsewhere (${where}); use --force`,
          });
        } else if (dry) {
          results.push({ ...base, action: "would-replace", note: `was ${where}` });
        } else {
          unlinkSync(target);
          create("replaced", `was ${where}`);
        }
        continue;
      }
      if (!opts.force) {
        results.push({
          ...base,
          action: "skipped",
          note: "exists as a real folder; use --force to move it aside",
        });
      } else if (dry) {
        results.push({ ...base, action: "would-replace", note: "real folder moved aside" });
      } else {
        const aside = `${target}.bak-${utcStamp()}`;
        renameSync(target, aside);
        create("replaced", `previous folder kept at ${aside}`);
      }
    }
  }
  return results;
}

function readlinkSafe(p: string): string | null {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
}
