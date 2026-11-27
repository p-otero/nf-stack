"use client"

import type { ReactNode } from "react"

import { CodeBlock, type CodeBlockProps } from "@/components/ui/code-block"
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

type CodeFile = {
  /** The tab's text, usually a filename; also the tab's value unless `value` is set. */
  title: string
  value?: string
  code: string
  language?: CodeBlockProps["language"]
  highlightLines?: CodeBlockProps["highlightLines"]
  icon?: ReactNode
}

type CodeTabsProps = Pick<
  CodeBlockProps,
  "lineNumbers" | "wrap" | "maxHeight" | "copyable" | "onCopy" | "labels" | "className"
> & {
  files: readonly CodeFile[]
  /** Names the tab list, like "Installation files". */
  "aria-label": string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

const valueOf = (file: CodeFile) => file.value ?? file.title

function CodeTabs({
  files,
  "aria-label": label,
  value,
  defaultValue,
  onValueChange,
  className,
  ...block
}: CodeTabsProps) {
  return (
    <Tabs
      render={<div data-slot="code-tabs" />}
      value={value}
      defaultValue={defaultValue ?? (files[0] ? valueOf(files[0]) : undefined)}
      onValueChange={(next) => next !== null && onValueChange?.(next)}
      className={cn("min-w-0 gap-0 overflow-hidden rounded-surface border bg-muted", className)}
    >
      <div className="flex min-w-0 border-b p-inline">
        <TabsList aria-label={label} className="bg-transparent p-0">
          <TabsIndicator />
          {files.map((file) => (
            <TabsTab key={valueOf(file)} value={valueOf(file)} className="font-mono text-caption">
              {file.icon}
              {file.title}
            </TabsTab>
          ))}
        </TabsList>
      </div>
      {files.map((file) => (
        <TabsPanel key={valueOf(file)} value={valueOf(file)} className="rounded-none">
          <CodeBlock
            code={file.code}
            language={file.language}
            highlightLines={file.highlightLines}
            aria-label={file.title}
            className="rounded-none border-0"
            {...block}
          />
        </TabsPanel>
      ))}
    </Tabs>
  )
}

export { CodeTabs }
export type { CodeFile, CodeTabsProps }
