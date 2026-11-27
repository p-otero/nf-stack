import * as SchemaIssue from "effect/SchemaIssue";

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** One `a.b[0].c: message` line per problem, for the validation errors nf prints. */
export function formatIssuePaths(issue: SchemaIssue.Issue, prefix = ""): string[] {
  return formatter(issue).issues.map(({ message, path }) => {
    const where = [prefix, ...(path ?? []).map(String)].filter((p) => p.length > 0);
    let text = "";
    for (const [index, segment] of where.entries()) {
      const numeric = /^\d+$/.test(segment);
      text = numeric ? `${text}[${segment}]` : index === 0 ? segment : `${text}.${segment}`;
    }
    return text.length > 0 ? `${text}: ${message}` : message;
  });
}
