import * as Effect from "effect/Effect";
import { nulFields, readGit } from "./git-read.ts";

export interface GitStatus {
  /** Null before the first commit. */
  readonly head: string | null;
  /** Null on a detached HEAD. */
  readonly branch: string | null;
  readonly upstream: string | null;
  /** Null without an upstream, or when the upstream ref is gone. */
  readonly ahead: number | null;
  readonly behind: number | null;
  /** Changed, conflicted and untracked paths. */
  readonly uncommitted: number;
  readonly untracked: readonly string[];
}

/** `git status --porcelain=v2 --branch -z`. */
export function parseStatus(text: string): GitStatus {
  let head: string | null = null;
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let uncommitted = 0;
  const untracked: string[] = [];
  const fields = nulFields(text);
  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? "";
    if (field.startsWith("# ")) {
      const [, key = "", ...values] = field.split(" ");
      const value = values.join(" ");
      if (key === "branch.oid") head = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match?.[1] !== undefined && match[2] !== undefined) {
          ahead = Number.parseInt(match[1], 10);
          behind = Number.parseInt(match[2], 10);
        }
      }
      continue;
    }
    const kind = field.charAt(0);
    if (kind === "!") continue;
    uncommitted += 1;
    if (kind === "?") untracked.push(field.slice(2));
    if (kind === "2") at += 1;
  }
  return { head, branch, upstream, ahead, behind, uncommitted, untracked };
}

export const readStatus = (cwd: string) =>
  readGit(cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]).pipe(
    Effect.map((output) => parseStatus(output.stdout)),
  );
