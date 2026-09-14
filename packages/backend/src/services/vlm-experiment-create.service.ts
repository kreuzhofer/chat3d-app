/**
 * Creating a VLM comparison experiment: which examples, which judges, and
 * under which instrument (issue #35).
 *
 * A run is one model under one instrument. Without judge-prompt variants an
 * experiment is one run per model under production's instrument, exactly as
 * before; with variants it is one run per model and variant, so two variants
 * over the same examples are two runs whose results compare directly.
 */
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";
import { validateInstrumentTemplate } from "./visual-eval-instrument.service.js";
import { isResponseShape, RESPONSE_SHAPES, type ResponseShape } from "./visual-eval-schema.service.js";
import {
  getVlmExperiment,
  queryEligibleExamples,
  selectIds,
  validateCategories,
  validateModels,
} from "./vlm-experiment.service.js";

const logger = createLogger("vlm-experiment");

// ── Judge-prompt variants ────────────────────────────────────────────

export interface JudgePromptVariantInput {
  /** Short grouping key recorded on every run and result: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. */
  id: string;
  /** The instrument: a template over the specimen slots. */
  template: string;
  /**
   * The answer shape the variant asks for; production's when omitted. A
   * variant that asks for something production's schema has no room for —
   * the parts inventory of issue #66 — must say so, because the schema is
   * the decoding grammar on vLLM and the template alone cannot widen it.
   */
  responseShape?: ResponseShape;
}

const VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Rejects (400) anything that would produce an ambiguous or unrenderable run. */
export function validateJudgePromptVariants(variants: JudgePromptVariantInput[]): void {
  if (variants.length === 0) {
    throw new ExperimentError("judgePromptVariants needs at least one variant; omit it to use production's instrument", 400);
  }
  const seen = new Set<string>();
  for (const v of variants) {
    if (typeof v.id !== "string" || !VARIANT_ID.test(v.id)) {
      throw new ExperimentError(`Variant id ${JSON.stringify(v.id)} must match ${VARIANT_ID}`, 400);
    }
    if (seen.has(v.id)) throw new ExperimentError(`Duplicate variant id "${v.id}"`, 400);
    seen.add(v.id);
    const errors = validateInstrumentTemplate(typeof v.template === "string" ? v.template : "");
    if (errors.length > 0) {
      throw new ExperimentError(`Variant "${v.id}" is not a valid instrument: ${errors.join("; ")}`, 400);
    }
    if (v.responseShape !== undefined && !isResponseShape(v.responseShape)) {
      throw new ExperimentError(
        `Variant "${v.id}" has responseShape ${JSON.stringify(v.responseShape)}; known shapes: ${RESPONSE_SHAPES.join(", ")}`,
        400,
      );
    }
  }
}

// ── Run planning ─────────────────────────────────────────────────────

export interface PlannedRun {
  modelId: string;
  modelLabel: string;
  runOrder: number;
  judgePromptVariantId: string | null;
  judgePromptTemplate: string | null;
  judgeResponseShape: string | null;
}

interface ModelForRun {
  id: string;
  displayName: string | null;
  provider: string;
  modelName: string;
}

/** One run per model; with variants, one per model and variant, model-major, in the order given. */
export function planVlmRuns(models: ModelForRun[], variants: JudgePromptVariantInput[] | undefined): PlannedRun[] {
  const instruments: Array<JudgePromptVariantInput | null> = variants && variants.length > 0 ? variants : [null];
  const runs: PlannedRun[] = [];
  for (const model of models) {
    for (const variant of instruments) {
      runs.push({
        modelId: model.id,
        modelLabel: model.displayName || `${model.provider}/${model.modelName}`,
        runOrder: runs.length + 1,
        judgePromptVariantId: variant?.id ?? null,
        judgePromptTemplate: variant?.template ?? null,
        judgeResponseShape: variant?.responseShape ?? null,
      });
    }
  }
  return runs;
}

// ── Create ──────────────────────────────────────────────────────────

export interface CreateVlmExperimentInput {
  name: string;
  /** A seeded draw: `exampleCount` examples from these categories. */
  categoryIds?: string[];
  exampleCount?: number;
  exampleSeed?: number;
  /**
   * A fixed selection instead of a draw, judged in this order (#63: the
   * spot check's sample from a re-rating batch). Excludes the three above;
   * the experiment records the categories the examples span, seed 0.
   */
  exampleIds?: string[];
  modelIds: string[];
  /** Optional instruments to judge under; omitted = production's (issue #35). */
  judgePromptVariants?: JudgePromptVariantInput[];
  createdBy: string;
}

