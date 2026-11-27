import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { HELP, HELP_COMMANDS } from "../src/help.ts";

const SKILLS = join(import.meta.dir, "..", "..", "..", "skills");

const DOCUMENTED_COMMANDS = new Set(HELP_COMMANDS);
const DOCUMENTED_FLAGS = new Set(
  [...HELP.matchAll(/--([a-z][a-z0-9-]*)/g)].map((match) => match[1] ?? ""),
);

const WORD_BUDGETS: Record<string, number> = {
  "nf-autoconfigure/SKILL.md": 230,
  "nf-direct/SKILL.md": 260,
  "nf-meta/SKILL.md": 1110,
  "nf-meta/references/routing.md": 650,
  "nf-meta/references/task-contract.md": 950,
  "nf-review/SKILL.md": 280,
  "nf-worker/SKILL.md": 950,
};

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function skillName(path: string): string {
  return relative(SKILLS, path).split(sep).join("/");
}

function commandMentions(text: string): string[] {
  return [...text.matchAll(/\bnf ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)].map((match) => {
    const [, command = "", subcommand] = match;
    return subcommand === undefined ? command : `${command} ${subcommand}`;
  });
}

function flagMentions(text: string): string[] {
  return [...text.matchAll(/--([a-z][a-z0-9-]*)/g)].map((match) => match[1] ?? "");
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("skills match the CLI", () => {
  test("every registered command appears in nf help", () => {
    expect(HELP_COMMANDS.filter((command) => !HELP.includes(command))).toEqual([]);
  });

  test("every nf command and flag mentioned in skills exists", () => {
    const unknown: string[] = [];
    for (const file of markdownFiles(SKILLS)) {
      const text = readFileSync(file, "utf8");
      for (const command of commandMentions(text))
        if (!DOCUMENTED_COMMANDS.has(command)) unknown.push(`${skillName(file)}: nf ${command}`);
      for (const flag of flagMentions(text))
        if (!DOCUMENTED_FLAGS.has(flag)) unknown.push(`${skillName(file)}: --${flag}`);
    }
    expect(unknown).toEqual([]);
  });

  test("skills stay within their word budgets", () => {
    const files = markdownFiles(SKILLS).map(skillName).toSorted();
    expect(files).toEqual(Object.keys(WORD_BUDGETS).toSorted());
    const over = files.flatMap((name) => {
      const words = wordCount(readFileSync(join(SKILLS, name), "utf8"));
      const budget = WORD_BUDGETS[name] ?? 0;
      return words > budget ? [`${name}: ${words} words > ${budget}`] : [];
    });
    expect(over).toEqual([]);
  });
});
