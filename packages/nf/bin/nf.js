#!/usr/bin/env node
// The bundle is plain JavaScript: Node refuses to strip types under node_modules.
// node:sqlite prints an ExperimentalWarning on import; drop only that one.
const emit = (...args) => process.emitWarning(...args);
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === "string" ? warning : (warning?.message ?? "");
  if (text.startsWith("SQLite is an experimental")) return;
  emit(warning, ...rest);
};
const { main } = await import("../dist/main.js");
process.exitCode = await main(process.argv.slice(2));
