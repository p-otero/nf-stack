// Prebuilds the NF Board into one self-contained HTML template for `nf board`.
// Tailwind is compiled here (Bun's HTML bundler has no Tailwind step), React is bundled with
// Bun's browser target, and both are inlined so a snapshot only has to inject its data JSON.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { pageProblems, reactDevBanner } from "./page-checks.mjs";

const board = resolve(import.meta.dirname, "..");
const source = join(board, "src");
const output = join(board, "dist", "index.html");
const cssPath = join(source, "index.css");
const fontPackages = ["geist", "geist-mono"].map((name) =>
  dirname(
    createRequire(join(board, "package.json")).resolve(`@fontsource-variable/${name}/package.json`),
  ),
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function compileCss() {
  const { compile } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  const compiler = await compile(readFileSync(cssPath, "utf8"), {
    base: source,
    from: cssPath,
    onDependency: () => {},
  });
  return compiler.build(new Scanner({ sources: compiler.sources }).scan());
}

/**
 * Tailwind inlines the font packages' @font-face rules but keeps the files as relative URLs, which
 * a page opened from `file://` would still have to request. Carry their bytes in the stylesheet.
 */
function inlineFonts(css) {
  return css.replaceAll(/url\(\s*(["']?)(\.\/files\/[^)"']+)\1\s*\)/g, (_match, _quote, file) => {
    const path = fontPackages
      .map((dir) => join(dir, file))
      .find((candidate) => existsSync(candidate));
    if (path === undefined) fail(`${file} is missing from ${fontPackages.join(", ")}`);
    return `url("data:font/woff2;base64,${readFileSync(path).toString("base64")}")`;
  });
}

/**
 * React reads `process.env.NODE_ENV` while it loads, so a caller's NODE_ENV=development would ship
 * the development build (and its DevTools banner) into a page nobody can debug. The define wins over
 * the ambient value, so the bundle is the production one whatever the shell asked for.
 */
const NODE_ENV = "process.env.NODE_ENV";

function bundleJavaScript(work) {
  const outdir = join(work, "out");
  const build = spawnSync(
    "bun",
    [
      "build",
      join(source, "main.tsx"),
      "--target=browser",
      "--production",
      "--minify",
      `--define=${NODE_ENV}="production"`,
      `--outdir=${outdir}`,
    ],
    { cwd: board, encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } },
  );
  if (build.status !== 0) fail(`bun build failed:\n${build.stdout}${build.stderr}`);
  const files = readdirSync(outdir).filter((name) => name.endsWith(".js"));
  if (files.length !== 1) fail(`expected one JavaScript bundle, got ${files.join(", ") || "none"}`);
  const js = readFileSync(join(outdir, files[0]), "utf8");
  const banner = reactDevBanner(js);
  if (banner !== undefined) fail(`${output} bundles the React development build (${banner})`);
  return js;
}

/** `</script` inside a string would close the element early; the escape is identical JavaScript. */
const inlineScript = (js) => js.replaceAll(/<\/script/gi, "<\\/script");

function assemble(css, js) {
  return readFileSync(join(source, "index.html"), "utf8")
    .replace("<!-- nf-board-style -->", () => `<style>${css}</style>`)
    .replace(
      "<!-- nf-board-script -->",
      () => `<script type="module">${inlineScript(js)}</script>`,
    );
}

function assertPage(page) {
  for (const problem of pageProblems(page)) fail(`${output} ${problem}`);
}

const work = mkdtempSync(join(tmpdir(), "nf-board-build-"));
try {
  const css = inlineFonts(await compileCss());
  const page = assemble(css, bundleJavaScript(work));
  assertPage(page);
  mkdirSync(join(board, "dist"), { recursive: true });
  writeFileSync(output, page);
  console.log(`${output}: ${(statSync(output).size / 1024).toFixed(0)} KiB`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
