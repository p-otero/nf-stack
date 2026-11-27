import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { parse } from "yaml";
import { NfError, PROJECT_CONFIG_KEYS, ProjectConfig, UI_REVIEW_KEYS } from "@nf/contracts";
import type { AttachmentTheme, ProjectStage, UiReview } from "@nf/contracts";
import { errorText } from "../domain/errors.ts";
import { formatIssuePaths } from "../domain/schema-errors.ts";
import { DEFAULT_UI_REVIEW } from "../domain/ui-change.ts";
import type { UiReviewPolicy } from "../domain/ui-change.ts";
import { isRecord } from "../domain/validate.ts";

/** One configured environment, in the order the file lists it. */
export interface ProjectStageSpec {
  readonly id: string;
  readonly label: string;
  readonly tone: string | null;
  readonly branch: string | null;
  readonly tag: string | null;
}

export interface ResolvedProjectConfig {
  readonly t3DeepLinks: boolean;
  readonly defaultBranch: string | null;
  /** Empty: the default `branch` -> `pr` -> `merged` progression. */
  readonly stages: readonly ProjectStageSpec[];
  /** The themes a `ui` task captures, in the order the evidence is asked for. */
  readonly themes: readonly AttachmentTheme[];
  /** Who accepts a `ui` task's change; null without `ui.review`, which always needs the user. */
  readonly uiReview: UiReviewPolicy | null;
}

export const DEFAULT_PROJECT_CONFIG: ResolvedProjectConfig = {
  t3DeepLinks: true,
  defaultBranch: null,
  stages: [],
  themes: ["light", "dark"],
  uiReview: null,
};

/** `$NF_HOME/projects/<prefix>.yaml`, beside the store; untracked by the project. */
export function projectConfigFile(home: string, prefix: string): string {
  return join(home, "projects", `${prefix}.yaml`);
}

const STAGE_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const RESERVED_STAGE_IDS: ReadonlySet<string> = new Set(["branch", "pr", "merged", "none"]);

const invalidConfig = (source: string, issues: readonly string[]) =>
  new NfError({
    code: "invalid_project_config",
    message: `invalid project config ${source}:\n  ${issues.join("\n  ")}`,
  });

const decodeConfig = Schema.decodeUnknownResult(ProjectConfig);

const trimmed = (value: string | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
};

/** Rules the Schema cannot express, reported with the same `path: message` shape as the policy. */
function stageIssues(id: string, stage: ProjectStage): string[] {
  const issues: string[] = [];
  const path = `stages.${id}`;
  if (!STAGE_ID.test(id)) {
    issues.push(`${path}: stage ids are lowercase letters, digits, '-' and '_'`);
  } else if (RESERVED_STAGE_IDS.has(id)) {
    issues.push(`${path}: '${id}' is a built-in stage`);
  }
  const branch = trimmed(stage.branch);
  const tag = trimmed(stage.tag);
  if ((branch === null) === (tag === null)) {
    issues.push(`${path}: set exactly one of branch and tag`);
  }
  if (stage.label !== undefined && trimmed(stage.label) === null) {
    issues.push(`${path}.label: must not be empty`);
  }
  return issues;
}

function selectorIssues(stages: Readonly<Record<string, ProjectStage>>): string[] {
  const issues: string[] = [];
  const seen = new Map<string, string>();
  for (const [id, stage] of Object.entries(stages)) {
    const branch = trimmed(stage.branch);
    const tag = trimmed(stage.tag);
    const selector = branch === null ? null : `branch ${branch}`;
    const tagSelector = tag === null ? null : `tag ${tag}`;
    for (const value of [selector, tagSelector]) {
      if (value === null) continue;
      const first = seen.get(value);
      if (first === undefined) seen.set(value, id);
      else issues.push(`stages.${id}: ${value} is already used by stages.${first}`);
    }
  }
  return issues;
}

function documentIssues(document: unknown, config: ProjectConfig): string[] {
  const issues: string[] = [];
  if (isRecord(document)) {
    for (const key of Object.keys(document)) {
      if (!(PROJECT_CONFIG_KEYS as readonly string[]).includes(key)) {
        issues.push(`${key}: unknown key (one of ${PROJECT_CONFIG_KEYS.join("|")})`);
      }
    }
  }
  if (config.defaultBranch !== undefined && trimmed(config.defaultBranch) === null) {
    issues.push("defaultBranch: must not be empty");
  }
  const themes = config.ui?.themes;
  if (themes !== undefined) {
    if (themes.length === 0) issues.push("ui.themes: list at least one theme");
    if (new Set(themes).size !== themes.length) issues.push("ui.themes: duplicate theme");
  }
  issues.push(...reviewIssues(config.ui?.review, reviewDocument(document)));
  const stages = config.stages ?? {};
  for (const [id, stage] of Object.entries(stages)) issues.push(...stageIssues(id, stage));
  issues.push(...selectorIssues(stages));
  return issues;
}

