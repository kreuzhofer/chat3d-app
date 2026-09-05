/**
 * VLM Experiment CRUD Service
 *
 * Manages VLM comparison experiments — selecting existing workbench examples
 * and running multiple VLM evaluators against them. Creation, including run
 * planning over judge-prompt variants, lives in `vlm-experiment-create.service.ts`.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { ExperimentError } from "./experiment.service.js";

const logger = createLogger("vlm-experiment");

const EDITABLE_STATUSES = ["created", "cancelled", "completed", "failed"];

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────

function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectIds(allIds: string[], count: number, seed: number): string[] {
  const rng = createSeededRng(seed);
  const arr = [...allIds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

// ── Validation helpers ──────────────────────────────────────────────

export async function validateCategories(categoryIds: string[]) {
  if (categoryIds.length === 0) throw new ExperimentError("At least one category is required", 400);
  const categories = await prisma.workbenchCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  if (categories.length !== categoryIds.length) {
    const found = new Set(categories.map((c) => c.id));
    const missing = categoryIds.filter((id) => !found.has(id));
    throw new ExperimentError(`Categories not found: ${missing.join(", ")}`, 404);
  }
  return categories;
}

export async function validateModels(modelIds: string[]) {
  if (modelIds.length < 1) throw new ExperimentError("At least 1 model is required", 400);
  const uniqueIds = [...new Set(modelIds)];
  if (uniqueIds.length !== modelIds.length) throw new ExperimentError("Duplicate model IDs not allowed", 400);
  const models = await prisma.llmModel.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    include: { providerRef: true },
  });
  if (models.length !== uniqueIds.length) {
    const found = new Set(models.map((m) => m.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new ExperimentError(`Models not found or inactive: ${missing.join(", ")}`, 400);
  }
  return { models, uniqueIds };
}

/** Fetch example IDs from selected categories that have screenshots. */
export async function queryEligibleExamples(categoryIds: string[]): Promise<string[]> {
  const examples = await prisma.workbenchExample.findMany({
    where: {
      screenshotFront: { not: null },
      promptRef: { categoryId: { in: categoryIds } },
      // Require both ground-truth scores for full comparison
      visualScore: { not: null },
      codeEvalScore: { not: null },
    },
    select: { id: true },
    orderBy: [{ promptId: "asc" }, { createdAt: "asc" }],
  });
  return examples.map((e) => e.id);
}

// ── Read ────────────────────────────────────────────────────────────

export async function getVlmExperiment(experimentId: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      runs: { orderBy: { runOrder: "asc" }, include: { model: { select: { displayName: true } } } },
      vlmExampleSelections: { orderBy: { selectionOrder: "asc" } },
    },
  });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);
  return exp;
}

