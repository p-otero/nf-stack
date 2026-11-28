import type { Parser } from "@lezer/common"
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight"

type SyntaxTone = "keyword" | "string" | "number" | "comment" | "function" | "type" | "property" | "tag" | "punctuation"

type CodeToken = { text: string; tone?: SyntaxTone }
type DiffKind = "inserted" | "deleted" | "hunk" | "meta"
type CodeLine = { tokens: CodeToken[]; diff?: DiffKind }

type CodeLanguage = "ts" | "tsx" | "js" | "jsx" | "json" | "css" | "html" | "bash" | "sh" | "md" | "diff" | "plaintext"

const aliases: Record<string, CodeLanguage> = {
  typescript: "ts",
  mts: "ts",
  cts: "ts",
  javascript: "js",
  mjs: "js",
  cjs: "js",
  jsonc: "json",
  json5: "json",
  xml: "html",
  svg: "html",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  terminal: "bash",
  markdown: "md",
  mdx: "md",
  patch: "diff",
  text: "plaintext",
  txt: "plaintext",
  plain: "plaintext",
}

const known = new Set<string>(["ts", "tsx", "js", "jsx", "json", "css", "html", "bash", "sh", "md", "diff"])
const isKnown = (key: string): key is CodeLanguage => known.has(key)

/** Takes a fence's info string or a file extension ("typescript", "zsh"); unknown names give `plaintext`. */
function normalizeLanguage(name?: string): CodeLanguage {
  const key = (name ?? "").trim().split(/\s/)[0]?.toLowerCase() ?? ""
  if (isKnown(key)) return key
  return aliases[key] ?? "plaintext"
}

const tones = new Set<string>([
  "keyword",
  "string",
  "number",
  "comment",
  "function",
  "type",
  "property",
  "tag",
  "punctuation",
])

const isTone = (value: string | undefined): value is SyntaxTone => value !== undefined && tones.has(value)

/** The tone of a token from the classes `syntaxHighlighter` gave it: the first, which is always one of the tones. */
function syntaxToneOf(classes: string): SyntaxTone | undefined {
  const first = classes.split(" ")[0]
  return isTone(first) ? first : undefined
}

const highlighter = tagHighlighter([
  { tag: [t.comment, t.meta, t.documentMeta], class: "comment" },
  { tag: [t.keyword, t.modifier, t.self, t.null, t.bool, t.heading, t.quote], class: "keyword" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue, t.url, t.link], class: "string" },
  { tag: [t.number, t.atom, t.unit, t.color, t.literal, t.constant(t.variableName), t.monospace], class: "number" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], class: "function" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], class: "type" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], class: "property" },
  { tag: [t.tagName, t.angleBracket], class: "tag" },
  { tag: [t.punctuation, t.operator, t.list, t.contentSeparator, t.processingInstruction], class: "punctuation" },
])

const loaders: Partial<Record<CodeLanguage, () => Promise<Parser>>> = {
  ts: () => import("@lezer/javascript").then(({ parser }) => parser.configure({ dialect: "ts" })),
  tsx: () => import("@lezer/javascript").then(({ parser }) => parser.configure({ dialect: "ts jsx" })),
  js: () => import("@lezer/javascript").then(({ parser }) => parser),
  jsx: () => import("@lezer/javascript").then(({ parser }) => parser.configure({ dialect: "jsx" })),
  json: () => import("@lezer/json").then(({ parser }) => parser),
  css: () => import("@lezer/css").then(({ parser }) => parser),
  md: () => import("@lezer/markdown").then(({ parser, GFM }) => parser.configure(GFM)),
  html: async () => {
    const [html, javascript, css] = await Promise.all([
      import("@lezer/html"),
      import("@lezer/javascript"),
      import("@lezer/css"),
    ])
    return html.parser.configure({
      wrap: html.configureNesting([
        { tag: "script", parser: javascript.parser },
        { tag: "style", parser: css.parser },
      ]),
    })
  },
}

const parsers = new Map<CodeLanguage, Parser>()
const loading = new Map<CodeLanguage, Promise<void>>()

/** Undefined while the parser loads, or for a language without one (bash, diff, plaintext). */
function parserFor(language: CodeLanguage) {
  return parsers.get(language)
}

function needsParser(language: CodeLanguage) {
  return Boolean(loaders[language]) && !parsers.has(language)
}

