#!/usr/bin/env node
// Thin shim: Node strips the types of ../src/main.ts at load time.
// node:sqlite prints an ExperimentalWarning on import; drop only that one.
const emit = (...args) => process.emitWarning(...args);
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === "string" ? warning : (warning?.message ?? "");
  if (text.startsWith("SQLite is an experimental")) return;
  emit(warning, ...rest);
};
const { main } = await import("../src/main.ts");
process.exitCode = await main(process.argv.slice(2));