/** `ui.review` as the file wrote it, for keys the schema silently drops. */
const reviewDocument = (document: unknown): unknown =>
  isRecord(document) && isRecord(document["ui"]) ? document["ui"]["review"] : undefined;

function reviewIssues(review: UiReview | undefined, document: unknown): string[] {
  if (review === undefined) return [];
  const issues: string[] = [];
  if (isRecord(document)) {
    for (const key of Object.keys(document)) {
      if (!(UI_REVIEW_KEYS as readonly string[]).includes(key)) {
        issues.push(`ui.review.${key}: unknown key (one of ${UI_REVIEW_KEYS.join("|")})`);
      }
    }
  }
  if (review.paths !== undefined) {
    if (review.paths.length === 0) {
      issues.push("ui.review.paths: list at least one path glob");
    }
    for (const pattern of review.paths) {
      if (pattern.replace(/^!/, "").length === 0) {
        issues.push("ui.review.paths: a path glob must not be empty");
      }
    }
  }
  if (review.maxChangedLines !== undefined && review.maxChangedLines < 0) {
    issues.push("ui.review.maxChangedLines: must not be negative");
  }
  if (review.maxChangedFiles !== undefined && review.maxChangedFiles < 0) {
    issues.push("ui.review.maxChangedFiles: must not be negative");
  }
  return issues;
}

function resolveConfig(config: ProjectConfig): ResolvedProjectConfig {
  const stages = Object.entries(config.stages ?? {}).map(([id, stage]) => ({
    id,
    label: trimmed(stage.label) ?? id,
    tone: trimmed(stage.tone),
    branch: trimmed(stage.branch),
    tag: trimmed(stage.tag),
  }));
  return {
    t3DeepLinks: config.t3DeepLinks ?? true,
    defaultBranch: trimmed(config.defaultBranch),
    stages,
    themes: config.ui?.themes ?? DEFAULT_PROJECT_CONFIG.themes,
    uiReview: resolveReview(config.ui?.review),
  };
}

/** `ui.review` present means the thresholds apply; absent keeps every `ui` task on the user. */
function resolveReview(review: UiReview | undefined): UiReviewPolicy | null {
  if (review === undefined) return null;
  return {
    paths: review.paths ?? DEFAULT_UI_REVIEW.paths,
    maxChangedLines: review.maxChangedLines ?? DEFAULT_UI_REVIEW.maxChangedLines,
    maxChangedFiles: review.maxChangedFiles ?? DEFAULT_UI_REVIEW.maxChangedFiles,
    newScreens: review.newScreens ?? DEFAULT_UI_REVIEW.newScreens,
    themeOrTokens: review.themeOrTokens ?? DEFAULT_UI_REVIEW.themeOrTokens,
  };
}

const yamlErrorLine = (error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.split("\n")[0] ?? "invalid YAML";
};

/** Parse and validate the project config YAML; every problem is a `path: message` line. */
export const parseProjectConfig = Effect.fn("ProjectConfig.parse")(function* (
  text: string,
  source: string,
) {
  const document = yield* Effect.try({
    try: (): unknown => parse(text),
    catch: (error) => invalidConfig(source, [`yaml: ${yamlErrorLine(error)}`]),
  });
  const decoded = decodeConfig(document === null ? {} : document);
  if (Result.isFailure(decoded)) {
    return yield* invalidConfig(source, formatIssuePaths(decoded.failure.issue));
  }
  const issues = documentIssues(document, decoded.success);
  if (issues.length > 0) return yield* invalidConfig(source, issues);
  return resolveConfig(decoded.success);
});

/** The project's config file, or the defaults when it does not exist. */
export const loadProjectConfig = Effect.fn("ProjectConfig.load")(function* (
  home: string,
  prefix: string,
) {
  const file = projectConfigFile(home, prefix);
  if (!existsSync(file)) return DEFAULT_PROJECT_CONFIG;
  const text = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (error) => invalidConfig(file, [`cannot be read: ${errorText(error)}`]),
  });
  return yield* parseProjectConfig(text, file);
});
