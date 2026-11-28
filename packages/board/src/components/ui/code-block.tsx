"use client"

import { usePart, usePrimitive } from "@ui-sdk/react/primitive"
import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { codeBlock, type CodeBlockOptions } from "@/components/ui/code-block-primitive"
import {
  highlight,
  normalizeLanguage,
  parserFor,
  watchParser,
  type CodeLanguage,
  type CodeLine,
  type SyntaxTone,
} from "@/components/ui/code-highlight"
import { ScrollArea, ScrollAreaCorner, ScrollAreaScrollbar, ScrollAreaViewport } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type CodeBlockLabels = {
  copy: string
  /** Announced, and the button's name, for two seconds after copying. */
  copied: string
  /** The block's name when it has no string `title` or `aria-label`. */
  code: string
}

const defaultLabels: CodeBlockLabels = { copy: "Copy code", copied: "Copied", code: "Code" }

type LineRange = number | readonly [from: number, to: number]

type CodeBlockProps = Omit<ComponentProps<"div">, "children" | "title" | "onCopy"> & {
  code: string
  /** ts, tsx, js, jsx, json, css, html, bash/sh, md, diff or plaintext; aliases like "typescript" work too. */
  language?: CodeLanguage | (string & {})
  /** A filename or caption in a header above the code. */
  title?: ReactNode
  /** Content at the end of the header, before the copy button, like a language badge. */
  actions?: ReactNode
  /** Shows a copy button. Agents can always call the block's `copy` action. */
  copyable?: boolean
  onCopy?: CodeBlockOptions["onCopy"]
  lineNumbers?: boolean
  /** One-based line numbers or inclusive ranges, marked with a fill and a start edge. */
  highlightLines?: readonly LineRange[]
  wrap?: boolean
  /** A CSS length, like "24rem"; the code scrolls inside past it. */
  maxHeight?: string
  labels?: Partial<CodeBlockLabels>
}

const toneClassNames = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  number: "text-syntax-number",
  comment: "text-syntax-comment italic",
  function: "text-syntax-function",
  type: "text-syntax-type",
  property: "text-syntax-property",
  tag: "text-syntax-tag",
  punctuation: "text-syntax-punctuation",
} satisfies Record<SyntaxTone, string>

function useHighlightedLines(code: string, language: CodeLanguage) {
  const subscribe = useCallback((onLoad: () => void) => watchParser(language, onLoad), [language])
  const current = () => parserFor(language)
  const parser = useSyncExternalStore(subscribe, current, current)
  return useMemo(() => highlight(code, language, parser), [code, language, parser])
}

function lineSet(ranges: readonly LineRange[] | undefined) {
  const lines = new Set<number>()
  for (const range of ranges ?? []) {
    if (typeof range === "number") lines.add(range)
    else for (let line = range[0]; line <= range[1]; line++) lines.add(line)
  }
  return lines
}

function CodeLineView({
  line,
  number,
  highlighted,
  lineNumbers,
}: {
  line: CodeLine
  number: number
  highlighted: boolean
  lineNumbers: boolean
}) {
  return (
    <span
      data-slot="code-line"
      data-highlighted={highlighted ? "" : undefined}
      data-diff={line.diff}
      className="flex border-s-2 border-transparent px-inset-item data-highlighted:border-primary data-highlighted:bg-code-highlight data-[diff=deleted]:bg-destructive-soft data-[diff=deleted]:text-destructive-soft-foreground data-[diff=hunk]:text-syntax-type data-[diff=inserted]:bg-success-soft data-[diff=inserted]:text-success-soft-foreground data-[diff=meta]:text-muted-foreground"
    >
      {lineNumbers && (
        <span
          data-slot="code-line-number"
          aria-hidden="true"
          className="w-(--code-gutter) shrink-0 pe-group text-end text-muted-foreground tabular-nums select-none"
        >
          {number}
        </span>
      )}
      <span data-slot="code-line-content" className="min-w-0 flex-1">
        {line.tokens.length === 0
          ? "\n"
          : line.tokens.map((token, index) =>
              token.tone ? (
                // oxlint-disable-next-line react/no-array-index-key -- tokens of a line have no identity but their order
                <span key={index} className={toneClassNames[token.tone]}>
                  {token.text}
                </span>
              ) : (
                token.text
              ),
            )}
      </span>
    </span>
  )
}

