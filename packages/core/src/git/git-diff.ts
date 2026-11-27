import * as Effect from "effect/Effect";
import { GIT_FILE_STATUS, GIT_PATCH_LIMITS } from "@nf/contracts";
import type { GitChangeSet, GitCommit, GitFileChange, GitFileStatus } from "@nf/contracts";
import { nulFields, readGit } from "./git-read.ts";

const STATUS_LETTER: Record<string, GitFileStatus> = {
  A: GIT_FILE_STATUS.ADDED,
  M: GIT_FILE_STATUS.MODIFIED,
  D: GIT_FILE_STATUS.DELETED,
  R: GIT_FILE_STATUS.RENAMED,
  C: GIT_FILE_STATUS.COPIED,
  T: GIT_FILE_STATUS.TYPE_CHANGED,
  U: GIT_FILE_STATUS.UNMERGED,
};

const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
] as const;

interface NumStat {
  readonly additions: number | null;
  readonly deletions: number | null;
}

const lineCount = (field: string): number | null => {
  const count = Number.parseInt(field, 10);
  return Number.isNaN(count) ? null : count;
};

/** `--name-status -z`: a status, then one path, or two for a rename or copy. */
export function parseNameStatus(
  text: string,
): { path: string; status: GitFileStatus; from: string | null }[] {
  const fields = nulFields(text);
  const files: { path: string; status: GitFileStatus; from: string | null }[] = [];
  for (let at = 0; at < fields.length;) {
    const code = fields[at] ?? "";
    const status = STATUS_LETTER[code.charAt(0)] ?? GIT_FILE_STATUS.UNKNOWN;
    if (status === GIT_FILE_STATUS.RENAMED || status === GIT_FILE_STATUS.COPIED) {
      files.push({ status, from: fields[at + 1] ?? null, path: fields[at + 2] ?? "" });
      at += 3;
    } else {
      files.push({ status, from: null, path: fields[at + 1] ?? "" });
      at += 2;
    }
  }
  return files.filter((file) => file.path.length > 0);
}

/** `--numstat -z`: counts and a path, or counts, an empty path, then the old and new paths. */
export function parseNumStat(text: string): Map<string, NumStat> {
  const fields = nulFields(text);
  const stats = new Map<string, NumStat>();
  for (let at = 0; at < fields.length;) {
    const [added = "", deleted = "", path = ""] = (fields[at] ?? "").split("\t");
    const stat = { additions: lineCount(added), deletions: lineCount(deleted) };
    if (path.length === 0) {
      stats.set(fields[at + 2] ?? "", stat);
      at += 3;
    } else {
      stats.set(path, stat);
      at += 1;
    }
  }
  return stats;
}

const DIFF_HEADER = "diff --git ";

/** Cut a patch at a file boundary so it carries at most `GIT_PATCH_LIMITS`. */
export function capPatch(patch: string, cut: boolean): { patch: string; truncated: boolean } {
  const starts: number[] = [];
  for (let at = patch.startsWith(DIFF_HEADER) ? 0 : patch.indexOf(`\n${DIFF_HEADER}`); at !== -1;) {
    const start = patch.charAt(at) === "\n" ? at + 1 : at;
    starts.push(start);
    at = patch.indexOf(`\n${DIFF_HEADER}`, start);
  }
  if (starts.length > GIT_PATCH_LIMITS.files) {
    return { patch: patch.slice(0, starts[GIT_PATCH_LIMITS.files]), truncated: true };
  }
  if (!cut && Buffer.byteLength(patch) <= GIT_PATCH_LIMITS.bytes) {
    return { patch, truncated: false };
  }
  const last = starts.at(-1) ?? 0;
  return { patch: patch.slice(0, last), truncated: true };
}

/** Read a patch from git, never holding more than the byte limit and one byte. */
export const readPatch = (cwd: string, args: readonly string[]) =>
  readGit(cwd, args, { maxBytes: GIT_PATCH_LIMITS.bytes + 1 }).pipe(
    Effect.map((output) => capPatch(output.stdout, output.cut)),
  );

/**
 * The files, line counts and capped patch of one diff. `command` is the git command and its
 * revisions (`diff-tree -r A B`, `diff --cached`), to which the output flags are added.
 */
export const changeSet = Effect.fnUntraced(function* (cwd: string, command: readonly string[]) {
  const [names, numbers, patch] = yield* Effect.all(
    [
      readGit(cwd, [...command, ...DIFF_FLAGS, "--name-status", "-z"]),
      readGit(cwd, [...command, ...DIFF_FLAGS, "--numstat", "-z"]),
      readPatch(cwd, [...command, ...DIFF_FLAGS, "--patch"]),
    ],
    { concurrency: "unbounded" },
  );
  const stats = parseNumStat(numbers.stdout);
  const files: GitFileChange[] = parseNameStatus(names.stdout).map((file) => {
    const stat = stats.get(file.path);
    return {
      path: file.path,
      status: file.status,
      from: file.from,
      additions: stat?.additions ?? null,
      deletions: stat?.deletions ?? null,
    };
  });
  const set: GitChangeSet = { files, patch: patch.patch, truncated: patch.truncated };
  return set;
});

const RECORD = "\u001e";
/** Hash, parents, author, email, date, decorations, subject, body; each closed by a NUL. */
export const COMMIT_FORMAT = `--format=${RECORD}%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x00`;

const shortStat = (text: string, word: RegExp): number | null => {
  const match = word.exec(text);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
};

/** Commits printed with `COMMIT_FORMAT`, optionally followed by their `--shortstat` line. */
export function parseCommits(text: string): GitCommit[] {
  return text
    .split(RECORD)
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const [
        sha = "",
        parents = "",
        author = "",
        email = "",
        date = "",
        refs = "",
        subject = "",
        body = "",
        ...rest
      ] = record.split("\0");
      if (sha.length === 0) return [];
      const stat = rest.join("\0");
      const filesChanged = shortStat(stat, /(\d+) files? changed/);
      return [
        {
          sha,
          parents: parents.split(" ").filter((parent) => parent.length > 0),
          author,
          email,
          date,
          subject,
          body: body.replace(/\n+$/, ""),
          refs: refs
            .split(", ")
            .map((ref) => ref.trim())
            .filter((ref) => ref.length > 0),
          filesChanged,
          insertions:
            filesChanged === null ? null : (shortStat(stat, /(\d+) insertions?\(\+\)/) ?? 0),
          deletions: filesChanged === null ? null : (shortStat(stat, /(\d+) deletions?\(-\)/) ?? 0),
        },
      ];
    });
}
