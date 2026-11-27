import { extname, matchesGlob } from "node:path";
import { UI_CHANGE_SIZE, UI_REVIEW_DECISION } from "@nf/contracts";
import type { UiChangeSize, UiReviewDecision } from "@nf/contracts";

/** The `task_events` kind that records what an acceptance decided about a `ui` task's change. */
export const UI_CHANGE_EVENT = "ui_change";

/** The project's `ui.review`: which paths count, the size thresholds and the kinds that never pass silently. */
export interface UiReviewPolicy {
  readonly paths: readonly string[];
  readonly maxChangedLines: number;
  readonly maxChangedFiles: number;
  readonly newScreens: UiReviewDecision;
  readonly themeOrTokens: UiReviewDecision;
}

/** The thresholds a `ui.review` block that leaves them out uses. */
export const DEFAULT_UI_REVIEW: UiReviewPolicy = {
  paths: ["**"],
  maxChangedLines: 150,
  maxChangedFiles: 6,
  newScreens: UI_REVIEW_DECISION.HUMAN,
  themeOrTokens: UI_REVIEW_DECISION.HUMAN,
};

const SCREEN_EXTENSIONS: ReadonlySet<string> = new Set([".tsx", ".jsx", ".vue", ".svelte"]);
const SCREEN_WORDS: ReadonlySet<string> = new Set([
  "page",
  "pages",
  "screen",
  "screens",
  "route",
  "routes",
  "tab",
  "tabs",
  "dialog",
  "dialogs",
  "modal",
  "modals",
]);
const THEME_PATTERNS = [
  "**/*theme*.css",
  "**/*tokens*.css",
  "**/globals.css",
  "**/themes/**",
] as const;

/** One changed path of a git diff: its line count, and whether the change added the file. */
export interface ChangedFile {
  readonly path: string;
  readonly lines: number;
  readonly added: boolean;
}

export interface UiChange {
  readonly size: UiChangeSize;
  readonly lines: number;
  readonly files: number;
  /** What made the change large, e.g. `new screen src/routes/settings.tsx`. */
  readonly reasons: readonly string[];
  /** One short line, e.g. `small (42 lines, 2 files)`; readers add the `UI change:` label. */
  readonly text: string;
}

/** The globs apply in order, so a `!` glob removes what an earlier one included. */
export function isUiPath(path: string, patterns: readonly string[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const glob = negated ? pattern.slice(1) : pattern;
    if (glob.length === 0) continue;
    if (matchesGlob(path, glob)) included = !negated;
  }
  return included;
}

const pathWords = (path: string): string[] =>
  path
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

const isNewScreen = (file: ChangedFile): boolean =>
  file.added &&
  SCREEN_EXTENSIONS.has(extname(file.path).toLowerCase()) &&
  pathWords(file.path).some((word) => SCREEN_WORDS.has(word));

const isThemeOrTokens = (file: ChangedFile): boolean =>
  THEME_PATTERNS.some((pattern) => matchesGlob(file.path.toLowerCase(), pattern));

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

const pathsReason = (label: string, paths: readonly string[]): string => {
  const listed = paths.slice(0, 2).join(", ");
  return `${label} ${listed}${paths.length > 2 ? ` and ${String(paths.length - 2)} more` : ""}`;
};

/**
 * Small or large over the project's UI paths: a new screen or a theme/token style needs a person,
 * and so does a change past `maxChangedLines` or `maxChangedFiles`.
 */
export function classifyUiChange(files: readonly ChangedFile[], policy: UiReviewPolicy): UiChange {
  const ui = files.filter((file) => isUiPath(file.path, policy.paths));
  const lines = ui.reduce((total, file) => total + file.lines, 0);
  const reasons: string[] = [];
  const screens = ui.filter(isNewScreen).map((file) => file.path);
  const themes = ui.filter(isThemeOrTokens).map((file) => file.path);
  if (policy.newScreens === UI_REVIEW_DECISION.HUMAN && screens.length > 0) {
    reasons.push(pathsReason("new screen", screens));
  }
  if (policy.themeOrTokens === UI_REVIEW_DECISION.HUMAN && themes.length > 0) {
    reasons.push(pathsReason("theme or tokens", themes));
  }
  if (lines > policy.maxChangedLines) {
    reasons.push(`${plural(lines, "line")} over maxChangedLines ${String(policy.maxChangedLines)}`);
  }
  if (ui.length > policy.maxChangedFiles) {
    reasons.push(
      `${plural(ui.length, "file")} over maxChangedFiles ${String(policy.maxChangedFiles)}`,
    );
  }
  const size = reasons.length === 0 ? UI_CHANGE_SIZE.SMALL : UI_CHANGE_SIZE.LARGE;
  const counts = `${plural(lines, "line")}, ${plural(ui.length, "file")}`;
  const text =
    size === UI_CHANGE_SIZE.SMALL ? `${size} (${counts})` : `${size} (${reasons.join("; ")})`;
  return { size, lines, files: ui.length, reasons, text };
}