function CodeBlock({
  code,
  language,
  title,
  actions,
  copyable = true,
  onCopy,
  lineNumbers = false,
  highlightLines,
  wrap = false,
  maxHeight,
  labels: labelOverrides,
  className,
  style,
  "aria-label": ariaLabel,
  ...props
}: CodeBlockProps) {
  const labels = { ...defaultLabels, ...labelOverrides }
  const text = code.replace(/\r?\n$/, "")
  const lang = normalizeLanguage(language)
  const lines = useHighlightedLines(text, lang)
  const highlighted = useMemo(() => lineSet(highlightLines), [highlightLines])
  const handle = usePrimitive(codeBlock, { text, onCopy })
  const header = title !== undefined || actions !== undefined
  const scrolls = !wrap || maxHeight !== undefined
  const name = ariaLabel ?? (typeof title === "string" ? title : labels.code)

  const copyButton = (copied: boolean) =>
    copyable && (
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? labels.copied : labels.copy}
        data-agent-hidden=""
        className={cn("size-control-sm", !header && "absolute end-inline top-inline z-10 bg-muted")}
        onClick={(event) => handle.api.copy(event.nativeEvent)}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    )

  return usePart(
    handle,
    "root",
    {},
    {
      ...({ "data-slot": "code-block", "data-language": lang } as Record<`data-${string}`, string>),
      "aria-label": name,
      style: {
        ...style,
        "--code-gutter": `${String(lines.length).length + 1}ch`,
        ...(maxHeight === undefined ? {} : { "--code-block-max-height": maxHeight }),
      } as CSSProperties,
      className: cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-surface border bg-muted text-foreground",
        className,
      ),
      ...props,
      children: ({ copied }: { copied: boolean }) => (
        <>
          {header && (
            <div
              data-slot="code-block-header"
              className="flex min-h-control items-center gap-items border-b ps-(--item-padding-x) pe-inline text-caption text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{title}</span>
              {actions}
              {copyButton(copied)}
            </div>
          )}
          {!header && copyButton(copied)}
          <ScrollArea className="flex min-h-0 flex-col">
            <ScrollAreaViewport
              tabIndex={scrolls ? 0 : undefined}
              render={(part) => <pre {...part} />}
              className={cn(
                "m-0 h-auto min-h-0 flex-1 py-inset-item font-mono text-caption leading-relaxed",
                maxHeight !== undefined && "max-h-(--code-block-max-height)",
                !header && copyable && "[&_[data-slot=code-line]]:pe-section",
                wrap ? "whitespace-pre-wrap wrap-anywhere" : "whitespace-pre [&_[data-slot=code-line]]:min-w-max",
              )}
            >
              <code data-language={lang} className="grid">
                {lines.map((line, index) => (
                  <CodeLineView
                    // oxlint-disable-next-line react/no-array-index-key -- lines of a code sample have no identity but their order
                    key={index}
                    line={line}
                    number={index + 1}
                    highlighted={highlighted.has(index + 1)}
                    lineNumbers={lineNumbers}
                  />
                ))}
              </code>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar data-agent-hidden="" />
            <ScrollAreaScrollbar orientation="horizontal" data-agent-hidden="" />
            <ScrollAreaCorner />
          </ScrollArea>
          <output className="sr-only">{copied ? labels.copied : ""}</output>
        </>
      ),
    },
    "div",
  )
}

type CodeProps = ComponentProps<"code">

function Code({ className, ...props }: CodeProps) {
  return (
    <code
      data-slot="code"
      className={cn("rounded-sm bg-muted px-inline py-px font-mono break-words", className)}
      {...props}
    />
  )
}

export { Code, CodeBlock }
export { normalizeLanguage }
export type { CodeLanguage, SyntaxTone }
export type { CodeBlockLabels, CodeBlockProps, CodeProps, LineRange }
