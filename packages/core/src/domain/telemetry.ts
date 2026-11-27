import { TELEMETRY_COLORS } from "@nf/contracts";

/** FNV-1a over the id's code units: small, stable, and independent of row order. */
function hash(id: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    value = Math.imul(value ^ id.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

/**
 * The 1-based `--chart-<n>` token an id hashes to. Used for the views that hold more entities than
 * the palette has colours, where an entity should keep its colour as others come and go.
 */
export function hashedColorIndex(id: string): number {
  return (hash(id) % TELEMETRY_COLORS) + 1;
}

/**
 * The `--chart-<n>` index of every entity of one view. While the ids fit the palette they are
 * numbered in sorted order, so one view never paints two entities the same; beyond that they fall
 * back to their own hash, which can repeat.
 */
export function colorIndexes(ids: readonly string[]): ReadonlyMap<string, number> {
  const unique = [...new Set(ids)].toSorted();
  if (unique.length > TELEMETRY_COLORS) {
    return new Map(unique.map((id) => [id, hashedColorIndex(id)]));
  }
  return new Map(unique.map((id, position) => [id, position + 1]));
}
