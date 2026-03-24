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

// ── Create ──────────────────────────────────────────────────────────

export interface CreateExperimentInput {
  name: string;
  categoryIds: string[];
  promptCount: number;
  promptSeed?: number;
  testedPurpose?: string;
  modelIds: string[];
  createdBy: string;
}

export async function createExperiment(input: CreateExperimentInput) {
  const { name, categoryIds, promptCount, promptSeed = 42, testedPurpose = "workbench_codegen", modelIds, createdBy } = input;

  // Validate categories
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

  // Validate models exist and are active
  if (modelIds.length < 2) throw new ExperimentError("At least 2 models required for comparison", 400);
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

  // Get approved prompt IDs across all categories (deterministic order)
  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId: { in: categoryIds }, ...APPROVED_PROMPT_FILTER },
    select: { id: true },
    orderBy: [{ categoryId: "asc" }, { index: "asc" }],
  });
  if (prompts.length === 0) throw new ExperimentError("Selected categories have no approved prompts", 400);
  if (promptCount > prompts.length) {
    throw new ExperimentError(`Requested ${promptCount} prompts but only ${prompts.length} approved prompts available`, 400);
  }

  // Select prompts using seeded shuffle
  const selectedIds = selectPromptIds(prompts.map((p) => p.id), promptCount, promptSeed);

  // Create experiment + runs + selections in a transaction
  const experiment = await prisma.$transaction(async (tx) => {
    const exp = await tx.experiment.create({
      data: {
        name,
        categoryIds,
        promptCount,
        promptSeed,
        testedPurpose,
        createdBy,
      },
    });

    // Create runs
    for (let i = 0; i < uniqueModelIds.length; i++) {
      const model = models.find((m) => m.id === uniqueModelIds[i])!;
      await tx.experimentRun.create({
        data: {
          experimentId: exp.id,
          modelId: model.id,
          modelLabel: `${model.provider}/${model.modelName}`,
          runOrder: i + 1,
        },
      });
    }

    // Create prompt selections
    for (let i = 0; i < selectedIds.length; i++) {
      await tx.experimentPromptSelection.create({
        data: {
          experimentId: exp.id,
          promptId: selectedIds[i],
          selectionOrder: i + 1,
        },
      });
    }

    return exp;
  });

  logger.info({ experimentId: experiment.id, name, promptCount, runCount: uniqueModelIds.length }, "experiment created");
  return getExperiment(experiment.id);
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
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.categoryId) where.categoryIds = { has: filters.categoryId };

  const [rows, total] = await Promise.all([
    prisma.experiment.findMany({
      where,
      include: {
        runs: { orderBy: { runOrder: "asc" }, select: { id: true, modelLabel: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    }),
    prisma.experiment.count({ where }),
  ]);

  // Batch-resolve category names
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
      id: true,
      status: true,
      runs: {
        orderBy: { runOrder: "asc" },
        select: {
          id: true,
          modelLabel: true,
          runOrder: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  // Count examples per run for progress
  const exampleCounts = await prisma.workbenchExample.groupBy({
    by: ["experimentRunId"],
    where: { experimentRunId: { in: exp.runs.map((r) => r.id) } },
    _count: true,
  });
  const countMap = new Map(exampleCounts.map((c) => [c.experimentRunId, c._count]));

  return {
    id: exp.id,
    status: exp.status,
    runs: exp.runs.map((r) => ({
      id: r.id,
      modelLabel: r.modelLabel,
      runOrder: r.runOrder,
      status: r.status,
      completedPrompts: countMap.get(r.id) ?? 0,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
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
    id: exp.id,
    name: exp.name,
    categoryIds: exp.categoryIds,
    categories,
    promptCount: exp.promptCount,
    promptSeed: exp.promptSeed,
    testedPurpose: exp.testedPurpose,
    status: exp.status,
    createdBy: exp.createdBy,
    startedAt: exp.startedAt,
    completedAt: exp.completedAt,
    createdAt: exp.createdAt,
    runs: exp.runs.map((r: any) => ({  // eslint-disable-line @typescript-eslint/no-explicit-any
      id: r.id,
      modelId: r.modelId,
      modelLabel: r.modelLabel,
      model: r.model,
      runOrder: r.runOrder,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
    promptSelections: exp.promptSelections.map((s: any) => ({  // eslint-disable-line @typescript-eslint/no-explicit-any
      promptId: s.promptId,
      selectionOrder: s.selectionOrder,
      prompt: s.prompt.prompt,
      index: s.prompt.index,
    })),
  };
}

// ── Error class ─────────────────────────────────────────────────────

export class ExperimentError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
