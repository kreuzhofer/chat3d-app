/**
 * Stable color mapping for experiment runs.
 * The canonical run order (e.g. experiment.runs) defines color assignment;
 * pass the resulting map to every chart so a given modelLabel renders in the
 * same color everywhere.
 */

export const COLOR_PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function buildColorMapByLabel(items: ReadonlyArray<{ modelLabel: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const it of items) {
    if (!map.has(it.modelLabel)) {
      map.set(it.modelLabel, COLOR_PALETTE[map.size % COLOR_PALETTE.length]);
    }
  }
  return map;
}

export function colorFor(map: Map<string, string>, label: string): string {
  return map.get(label) ?? COLOR_PALETTE[0];
}

/**
 * Sort items by the canonical run order. The canonical order is the insertion
 * order of `colorMap` keys — i.e. the order in which modelLabels were first
 * seen when the map was built. Unknown labels sort to the end.
 */
export function sortByLabelOrder<T extends { modelLabel: string }>(
  items: ReadonlyArray<T>,
  colorMap: Map<string, string>,
): T[] {
  const order = [...colorMap.keys()];
  const rank = (label: string) => {
    const i = order.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...items].sort((a, b) => rank(a.modelLabel) - rank(b.modelLabel));
}