/** Fetches once; every block of that language re-renders highlighted when it resolves. */
function loadParser(language: CodeLanguage) {
  const load = loaders[language]
  if (!load || parsers.has(language)) return Promise.resolve()
  let pending = loading.get(language)
  if (!pending) {
    pending = load().then((parser) => {
      parsers.set(language, parser)
    })
    loading.set(language, pending)
  }
  return pending
}

/** Calls `onLoad` when the parser arrives, unless unsubscribed first. */
function watchParser(language: CodeLanguage, onLoad: () => void) {
  let active = true
  if (needsParser(language))
    loadParser(language).then(
      () => {
        if (active) onLoad()
      },
      () => {},
    )
  return () => {
    active = false
  }
}

function splitLines(tokens: CodeToken[]): CodeLine[] {
  const lines: CodeLine[] = [{ tokens: [] }]
  for (const token of tokens) {
    const parts = token.text.split("\n")
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ tokens: [] })
      if (part) lines.at(-1)!.tokens.push({ text: part, tone: token.tone })
    })
  }
  return lines
}

function parsed(code: string, parser: Parser): CodeToken[] {
  const tokens: CodeToken[] = []
  let position = 0
  highlightTree(parser.parse(code), highlighter, (from, to, classes) => {
    if (from > position) tokens.push({ text: code.slice(position, from) })
    tokens.push({ text: code.slice(from, to), tone: syntaxToneOf(classes) })
    position = to
  })
  if (position < code.length) tokens.push({ text: code.slice(position) })
  return tokens
}

const shellKeywords = new Set(
  "if then else elif fi for in do done case esac while until function return export local readonly set unset".split(
    " ",
  ),
)

const shellPattern =
  /(#.*$)|('[^']*'?|"(?:\\.|[^"\\])*"?)|(\$\{[^}]*\}?|\$\w+)|(\s--?[\w-]+=?)|(&&|\|\||[|;&<>])|(\b\d+\b)|([^\s'"$|;&<>#]+)/g

function shellLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let position = 0
  let command = true
  for (const match of line.matchAll(shellPattern)) {
    const [text, comment, string, variable, flag, operator, number, word] = match
    if (match.index > position) tokens.push({ text: line.slice(position, match.index) })
    position = match.index + text.length
    if (comment !== undefined && (match.index === 0 || /\s/.test(line[match.index - 1] ?? ""))) {
      tokens.push({ text, tone: "comment" })
    } else if (string !== undefined) tokens.push({ text, tone: "string" })
    else if (variable !== undefined) tokens.push({ text, tone: "property" })
    else if (flag !== undefined) tokens.push({ text, tone: "type" })
    else if (operator !== undefined) {
      tokens.push({ text, tone: "punctuation" })
      command = true
      continue
    } else if (number !== undefined) tokens.push({ text, tone: "number" })
    else if (word !== undefined && shellKeywords.has(word)) {
      tokens.push({ text, tone: "keyword" })
      command = !["in", "export", "local", "readonly"].includes(word)
      continue
    } else if (word !== undefined && command && !word.includes("=")) tokens.push({ text, tone: "function" })
    else tokens.push({ text })
    command = false
  }
  if (position < line.length) tokens.push({ text: line.slice(position) })
  return tokens
}

function diffKind(line: string): DiffKind | undefined {
  if (/^(\+\+\+|---|diff |index )/.test(line)) return "meta"
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("+")) return "inserted"
  if (line.startsWith("-")) return "deleted"
  return undefined
}

/** A language whose parser hasn't loaded yet comes back plain; call `loadParser` and highlight again once it resolves. */
function highlight(code: string, language: CodeLanguage, parser = parsers.get(language)): CodeLine[] {
  if (language === "diff") {
    return code.split("\n").map((line) => ({ tokens: line ? [{ text: line }] : [], diff: diffKind(line) }))
  }
  if (language === "bash" || language === "sh") {
    return code.split("\n").map((line) => ({ tokens: shellLine(line) }))
  }
  return splitLines(parser ? parsed(code, parser) : [{ text: code }])
}

export {
  highlight,
  highlighter as syntaxHighlighter,
  loadParser,
  needsParser,
  normalizeLanguage,
  parserFor,
  syntaxToneOf,
  watchParser,
}
export type { CodeLanguage, CodeLine, CodeToken, DiffKind, SyntaxTone }
