import type { GitChangeSet } from "@nf/contracts";

export type Truncation = { shown: number; total: number; missing: readonly string[] };

export type PatchSet = {
  files: number;
  additions: number;
  deletions: number;
  patch: string;
  truncation: Truncation | null;
};

const DIFF_HEADER = "diff --git ";

const patchHeaders = (patch: string): string[] =>
  patch.split("\n").filter((line) => line.startsWith(DIFF_HEADER));

export const truncationOf = (
  set: Pick<GitChangeSet, "files" | "patch" | "truncated">,
): Truncation | null => {
  if (!set.truncated) return null;
  const headers = patchHeaders(set.patch);
  const missing = set.files
    .map((file) => file.path)
    .filter(
      (path) =>
        !headers.some((header) => header.endsWith(` b/${path}`) || header.endsWith(` "b/${path}"`)),
    );
  return { shown: set.files.length - missing.length, total: set.files.length, missing };
};

export const toPatchSet = (set: Pick<GitChangeSet, "files" | "patch" | "truncated">): PatchSet => {
  const lines = set.files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
  return {
    files: set.files.length,
    ...lines,
    patch: set.patch,
    truncation: truncationOf(set),
  };
};
