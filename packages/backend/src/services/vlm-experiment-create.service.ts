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
  }
}

// ── Run planning ─────────────────────────────────────────────────────

export interface PlannedRun {
  modelId: string;
  modelLabel: string;
  runOrder: number;
  judgePromptVariantId: string | null;
  judgePromptTemplate: string | null;
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
      });
    }
  }
  return runs;
}

// ── Create ──────────────────────────────────────────────────────────

export interface CreateVlmExperimentInput {
  name: string;
  categoryIds: string[];
  exampleCount: number;
  exampleSeed?: number;
  modelIds: string[];
  /** Optional instruments to judge under; omitted = production's (issue #35). */
  judgePromptVariants?: JudgePromptVariantInput[];
  createdBy: string;
}

export async function createVlmExperiment(input: CreateVlmExperimentInput) {
  const { name, categoryIds, exampleCount, exampleSeed = 42, modelIds, judgePromptVariants, createdBy } = input;

  await validateCategories(categoryIds);
  const { models, uniqueIds } = await validateModels(modelIds);
  if (judgePromptVariants !== undefined) validateJudgePromptVariants(judgePromptVariants);

  const allExampleIds = await queryEligibleExamples(categoryIds);
  if (allExampleIds.length === 0) throw new ExperimentError("Selected categories have no examples with screenshots", 400);
  if (exampleCount > allExampleIds.length) {
    throw new ExperimentError(`Requested ${exampleCount} examples but only ${allExampleIds.length} eligible`, 400);
  }

  const selectedIds = selectIds(allExampleIds, exampleCount, exampleSeed);
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
