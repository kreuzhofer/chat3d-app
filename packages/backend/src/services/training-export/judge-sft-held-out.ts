/**
 * The rows the judge training export must never emit (issue #94): the
 * measurement set of ADR 0004 and every spot-check sample, so the training
 * side cannot train on what the bar is measured on.
 *
 * A spot check is a sitting drawn on the corpus to confirm a grant (#63,
 * #87); its sample experiment is listed here by hand when the check is run,
 * and the manifest names every id, so the training side can verify the
 * exclusion rather than trust it.
 *
 * The cut is by prompt as well as by id (issue #95): another generation of
 * a held-out prompt shares its prompt and checklist with the measurement
 * set, so it is held out too. The manifest names those siblings separately.
 */
import { prisma } from "../../db/prisma.js";
import { HELD_OUT_EXPERIMENT_ID } from "../adjudication-draw.service.js";

/** #63's spot check of the first re-rating batch (seed 63, 125 rows). */
export const SPOT_CHECK_63_EXPERIMENT_ID = "09411bc4-f4be-4024-8d3b-527df01f4aae";
/** #87's spot check of the re-rating batch under production@4892d8d1b160 (125 rows). */
export const SPOT_CHECK_87_EXPERIMENT_ID = "dadf32f4-32c1-49b9-8826-979cf3f831d6";

/** #112's reference measurement: GLM-5.3-Flash and Kimi K3 on 250 corpus rows (seed 112), reserved until the sitting is decided. */
export const REFERENCE_112_GLM_EXPERIMENT_ID = "518373e9-8cb8-400a-9ff0-304ccc7bb6a1";
export const REFERENCE_112_KIMI_EXPERIMENT_ID = "052c393c-1e94-476b-9264-27ec68aec63d";

export const HELD_OUT_EXPERIMENT_IDS: readonly string[] = [
  HELD_OUT_EXPERIMENT_ID,
  SPOT_CHECK_63_EXPERIMENT_ID,
  SPOT_CHECK_87_EXPERIMENT_ID,
  REFERENCE_112_GLM_EXPERIMENT_ID,
  REFERENCE_112_KIMI_EXPERIMENT_ID,
];

/** Every example id selected by a held-out experiment, sorted. */
export async function heldOutExampleIds(): Promise<string[]> {
  const rows = await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId: { in: [...HELD_OUT_EXPERIMENT_IDS] } },
    select: { exampleId: true },
  });
  return [...new Set(rows.map((r) => r.exampleId))].sort();
}

export interface HeldOutRows {
  /** The measurement set and the spot-check samples, by example id, sorted. */
  exampleIds: string[];
  /** The prompts those examples were generated from, sorted. */
  promptIds: string[];
  /** Other examples of those prompts, not themselves selected, sorted. */
  siblingExampleIds: string[];
}

/** Pure: the held-out prompts and their other generations among `rows`. */
export function siblingsByPrompt(
  heldOut: ReadonlySet<string>,
  rows: ReadonlyArray<{ id: string; promptId: string }>,
): Pick<HeldOutRows, "promptIds" | "siblingExampleIds"> {
  const promptIds = new Set(rows.filter((r) => heldOut.has(r.id)).map((r) => r.promptId));
  const siblings = rows.filter((r) => promptIds.has(r.promptId) && !heldOut.has(r.id)).map((r) => r.id);
  return { promptIds: [...promptIds].sort(), siblingExampleIds: [...new Set(siblings)].sort() };
}

/** The held-out ids widened by prompt; the union is what the export cuts. */
export async function heldOutRows(): Promise<HeldOutRows> {
  const exampleIds = await heldOutExampleIds();
  const heldOut = new Set(exampleIds);
  const promptIds = await prisma.workbenchExample.findMany({
    where: { id: { in: exampleIds } }, select: { promptId: true },
  });
  const rows = await prisma.workbenchExample.findMany({
    where: { promptId: { in: [...new Set(promptIds.map((r) => r.promptId))] } },
    select: { id: true, promptId: true },
  });
  return { exampleIds, ...siblingsByPrompt(heldOut, rows) };
}
