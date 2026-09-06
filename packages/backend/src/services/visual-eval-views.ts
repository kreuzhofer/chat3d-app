/**
 * The views the visual judge sees (ADR 0003).
 *
 * Every entry point — the orchestrator, the agent's in-loop evaluation,
 * curation promotion, experiments, re-rating — sends the same eight views in
 * the same order, so two evaluations of one example are comparable by
 * construction rather than by recording which views were sent. The screenshot
 * service renders more (an isometric pair the UI shows); those never reach
 * the judge.
 */

export const STANDARD_VIEWS = [
  "front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom",
] as const;

export type StandardView = (typeof STANDARD_VIEWS)[number];

/** How each view is labelled in the judge's user message. */
export const VIEW_LABELS: Record<StandardView, string> = {
  front: "Front view",
  back: "Back view",
  left: "Left view",
  right: "Right view",
  top: "Top view",
  bottom: "Bottom view",
  ortho_45: "45° down view",
  ortho_45_bottom: "45° up view",
};

/** The eight standard views were not all supplied; `missing` names the gap. */
export class MissingViewsError extends Error {
  constructor(public readonly missing: string[], public readonly provided: string[]) {
    super(
      `The visual judge needs the eight standard views; missing: ${missing.join(", ")} ` +
      `(provided: ${provided.length ? provided.join(", ") : "none"})`,
    );
    this.name = "MissingViewsError";
  }
}

/**
 * The eight standard views out of whatever was rendered, in canonical order.
 * Extra angles (isometric, isometric_back) are dropped. A missing or
 * duplicated standard view is an error, never a shorter prompt: the judge
 * would then answer under the instrument's promise of eight views with fewer.
 */
export function selectStandardViews<T extends { angle: string }>(images: T[]): T[] {
  const byAngle = new Map<string, T>();
  for (const img of images) {
    if (byAngle.has(img.angle)) {
      throw new Error(`Duplicate view "${img.angle}" supplied to the visual judge`);
    }
    byAngle.set(img.angle, img);
  }
  const missing = STANDARD_VIEWS.filter((v) => !byAngle.has(v));
  if (missing.length > 0) {
    throw new MissingViewsError(missing, images.map((i) => i.angle));
  }
  return STANDARD_VIEWS.map((v) => byAngle.get(v)!);
}
