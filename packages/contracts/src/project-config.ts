import * as Schema from "effect/Schema";
import { AttachmentTheme } from "./attempt.ts";

/** One ordered environment stage; exactly one of `branch` and `tag` selects the ref that contains it. */
export const ProjectStage = Schema.Struct({
  branch: Schema.optionalKey(Schema.String),
  tag: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  tone: Schema.optionalKey(Schema.String),
});
export type ProjectStage = typeof ProjectStage.Type;

export const PROJECT_CONFIG_KEYS = ["t3DeepLinks", "defaultBranch", "stages", "ui"] as const;

/** Who decides a change the project marks as needing attention: the user, or the size thresholds. */
export const UI_REVIEW_DECISION = { HUMAN: "human", COORDINATOR: "coordinator" } as const;
export type UiReviewDecision = (typeof UI_REVIEW_DECISION)[keyof typeof UI_REVIEW_DECISION];
export const UiReviewDecision = Schema.Literals(Object.values(UI_REVIEW_DECISION));

export const UI_REVIEW_KEYS = [
  "paths",
  "maxChangedLines",
  "maxChangedFiles",
  "newScreens",
  "themeOrTokens",
] as const;

/**
 * When a `ui` task's interface change is small enough for the coordinator to accept it: the paths
 * that count as interface change, the size thresholds, and the kinds that always need a person.
 */
export const UiReview = Schema.Struct({
  /** Globs of the changed paths that count as interface change; a `!` glob removes a match. */
  paths: Schema.optionalKey(Schema.Array(Schema.String)),
  maxChangedLines: Schema.optionalKey(Schema.Int),
  maxChangedFiles: Schema.optionalKey(Schema.Int),
  /** New route, page, screen, tab, dialog or modal components. */
  newScreens: Schema.optionalKey(UiReviewDecision),
  /** Theme and design-token styles. */
  themeOrTokens: Schema.optionalKey(UiReviewDecision),
});
export type UiReview = typeof UiReview.Type;

/** The project's UI evidence: which themes a `ui` task captures, and who reviews its change. */
export const ProjectUi = Schema.Struct({
  themes: Schema.optionalKey(Schema.Array(AttachmentTheme)),
  review: Schema.optionalKey(UiReview),
});
export type ProjectUi = typeof ProjectUi.Type;

/** `$NF_HOME/projects/<prefix>.yaml`; every key is optional. */
export const ProjectConfig = Schema.Struct({
  /** On by default; set false to keep the attempt's recorded thread link. */
  t3DeepLinks: Schema.optionalKey(Schema.Boolean),
  /** The branch a merge lands on when the project config does not set it; detected from git otherwise. */
  defaultBranch: Schema.optionalKey(Schema.String),
  stages: Schema.optionalKey(Schema.Record(Schema.String, ProjectStage)),
  ui: Schema.optionalKey(ProjectUi),
});
export type ProjectConfig = typeof ProjectConfig.Type;
