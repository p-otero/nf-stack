import type { DiffViewFile } from "@/components/ui/diff-view-model";
import { toViewFiles } from "@/components/ui/diff-view-model";
import type { GitDiffGroup } from "@/components/ui/git-diff";
import type { GitDiffTreeGroup } from "@/components/ui/git-diff-tree";
import type { FileDiff } from "@/lib/diff-types";
import { parsePatch } from "@/lib/diff-patch";

type DiffFiles = {
  files: readonly DiffViewFile[];
  /** One tree section per group; undefined for one tree over every file. */
  groups: readonly GitDiffTreeGroup[] | undefined;
};

const sectionFiles = (group: GitDiffGroup): readonly FileDiff[] =>
  group.files === undefined
    ? group.patch === undefined || group.patch === ""
      ? []
      : parsePatch(group.patch)
    : group.files;

function diffFiles(
  patch: string | undefined,
  groups: readonly GitDiffGroup[] | undefined,
): DiffFiles {
  if (groups === undefined) {
    return {
      files: toViewFiles(patch === undefined || patch === "" ? [] : parsePatch(patch)),
      groups: undefined,
    };
  }
  const sections = groups.map(sectionFiles);
  const files = toViewFiles(sections.flat());
  let start = 0;
  const tree = groups.map((group, index) => {
    const count = sections[index]?.length ?? 0;
    const paths = files.slice(start, start + count).map((file) => file.path);
    start += count;
    return { label: group.label, paths };
  });
  return { files, groups: tree };
}

export { diffFiles };
export type { DiffFiles };
