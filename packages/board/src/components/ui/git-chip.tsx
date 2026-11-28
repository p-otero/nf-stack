import { renderElement, type PartProps } from "@ui-sdk/react/primitive"
import { FileIcon, GitBranchIcon } from "lucide-react"
import type { Ref } from "react"

import { cn } from "@/lib/utils"

// Spec: forced-colors mode drops the fill, so the transparent border is the chip's only edge there.
const chipClassName =
  "inline-flex max-w-full min-w-0 items-center gap-inline rounded-sm border border-transparent bg-foreground/8 px-inline py-px align-baseline font-mono text-caption leading-none text-muted-foreground [&>svg]:size-3 [&>svg]:shrink-0"

type ChipTextProps = {
  /** Renders the name empty and attaches this ref, for a list that fills the text itself (a virtualizer's `findableText`). */
  textRef?: Ref<HTMLSpanElement>
}

type GitFileChipProps = Omit<PartProps<"span">, "children"> & ChipTextProps & { path: string }

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