interface ResolvedSelection { categoryIds: string[]; selectedIds: string[]; exampleCount: number; exampleSeed: number }

/** A fixed list: every id must exist and be judgeable (screenshots stored). */
async function resolveFixedSelection(exampleIds: string[]): Promise<ResolvedSelection> {
  if (exampleIds.length === 0) throw new ExperimentError("exampleIds must name at least one example", 400);
  if (new Set(exampleIds).size !== exampleIds.length) throw new ExperimentError("exampleIds must not repeat an example", 400);
  const rows = await prisma.workbenchExample.findMany({
    where: { id: { in: exampleIds } },
    select: { id: true, screenshotFront: true, promptRef: { select: { categoryId: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = exampleIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new ExperimentError(`Examples not found: ${missing.join(", ")}`, 404);
  const unjudgeable = exampleIds.filter((id) => !byId.get(id)!.screenshotFront);
  if (unjudgeable.length > 0) throw new ExperimentError(`Examples without screenshots: ${unjudgeable.join(", ")}`, 400);
  const categoryIds = [...new Set(exampleIds.map((id) => byId.get(id)!.promptRef.categoryId))];
  return { categoryIds, selectedIds: exampleIds, exampleCount: exampleIds.length, exampleSeed: 0 };
}

/** The seeded draw from categories, as before. */
async function resolveSeededSelection(categoryIds: string[], exampleCount: number, exampleSeed: number): Promise<ResolvedSelection> {
  await validateCategories(categoryIds);
  const allExampleIds = await queryEligibleExamples(categoryIds);
  if (allExampleIds.length === 0) throw new ExperimentError("Selected categories have no examples with screenshots", 400);
  if (exampleCount > allExampleIds.length) {
    throw new ExperimentError(`Requested ${exampleCount} examples but only ${allExampleIds.length} eligible`, 400);
  }
  return { categoryIds, selectedIds: selectIds(allExampleIds, exampleCount, exampleSeed), exampleCount, exampleSeed };
}

async function resolveSelection(input: CreateVlmExperimentInput): Promise<ResolvedSelection> {
  if (input.exampleIds !== undefined) {
    if (input.categoryIds !== undefined || input.exampleCount !== undefined || input.exampleSeed !== undefined) {
      throw new ExperimentError("Give exampleIds or categoryIds + exampleCount (+ exampleSeed), not both", 400);
    }
    return resolveFixedSelection(input.exampleIds);
  }
  if (!Array.isArray(input.categoryIds) || typeof input.exampleCount !== "number") {
    throw new ExperimentError("categoryIds and exampleCount are required unless exampleIds is given", 400);
  }
  return resolveSeededSelection(input.categoryIds, input.exampleCount, input.exampleSeed ?? 42);
}

export async function createVlmExperiment(input: CreateVlmExperimentInput) {
  const { name, modelIds, judgePromptVariants, createdBy } = input;

  const { categoryIds, selectedIds, exampleCount, exampleSeed } = await resolveSelection(input);
  const { models, uniqueIds } = await validateModels(modelIds);
  if (judgePromptVariants !== undefined) validateJudgePromptVariants(judgePromptVariants);

  const orderedModels = uniqueIds.map((id) => models.find((m) => m.id === id)!);
  const plannedRuns = planVlmRuns(orderedModels, judgePromptVariants);

  const experiment = await prisma.$transaction(async (tx) => {
    const exp = await tx.experiment.create({
      data: {
        name,
        type: "vlm_comparison",
        categoryIds,
        promptCount: exampleCount,
        promptSeed: exampleSeed,
        testedPurpose: "vlm_eval",
        createdBy,
      },
    });

    for (const run of plannedRuns) {
      await tx.experimentRun.create({ data: { experimentId: exp.id, ...run } });
    }

    for (let i = 0; i < selectedIds.length; i++) {
      await tx.vlmExperimentExampleSelection.create({
        data: { experimentId: exp.id, exampleId: selectedIds[i], selectionOrder: i + 1 },
      });
    }

    return exp;
  });

  logger.info(
    { experimentId: experiment.id, exampleCount, modelCount: uniqueIds.length, variantCount: judgePromptVariants?.length ?? 0, runCount: plannedRuns.length },
    "VLM experiment created",
  );
  return getVlmExperiment(experiment.id);
}
