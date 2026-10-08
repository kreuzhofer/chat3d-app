/**
 * The geometry block of a Build123d render response (#137): what the service
 * measured on root_part, the compound written to STEP/STL. The solid count is
 * the measured body count the evaluation checks against the spec's expected
 * body count (ADR 0001's 2026-10-05 amendment).
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("render-geometry");

type Vec3 = [number, number, number];

export interface RenderGeometry {
  /** Separate solids in the exported model; fused parts are one solid. */
  solidCount: number;
  bbox: { min: Vec3; max: Vec3 };
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * The block as the service sent it, or null when there is none: the code had
 * no root_part, the measurement failed, or the service predates the block.
 * A malformed block is logged and read as null, never as a guessed count.
 */
export function parseRenderGeometry(raw: unknown): RenderGeometry | null {
  if (raw === undefined || raw === null) return null;
  const g = raw as { solid_count?: unknown; bbox?: { min?: unknown; max?: unknown } | null };
  const count = g.solid_count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0
      || !g.bbox || !isVec3(g.bbox.min) || !isVec3(g.bbox.max)) {
    logger.warn({ geometry: JSON.stringify(raw).slice(0, 200) }, "malformed geometry block from Build123d — ignored");
    return null;
  }
  return { solidCount: count, bbox: { min: g.bbox.min, max: g.bbox.max } };
}
