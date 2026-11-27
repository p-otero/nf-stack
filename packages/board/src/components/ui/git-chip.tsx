import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { FileIcon, GitBranchIcon } from "lucide-react"
import type { Ref } from "react"

import { cn } from "@/lib/utils"

// A quiet inline token: caption mono on a translucent fill, so it shows on a hovered or selected row as on the
// card, and no taller than the line it sits in. The border is
// transparent so it shows only in forced-colors mode, where the fill is dropped.
const chipClassName =
  "inline-flex max-w-full min-w-0 items-center gap-inline rounded-sm border border-transparent bg-foreground/8 px-inline py-px align-baseline font-mono text-caption leading-none text-muted-foreground [&>svg]:size-3 [&>svg]:shrink-0"

type ChipTextProps = {
  /**
   * Renders the name empty with this ref, for a list that fills it itself, like a virtualizer's `findableText`
   * keeping a row findable while it isn't rendered.
   */
  textRef?: Ref<HTMLSpanElement>
}

type GitFileChipProps = Omit<PartProps<"span">, "children"> & ChipTextProps & { path: string }

/** A file path inline in text, like a commit message: a file icon and the path in mono. */
function GitFileChip({ path, textRef, className, render, ...props }: GitFileChipProps) {
  return renderElement(
    "span",
    {
      "data-slot": "git-file-chip",
      title: path,
      className: cn(chipClassName, className),
      ...props,
      children: (
        <>
          <FileIcon />
          {textRef ? <span ref={textRef} className="truncate" /> : <span className="truncate">{path}</span>}
        </>
      ),
    },
    render,
  )
}

type GitBranchChipProps = Omit<PartProps<"span">, "children"> & ChipTextProps & { name: string }

/** A branch name inline in text, like "Merge invoice-pdf into main". */
function GitBranchChip({ name, textRef, className, render, ...props }: GitBranchChipProps) {
  return renderElement(
    "span",
    {
      "data-slot": "git-branch-chip",
      className: cn(chipClassName, className),
      ...props,
      children: (
        <>
          <GitBranchIcon />
          {textRef ? <span ref={textRef} className="truncate" /> : <span className="truncate">{name}</span>}
        </>
      ),
    },
    render,
  )
}

export { GitBranchChip, GitFileChip }
export type { GitBranchChipProps, GitFileChipProps }
