/**
 * Experiment CRUD Service
 *
 * Manages experiments for comparing LLM model performance on workbench generation.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("experiment");

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

function selectPromptIds(allIds: string[], count: number, seed: number): string[] {
  const rng = createSeededRng(seed);
  const arr = [...allIds];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

// ── Approved-prompt filter (reused by create + preview) ─────────────

const APPROVED_PROMPT_FILTER = {
  examples: {
    some: {
      approvalStatus: { in: ["auto_approved", "human_approved"] },
      experimentRunId: null,
    },
  },
} as const;

const EDITABLE_STATUSES = ["created", "cancelled", "completed", "failed"];

// ── Shared validation helpers ───────────────────────────────────────

async function validateCategories(categoryIds: string[]) {
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

function validateFewShotCounts(counts?: number[]): number[] | null {
  if (!counts || counts.length === 0) return null;
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0 || c > 20) {
      throw new ExperimentError(`Invalid few-shot count: ${c} (must be integer 0-20)`, 400);
    }
  }
  const unique = [...new Set(counts)].sort((a, b) => a - b);
  if (unique.length !== counts.length) throw new ExperimentError("Duplicate few-shot counts not allowed", 400);
  return unique;
}

async function validateModels(modelIds: string[], _fewShotCounts?: number[] | null) {
  if (modelIds.length < 1) {
    throw new ExperimentError("At least 1 model is required", 400);
  }
  const uniqueModelIds = [...new Set(modelIds)];
  if (uniqueModelIds.length !== modelIds.length) throw new ExperimentError("Duplicate model IDs not allowed", 400);
  const models = await prisma.llmModel.findMany({
    where: { id: { in: uniqueModelIds }, isActive: true },
    include: { providerRef: true },
  });
  if (models.length !== uniqueModelIds.length) {
    const found = new Set(models.map((m) => m.id));
    const missing = uniqueModelIds.filter((id) => !found.has(id));
    throw new ExperimentError(`Models not found or inactive: ${missing.join(", ")}`, 400);
  }
  return { models, uniqueModelIds };
}

async function selectApprovedPrompts(categoryIds: string[], promptCount: number, promptSeed: number) {
  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId: { in: categoryIds }, ...APPROVED_PROMPT_FILTER },
    select: { id: true },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });
  if (prompts.length === 0) throw new ExperimentError("Selected categories have no approved prompts", 400);
  if (promptCount > prompts.length) {
    throw new ExperimentError(`Requested ${promptCount} prompts but only ${prompts.length} approved prompts available`, 400);
  }
  return selectPromptIds(prompts.map((p) => p.id), promptCount, promptSeed);
}

// ── Create ──────────────────────────────────────────────────────────

export interface CreateExperimentInput {
  name: string;
  categoryIds: string[];
  promptCount: number;
  promptSeed?: number;
  testedPurpose?: string;
  modelIds: string[];
  fewShotCounts?: number[];
  createdBy: string;
}

export async function createExperiment(input: CreateExperimentInput) {
  const { name, categoryIds, promptCount, promptSeed = 42, testedPurpose = "workbench_codegen", modelIds, createdBy } = input;

  const validatedFsc = validateFewShotCounts(input.fewShotCounts);
  await validateCategories(categoryIds);
  const { models, uniqueModelIds } = await validateModels(modelIds, validatedFsc);
  const selectedIds = await selectApprovedPrompts(categoryIds, promptCount, promptSeed);

  const experiment = await prisma.$transaction(async (tx) => {
    const exp = await tx.experiment.create({
      data: { name, categoryIds, promptCount, promptSeed, testedPurpose, createdBy, fewShotCounts: validatedFsc ?? [] },
    });

    const effectiveCounts: Array<number | null> = validatedFsc ?? [null];
    let runOrder = 0;
    for (const modelId of uniqueModelIds) {
      const model = models.find((m) => m.id === modelId)!;
      for (const fsc of effectiveCounts) {
        runOrder++;
        const label = fsc != null
          ? `${model.provider}/${model.modelName} (${fsc} ex)`
          : `${model.provider}/${model.modelName}`;
        await tx.experimentRun.create({
          data: { experimentId: exp.id, modelId: model.id, modelLabel: label, runOrder, fewShotCount: fsc },
        });
      }
    }

    for (let i = 0; i < selectedIds.length; i++) {
      await tx.experimentPromptSelection.create({
        data: { experimentId: exp.id, promptId: selectedIds[i], selectionOrder: i + 1 },
      });
    }

    return exp;
  });

  const totalRuns = uniqueModelIds.length * (validatedFsc?.length ?? 1);
  logger.info({ experimentId: experiment.id, name, promptCount, runCount: totalRuns, fewShotCounts: validatedFsc }, "experiment created");
  return getExperiment(experiment.id);
}

// ── Update ──────────────────────────────────────────────────────────

export interface UpdateExperimentInput {
  name?: string;
  categoryIds?: string[];
  promptCount?: number;
  promptSeed?: number;
  modelIds?: string[];
  fewShotCounts?: number[];
}

export async function updateExperiment(id: string, input: UpdateExperimentInput) {
  const exp = await prisma.experiment.findUnique({
    where: { id },
    include: { runs: { select: { id: true, modelId: true, modelLabel: true, fewShotCount: true } } },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (!EDITABLE_STATUSES.includes(exp.status)) {
    throw new ExperimentError(`Cannot edit experiment in '${exp.status}' status`, 409);
  }

  const categoryIds = input.categoryIds ?? exp.categoryIds;
  const promptCount = input.promptCount ?? exp.promptCount;
  const promptSeed = input.promptSeed ?? exp.promptSeed;
  const validatedFsc = input.fewShotCounts !== undefined ? validateFewShotCounts(input.fewShotCounts) : null;
  const effectiveFsc = input.fewShotCounts !== undefined ? validatedFsc : (exp.fewShotCounts.length > 0 ? exp.fewShotCounts : null);

  // Validate changed fields
  if (input.categoryIds) await validateCategories(categoryIds);

  const runsChanged = input.modelIds !== undefined || input.fewShotCounts !== undefined;
  let models: Awaited<ReturnType<typeof validateModels>> | null = null;
  if (runsChanged) {
    const modelIds = input.modelIds ?? [...new Set(exp.runs.map((r) => r.modelId))];
    models = await validateModels(modelIds, effectiveFsc);
  }

  // Re-select prompts if categories, count, or seed changed
  const promptsChanged = input.categoryIds || input.promptCount !== undefined || input.promptSeed !== undefined;
  const selectedIds = promptsChanged ? await selectApprovedPrompts(categoryIds, promptCount, promptSeed) : null;

  await prisma.$transaction(async (tx) => {
    // Diff-based run management: keep matching runs, delete removed, add new
    if (models) {
      const effectiveCounts: Array<number | null> = effectiveFsc ?? [null];

      // Build desired run set
      const desiredRuns: Array<{ modelId: string; fsc: number | null; label: string }> = [];
      for (const modelId of models.uniqueModelIds) {
        const model = models.models.find((m) => m.id === modelId)!;
        for (const fsc of effectiveCounts) {
          const label = fsc != null
            ? `${model.provider}/${model.modelName} (${fsc} ex)`
            : `${model.provider}/${model.modelName}`;
          desiredRuns.push({ modelId: model.id, fsc, label });
        }
      }

      // Delete runs no longer in config
      const toDelete = exp.runs.filter((r) =>
        !desiredRuns.some((d) => d.modelId === r.modelId && d.fsc === r.fewShotCount),
      );
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map((r) => r.id);
        await tx.workbenchExample.deleteMany({ where: { experimentRunId: { in: deleteIds } } });
        await tx.experimentRun.deleteMany({ where: { id: { in: deleteIds } } });
      }

      // Add new runs not yet existing
      const maxOrder = exp.runs.length > 0 ? Math.max(...exp.runs.map((r) => r.runOrder ?? 0)) : 0;
      let nextOrder = maxOrder;
      for (const desired of desiredRuns) {
        const exists = exp.runs.some((r) => r.modelId === desired.modelId && r.fewShotCount === desired.fsc);
        if (!exists) {
          nextOrder++;
          await tx.experimentRun.create({
            data: { experimentId: id, modelId: desired.modelId, modelLabel: desired.label, runOrder: nextOrder, fewShotCount: desired.fsc },
          });
        }
      }
    }

    // Re-create prompt selections if prompts changed
    if (selectedIds) {
      await tx.experimentPromptSelection.deleteMany({ where: { experimentId: id } });
      for (let i = 0; i < selectedIds.length; i++) {
        await tx.experimentPromptSelection.create({
          data: { experimentId: id, promptId: selectedIds[i], selectionOrder: i + 1 },
        });
      }
    }

    await tx.experiment.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.categoryIds && { categoryIds }),
        ...(input.promptCount !== undefined && { promptCount }),
        ...(input.promptSeed !== undefined && { promptSeed }),
        ...(input.fewShotCounts !== undefined && { fewShotCounts: effectiveFsc ?? [] }),
        status: "created",
        startedAt: null,
        completedAt: null,
      },
    });
  });

  logger.info({ experimentId: id }, "experiment updated");
  return getExperiment(id);
}

// ── Read ────────────────────────────────────────────────────────────

export async function getExperiment(id: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id },
    include: {
      runs: {
        orderBy: { runOrder: "asc" },
        include: { model: { select: { id: true, displayName: true, modelName: true, provider: true } } },
      },
      promptSelections: {
        orderBy: { selectionOrder: "asc" },
        include: { prompt: { select: { id: true, prompt: true, index: true } } },
      },
    },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  const categories = await resolveCategories(exp.categoryIds);
  return mapExperiment(exp, categories);
}

export async function listExperiments(filters?: { status?: string; categoryId?: string; limit?: number; offset?: number }) {
  const where: Record<string, unknown> = { type: "codegen" };
  if (filters?.status) where.status = filters.status;
  if (filters?.categoryId) where.categoryIds = { has: filters.categoryId };

  const [rows, total] = await Promise.all([
    prisma.experiment.findMany({
      where,
      include: { runs: { orderBy: { runOrder: "asc" }, select: { id: true, modelLabel: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    }),
    prisma.experiment.count({ where }),
  ]);

  const allCatIds = [...new Set(rows.flatMap((r) => r.categoryIds))];
  const catMap = await resolveCategoryMap(allCatIds);

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryIds: r.categoryIds,
      categoryNames: r.categoryIds.map((cid) => catMap.get(cid) ?? "Unknown"),
      promptCount: r.promptCount,
      testedPurpose: r.testedPurpose,
      status: r.status,
      runs: r.runs.map((run) => ({ id: run.id, modelLabel: run.modelLabel, status: run.status })),
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
    total,
  };
}

// ── Delete ──────────────────────────────────────────────────────────

export async function deleteExperiment(id: string) {
  const exp = await prisma.experiment.findUnique({ where: { id }, select: { status: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot delete a running experiment", 409);

  await prisma.experiment.delete({ where: { id } });
  logger.info({ experimentId: id }, "experiment deleted");
}

// ── Re-run ──────────────────────────────────────────────────────────

export async function rerunExperiment(id: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id },
    include: { runs: { select: { id: true, modelId: true, modelLabel: true, runOrder: true, fewShotCount: true } } },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot re-run a running experiment", 409);

  await prisma.$transaction(async (tx) => {
    const runIds = exp.runs.map((r) => r.id);
    if (runIds.length > 0) {
      await tx.workbenchExample.deleteMany({ where: { experimentRunId: { in: runIds } } });
      await tx.experimentRun.deleteMany({ where: { id: { in: runIds } } });
    }
    for (const run of exp.runs) {
      await tx.experimentRun.create({
        data: { experimentId: id, modelId: run.modelId, modelLabel: run.modelLabel, runOrder: run.runOrder, fewShotCount: run.fewShotCount },
      });
    }
    await tx.experiment.update({ where: { id }, data: { status: "created", startedAt: null, completedAt: null } });
  });

  logger.info({ experimentId: id }, "experiment reset for re-run");
}

// ── Run management ──────────────────────────────────────────────────

export async function deleteExperimentRun(experimentId: string, runId: string) {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { status: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot modify runs of a running experiment", 409);

  const run = await prisma.experimentRun.findFirst({ where: { id: runId, experimentId } });
  if (!run) throw new ExperimentError("Run not found", 404);

  // Cascade deletes examples automatically
  await prisma.experimentRun.delete({ where: { id: runId } });
  logger.info({ experimentId, runId, modelLabel: run.modelLabel }, "experiment run deleted");
}

export async function retryExperimentRun(experimentId: string, runId: string) {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { status: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot modify runs of a running experiment", 409);

  const run = await prisma.experimentRun.findFirst({ where: { id: runId, experimentId } });
  if (!run) throw new ExperimentError("Run not found", 404);
  if (run.status !== "failed") throw new ExperimentError(`Run is '${run.status}', only failed runs can be retried`, 409);

  await prisma.$transaction(async (tx) => {
    await tx.workbenchExample.deleteMany({ where: { experimentRunId: runId } });
    await tx.experimentRun.update({
      where: { id: runId },
      data: { status: "pending", startedAt: null, completedAt: null },
    });
  });

  logger.info({ experimentId, runId, modelLabel: run.modelLabel }, "experiment run reset for retry");
}

export async function retryFailedRuns(experimentId: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { runs: { where: { status: "failed" }, select: { id: true, modelLabel: true } } },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);
  if (exp.status === "running") throw new ExperimentError("Cannot modify runs of a running experiment", 409);
  if (exp.runs.length === 0) throw new ExperimentError("No failed runs to retry", 400);

  const failedIds = exp.runs.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await tx.workbenchExample.deleteMany({ where: { experimentRunId: { in: failedIds } } });
    await tx.experimentRun.updateMany({
      where: { id: { in: failedIds } },
      data: { status: "pending", startedAt: null, completedAt: null },
    });
    await tx.experiment.update({
      where: { id: experimentId },
      data: { status: "created", startedAt: null, completedAt: null },
    });
  });

  logger.info({ experimentId, retriedCount: failedIds.length }, "failed runs reset for retry");
}

// ── Preview prompt selection ────────────────────────────────────────

export async function previewPromptSelection(categoryIds: string[], count: number, seed: number) {
  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId: { in: categoryIds }, ...APPROVED_PROMPT_FILTER },
    select: { id: true, prompt: true, index: true },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });
  if (count > prompts.length) {
    throw new ExperimentError(`Requested ${count} but only ${prompts.length} approved prompts available`, 400);
  }

  const selectedIds = new Set(selectPromptIds(prompts.map((p) => p.id), count, seed));
  return prompts
    .filter((p) => selectedIds.has(p.id))
    .map((p) => ({ id: p.id, prompt: p.prompt, index: p.index }));
}

// ── Status polling ──────────────────────────────────────────────────

export async function getExperimentStatus(id: string) {
  const exp = await prisma.experiment.findUnique({
    where: { id },
    select: {
      id: true, status: true, promptCount: true,
      runs: {
        orderBy: { runOrder: "asc" },
        select: { id: true, modelLabel: true, runOrder: true, fewShotCount: true, status: true, startedAt: true, completedAt: true },
      },
    },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  // Only count examples that have finished processing (not early placeholders)
  const exampleCounts = await prisma.workbenchExample.groupBy({
    by: ["experimentRunId"],
    where: {
      experimentRunId: { in: exp.runs.map((r) => r.id) },
      renderStatus: { not: "pending" },
    },
    _count: true,
  });
  const countMap = new Map(exampleCounts.map((c) => [c.experimentRunId, c._count]));

  return {
    id: exp.id, status: exp.status, promptCount: exp.promptCount,
    runs: exp.runs.map((r) => ({
      id: r.id, modelLabel: r.modelLabel, runOrder: r.runOrder, fewShotCount: r.fewShotCount as number | null, status: r.status,
      completedPrompts: countMap.get(r.id) ?? 0, startedAt: r.startedAt, completedAt: r.completedAt,
    })),
  };
}

// ── Category resolution helpers ─────────────────────────────────────

async function resolveCategories(categoryIds: string[]) {
  if (categoryIds.length === 0) return [];
  return prisma.workbenchCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, complexity: true },
  });
}

async function resolveCategoryMap(categoryIds: string[]) {
  if (categoryIds.length === 0) return new Map<string, string>();
  const cats = await prisma.workbenchCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  return new Map(cats.map((c) => [c.id, c.name]));
}

// ── Mapper ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapExperiment(exp: any, categories: Array<{ id: string; name: string; complexity: number }>) {
  return {
    id: exp.id, name: exp.name, categoryIds: exp.categoryIds, categories,
    promptCount: exp.promptCount, promptSeed: exp.promptSeed, testedPurpose: exp.testedPurpose,
    fewShotCounts: exp.fewShotCounts, status: exp.status, createdBy: exp.createdBy,
    startedAt: exp.startedAt, completedAt: exp.completedAt, createdAt: exp.createdAt,
    runs: exp.runs.map((r: any) => ({  // eslint-disable-line @typescript-eslint/no-explicit-any
      id: r.id, modelId: r.modelId, modelLabel: r.modelLabel, model: r.model,
      runOrder: r.runOrder, fewShotCount: r.fewShotCount, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt,
    })),
    promptSelections: exp.promptSelections.map((s: any) => ({  // eslint-disable-line @typescript-eslint/no-explicit-any
      promptId: s.promptId, selectionOrder: s.selectionOrder, prompt: s.prompt.prompt, index: s.prompt.index,
    })),
  };
}

// ── Error class ─────────────────────────────────────────────────────

export class ExperimentError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}
