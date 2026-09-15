/**
 * The rows the judge training export must never emit (issue #94): the
 * measurement set of ADR 0004 and every spot-check sample, so the training
 * side cannot train on what the bar is measured on.
 *
 * A spot check is a sitting drawn on the corpus to confirm a grant (#63,
 * #87); its sample experiment is listed here by hand when the check is run,
 * and the manifest names every id, so the training side can verify the
 * exclusion rather than trust it.
 */
import { prisma } from "../../db/prisma.js";
import { HELD_OUT_EXPERIMENT_ID } from "../adjudication-draw.service.js";

/** #63's spot check of the first re-rating batch (seed 63, 125 rows). */
export const SPOT_CHECK_63_EXPERIMENT_ID = "09411bc4-f4be-4024-8d3b-527df01f4aae";
/** #87's spot check of the re-rating batch under production@4892d8d1b160 (125 rows). */
export const SPOT_CHECK_87_EXPERIMENT_ID = "dadf32f4-32c1-49b9-8826-979cf3f831d6";

export const HELD_OUT_EXPERIMENT_IDS: readonly string[] = [
  HELD_OUT_EXPERIMENT_ID,
  SPOT_CHECK_63_EXPERIMENT_ID,
  SPOT_CHECK_87_EXPERIMENT_ID,
];

/** Every example id selected by a held-out experiment, sorted. */
export async function heldOutExampleIds(): Promise<string[]> {
  const rows = await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId: { in: [...HELD_OUT_EXPERIMENT_IDS] } },
    select: { exampleId: true },
  });
  return [...new Set(rows.map((r) => r.exampleId))].sort();
}
