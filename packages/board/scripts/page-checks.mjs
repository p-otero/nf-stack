// Rules for the assembled page: the snapshot opens from `file://` with no network, and hosts that
// size a frame to its content (T3's preview) reject any viewport-height unit anywhere in the page,
// class strings in the inlined bundle included, so the page takes its height from its content.
const DATA_MARKER = "<!-- nf-board-data -->";
const VIEWPORT_HEIGHT_UNIT = /\b\d+(\.\d+)?[dls]?vh\b|\b(min-|max-)?h-(screen|[dls]?vh)\b/;
const REACT_DEV_BANNER = /Download the React DevTools[^"`]{0,40}/;

/** The first viewport-height unit or class in the page, `undefined` when there is none. */
export function viewportHeightUnit(page) {
  return page.match(VIEWPORT_HEIGHT_UNIT)?.[0];
}

/** The React DevTools banner of a development build, `undefined` in a production bundle. */
export function reactDevBanner(bundle) {
  return bundle.match(REACT_DEV_BANNER)?.[0];
}

/** Everything that keeps the page from shipping, as `message` fragments; empty when it can. */
export function pageProblems(page) {
  const markup = page.replaceAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const styles = [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const problems = [
    [markup, /<script[^>]+src=/i, "an external script"],
    [markup, /<link[^>]+rel="?(stylesheet|preload|modulepreload)/i, "an external stylesheet"],
    // Fonts and images ship as inlined bytes; any other URL would be a file:// request. The
    // lookahead reads through the optional quote, so url("data:...") does not match.
    [styles, /url\((?!\s*["']?data:)/i, "an asset that is not inlined"],
  ]
    .filter(([text, pattern]) => pattern.test(text))
    .map(([, pattern, what]) => `still loads ${what} (${pattern})`);
  const viewportUnit = viewportHeightUnit(page);
  if (!page.includes(DATA_MARKER)) problems.push(`lost the ${DATA_MARKER} placeholder`);
  if (viewportUnit !== undefined) problems.push(`uses a viewport height unit: ${viewportUnit}`);
  return problems;
}
