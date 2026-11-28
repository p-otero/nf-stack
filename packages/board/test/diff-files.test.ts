import { describe, expect, test } from "bun:test";

import { diffFiles } from "../src/components/nf/git/diff-files";

const twoFiles = [
  "diff --git a/src/one.ts b/src/one.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/one.ts",
  "@@ -0,0 +1 @@",
  "+one",
  "diff --git a/notes/todo.md b/notes/todo.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/notes/todo.md",
  "@@ -0,0 +1 @@",
  "+later",
  "",
].join("\n");

describe("diff files", () => {
  test("lists a patch's files in order, with one tree over all of them", () => {
    const tree = diffFiles(twoFiles, undefined);
    expect(tree.files.map((file) => file.path)).toEqual(["src/one.ts", "notes/todo.md"]);
    expect(tree.groups).toBeUndefined();
  });

  test("keeps a group's files together under its label", () => {
    const tree = diffFiles(undefined, [
      { label: "Staged", patch: twoFiles.split("diff --git a/notes")[0] ?? "" },
      { label: "Untracked", patch: `diff --git a/notes${twoFiles.split("diff --git a/notes")[1] ?? ""}` },
    ]);
    expect(tree.files.map((file) => file.path)).toEqual(["src/one.ts", "notes/todo.md"]);
    expect(tree.groups).toEqual([
      { label: "Staged", paths: ["src/one.ts"] },
      { label: "Untracked", paths: ["notes/todo.md"] },
    ]);
  });

  test("names a file in two groups after the first, as the diff's headers do", () => {
    const tree = diffFiles(undefined, [
      { label: "Staged", patch: twoFiles.split("diff --git a/notes")[0] ?? "" },
      { label: "Unstaged", patch: twoFiles.split("diff --git a/notes")[0] ?? "" },
    ]);
    expect(tree.files.map((file) => file.path)).toEqual(["src/one.ts", "src/one.ts (2)"]);
    expect(tree.groups).toEqual([
      { label: "Staged", paths: ["src/one.ts"] },
      { label: "Unstaged", paths: ["src/one.ts (2)"] },
    ]);
  });

  test("keeps a group whose patch is empty out of the tree", () => {
    const tree = diffFiles(undefined, [
      { label: "Staged", patch: "" },
      { label: "Untracked", patch: twoFiles },
    ]);
    expect(tree.groups).toEqual([
      { label: "Staged", paths: [] },
      { label: "Untracked", paths: ["src/one.ts", "notes/todo.md"] },
    ]);
  });
});