export async function listVlmExperiments(options: { limit?: number; offset?: number } = {}) {
  const { limit = 50, offset = 0 } = options;
  const [items, total] = await Promise.all([
    prisma.experiment.findMany({
      where: { type: "vlm_comparison" },
      include: {
        runs: { orderBy: { runOrder: "asc" }, select: { id: true, modelLabel: true, status: true, judgePromptVariantId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.experiment.count({ where: { type: "vlm_comparison" } }),
  ]);

  // Enrich with category names
  const allCatIds = [...new Set(items.flatMap((e) => e.categoryIds))];
  const categories = await prisma.workbenchCategory.findMany({
    where: { id: { in: allCatIds } },
    select: { id: true, name: true },
  });
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  return {
    items: items.map((e) => ({
      ...e,
      categoryNames: e.categoryIds.map((id) => catMap.get(id) ?? "Unknown"),
    })),
    total,
  };
}

// ── Preview ─────────────────────────────────────────────────────────

export async function previewExampleSelection(
  categoryIds: string[],
  exampleCount: number,
  exampleSeed: number = 42,
) {
  await validateCategories(categoryIds);
  const allExampleIds = await queryEligibleExamples(categoryIds);
  const effectiveCount = Math.min(exampleCount, allExampleIds.length);
  const selectedIds = selectIds(allExampleIds, effectiveCount, exampleSeed);

  const examples = await prisma.workbenchExample.findMany({
    where: { id: { in: selectedIds } },
    select: {
      id: true,
      screenshotIso: true,
      evalScore: true,
      visualScore: true,
      codeEvalScore: true,
      assertionPassRate: true,
      approvalStatus: true,
      promptRef: { select: { prompt: true, category: { select: { name: true } } } },
    },
  });

  // Preserve selection order
  const exMap = new Map(examples.map((e) => [e.id, e]));
  return {
    totalEligible: allExampleIds.length,
    selected: selectedIds.map((id) => exMap.get(id)).filter(Boolean),
  };
}

// ── Update ──────────────────────────────────────────────────────────

export interface UpdateVlmExperimentInput {
  name?: string;
  categoryIds?: string[];
  exampleCount?: number;
  exampleSeed?: number;
  modelIds?: string[];
}

export async function updateVlmExperiment(experimentId: string, input: UpdateVlmExperimentInput) {
  const exp = await getVlmExperiment(experimentId);
  if (!EDITABLE_STATUSES.includes(exp.status)) {
    throw new ExperimentError("Cannot edit a running experiment", 409);
  }

  if (input.categoryIds) await validateCategories(input.categoryIds);
  if (input.modelIds) {
    await validateModels(input.modelIds);
    // Runs under judge-prompt variants are model × variant; reconciling them by
    // model alone would silently drop variants. Recreate the experiment instead.
    const variantRuns = await prisma.experimentRun.count({ where: { experimentId, judgePromptVariantId: { not: null } } });
    if (variantRuns > 0) {
      throw new ExperimentError("Models cannot be changed on an experiment with judge-prompt variants; create a new experiment", 400);
    }
  }

  const categoryIds = input.categoryIds ?? exp.categoryIds;
  const exampleCount = input.exampleCount ?? exp.promptCount;
  const exampleSeed = input.exampleSeed ?? exp.promptSeed;
  const modelIds = input.modelIds;

  // If examples or categories changed, reselect
  const needReselect = input.categoryIds || input.exampleCount != null || input.exampleSeed != null;
  let selectedIds: string[] | null = null;
  if (needReselect) {
    const allExampleIds = await queryEligibleExamples(categoryIds);
    if (exampleCount > allExampleIds.length) {
      throw new ExperimentError(`Requested ${exampleCount} examples but only ${allExampleIds.length} eligible`, 400);
    }
    selectedIds = selectIds(allExampleIds, exampleCount, exampleSeed);
  }

  await prisma.$transaction(async (tx) => {
    // Reset to "created" so experiment can be started again — but only update
    // fields that were actually provided
    await tx.experiment.update({
      where: { id: experimentId },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
        ...(input.exampleCount != null ? { promptCount: input.exampleCount } : {}),
        ...(input.exampleSeed != null ? { promptSeed: input.exampleSeed } : {}),
        status: "created",
        completedAt: null,
      },
    });

    if (selectedIds) {
      await tx.vlmExperimentExampleSelection.deleteMany({ where: { experimentId } });
      // Also delete results since examples changed
      await tx.vlmExperimentResult.deleteMany({
        where: { run: { experimentId } },
      });
      for (let i = 0; i < selectedIds.length; i++) {
        await tx.vlmExperimentExampleSelection.create({
          data: { experimentId, exampleId: selectedIds[i], selectionOrder: i + 1 },
        });
      }
    }

    if (modelIds) {
      const { models, uniqueIds } = await validateModels(modelIds);

      // Find existing runs to preserve
      const existingRuns = await tx.experimentRun.findMany({ where: { experimentId } });
      const existingModelIds = new Set(existingRuns.map((r) => r.modelId));
      const newModelIds = uniqueIds.filter((id) => !existingModelIds.has(id));
      const removedRuns = existingRuns.filter((r) => !uniqueIds.includes(r.modelId));

      // Delete results + runs only for removed models
      if (removedRuns.length > 0) {
        const removedRunIds = removedRuns.map((r) => r.id);
        await tx.vlmExperimentResult.deleteMany({ where: { runId: { in: removedRunIds } } });
        await tx.experimentRun.deleteMany({ where: { id: { in: removedRunIds } } });
      }

      // Add new runs (preserve existing run order, append new ones)
      const maxOrder = existingRuns.length > 0
        ? Math.max(...existingRuns.filter((r) => uniqueIds.includes(r.modelId)).map((r) => r.runOrder))
        : 0;
      let runOrder = maxOrder;
      for (const id of newModelIds) {
        const model = models.find((m) => m.id === id)!;
        runOrder++;
        await tx.experimentRun.create({
          data: {
            experimentId,
            modelId: id,
            modelLabel: model.displayName || `${model.provider}/${model.modelName}`,
            runOrder,
          },
        });
      }
    } else {
      // Reset existing runs to pending
      await tx.experimentRun.updateMany({
        where: { experimentId },
        data: { status: "pending", startedAt: null, completedAt: null },
      });
    }
  });

  return getVlmExperiment(experimentId);
}

// ── Delete ──────────────────────────────────────────────────────────

export async function deleteVlmExperiment(experimentId: string) {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot delete a running experiment", 409);

  await prisma.experiment.delete({ where: { id: experimentId } });
  logger.info({ experimentId }, "VLM experiment deleted");
}

// ── Rerun ───────────────────────────────────────────────────────────

export async function rerunVlmExperiment(experimentId: string) {
  const exp = await getVlmExperiment(experimentId);
  if (exp.status === "running") throw new ExperimentError("Cannot rerun a running experiment", 409);

  await prisma.$transaction(async (tx) => {
    // Delete all results
    await tx.vlmExperimentResult.deleteMany({ where: { run: { experimentId } } });

    // Reset all runs
    await tx.experimentRun.updateMany({
      where: { experimentId },
      data: { status: "pending", startedAt: null, completedAt: null },
    });

    // Reset experiment
    await tx.experiment.update({
      where: { id: experimentId },
      data: { status: "created", startedAt: null, completedAt: null },
    });
  });

  logger.info({ experimentId }, "VLM experiment reset for rerun");
  return getVlmExperiment(experimentId);
}

// ── Reset single run ────────────────────────────────────────────────

export async function resetVlmExperimentRun(experimentId: string, runId: string) {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true, type: true, status: true } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot reset a run while experiment is running", 409);

  const run = await prisma.experimentRun.findUnique({ where: { id: runId } });
  if (!run || run.experimentId !== experimentId) throw new ExperimentError("Run not found in this experiment", 404);

  const deleted = await prisma.$transaction(async (tx) => {
    const { count } = await tx.vlmExperimentResult.deleteMany({ where: { runId } });
    await tx.experimentRun.update({
      where: { id: runId },
      data: { status: "pending", startedAt: null, completedAt: null },
    });
    // Reset experiment status so it can be started again
    await tx.experiment.update({
      where: { id: experimentId },
      data: { status: "created", completedAt: null },
    });
    return count;
  });

  logger.info({ experimentId, runId, deleted }, "VLM experiment run reset");
  return { deleted };
}

// ── Status (polling) ────────────────────────────────────────────────

export async function getVlmExperimentStatus(experimentId: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    select: { id: true, type: true, status: true },
  });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);

  const runs = await prisma.experimentRun.findMany({
    where: { experimentId },
    select: { id: true, modelLabel: true, status: true, runOrder: true, judgePromptVariantId: true },
    orderBy: { runOrder: "asc" },
  });

  // Count completed results per run
  const resultCounts = await prisma.vlmExperimentResult.groupBy({
    by: ["runId"],
    where: { run: { experimentId } },
    _count: true,
  });
  const countMap = new Map(resultCounts.map((r) => [r.runId, r._count]));

  const totalExamples = await prisma.vlmExperimentExampleSelection.count({ where: { experimentId } });

  return {
    status: exp.status,
    runs: runs.map((r) => ({
      runId: r.id,
      modelLabel: r.modelLabel,
      judgePromptVariantId: r.judgePromptVariantId,
      status: r.status,
      completedExamples: countMap.get(r.id) ?? 0,
      totalExamples,
    })),
  };
}
