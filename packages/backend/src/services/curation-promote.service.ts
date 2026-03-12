/**
 * Curation promotion workflows: promote candidates to workbench
 * either as new entries or as improvements to existing prompts.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { detectPromptOperations } from "../prompts/system-prompts.js";
import { CurationError, getCandidateDetail } from "./curation.service.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";
import {
  findBestAssistantItem,
  readB123dCode,
  copyFilesToWorkbench,
} from "./curation-file-helpers.js";

const logger = createLogger("curation-promote");

export interface PromotionResult {
  candidateId: string;
  workbenchExampleId: string;
  workbenchPromptId: string;
  categoryId: string;
}

/**
 * Promote a curation candidate to a NEW workbench prompt
 * in the "User Generated Models" category.
 */
export async function promoteCandidate(candidateId: string): Promise<PromotionResult> {
  const detail = await getCandidateDetail(candidateId);

  if (!detail.distilledPrompt) {
    throw new CurationError("Candidate has no distilled prompt. Distill the prompt before approving.", 400);
  }
  if (detail.status === "approved") {
    throw new CurationError("Candidate is already approved.", 409);
  }

  const contextId = detail.chatContext.id;
  const bestItem = await findBestAssistantItem(contextId, detail.conversationItems);
  if (!bestItem) {
    throw new CurationError("No assistant item with model files found on disk.", 400);
  }

  logger.info({ candidateId, itemId: bestItem.id }, "found best assistant item for promotion");

  const category = await prisma.workbenchCategory.findFirst({
    where: { name: "User Generated Models" },
  });
  if (!category) {
    throw new CurationError(
      "User Generated Models category not found. Ensure the Phase 3 migration has been applied.",
      500,
    );
  }

  const maxIndexResult = await prisma.workbenchExamplePrompt.aggregate({
    where: { categoryId: category.id },
    _max: { index: true },
  });
  const nextIndex = (maxIndexResult._max.index ?? -1) + 1;

  const prompt = await prisma.workbenchExamplePrompt.create({
    data: {
      categoryId: category.id,
      index: nextIndex,
      prompt: detail.distilledPrompt,
      detectedOperations: [...detectPromptOperations(detail.distilledPrompt)],
    },
  });

  logger.info({ promptId: prompt.id, categoryId: category.id, index: nextIndex }, "created workbench prompt");

  const filePaths = await copyFilesToWorkbench(contextId, bestItem.id, category.id, prompt.id);
  const code = await readB123dCode(contextId, bestItem.id);

  const example = await createWorkbenchExample(prompt.id, code, 1, filePaths);
  logger.info({ exampleId: example.id }, "created workbench example");

  if (detail.tags.length > 0) {
    await prisma.workbenchPromptTag.createMany({
      data: detail.tags.map((t) => ({ promptId: prompt.id, tagId: t.id })),
      skipDuplicates: true,
    });
    logger.info({ count: detail.tags.length }, "copied tags to workbench prompt");
  }

  try {
    await embedAndStorePrompt(prompt.id, detail.distilledPrompt);
    logger.info({ promptId: prompt.id }, "generated embedding for promoted prompt");
  } catch (err) {
    logger.warn({ err, promptId: prompt.id }, "embedding generation failed — can be backfilled later");
  }

  await markCandidateApproved(candidateId, example.id);
  logger.info({ candidateId, exampleId: example.id }, "candidate promoted to workbench");

  return {
    candidateId,
    workbenchExampleId: example.id,
    workbenchPromptId: prompt.id,
    categoryId: category.id,
  };
}

/**
 * Promote a remix candidate as an improvement to its original workbench prompt.
 *
 * Adds a new render (WorkbenchExample) to the original prompt
 * and updates the prompt text if the distilled version differs.
 */
export async function promoteCandidateAsImprovement(candidateId: string): Promise<PromotionResult> {
  const detail = await getCandidateDetail(candidateId);

  if (!detail.distilledPrompt) {
    throw new CurationError("Candidate has no distilled prompt. Distill the prompt before approving.", 400);
  }
  if (detail.status === "approved") {
    throw new CurationError("Candidate is already approved.", 409);
  }
  if (!detail.remixedFromPromptId) {
    throw new CurationError("Candidate is not a remix — use the standard approve flow.", 400);
  }

  const originalPrompt = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: detail.remixedFromPromptId },
    include: { category: { select: { id: true } } },
  });
  if (!originalPrompt) {
    throw new CurationError("Original workbench prompt no longer exists.", 404);
  }

  const contextId = detail.chatContext.id;
  const bestItem = await findBestAssistantItem(contextId, detail.conversationItems);
  if (!bestItem) {
    throw new CurationError("No assistant item with model files found on disk.", 400);
  }

  logger.info({ candidateId, itemId: bestItem.id, originalPromptId: originalPrompt.id }, "promoting remix as improvement");

  const maxIter = await prisma.workbenchExample.aggregate({
    where: { promptId: originalPrompt.id },
    _max: { iteration: true },
  });
  const nextIteration = (maxIter._max.iteration ?? 0) + 1;

  const categoryId = originalPrompt.category.id;
  const filePaths = await copyFilesToWorkbench(contextId, bestItem.id, categoryId, `${originalPrompt.id}-${nextIteration}`);
  const code = await readB123dCode(contextId, bestItem.id);

  const example = await createWorkbenchExample(originalPrompt.id, code, nextIteration, filePaths);

  // Update prompt text if the distilled version differs
  if (detail.distilledPrompt !== originalPrompt.prompt) {
    await prisma.workbenchExamplePrompt.update({
      where: { id: originalPrompt.id },
      data: {
        prompt: detail.distilledPrompt,
        detectedOperations: [...detectPromptOperations(detail.distilledPrompt)],
      },
    });
    try {
      await embedAndStorePrompt(originalPrompt.id, detail.distilledPrompt);
    } catch (err) {
      logger.warn({ err, promptId: originalPrompt.id }, "embedding update failed — can be backfilled later");
    }
    logger.info({ promptId: originalPrompt.id }, "updated original prompt text from remix");
  }

  // Merge tags (skip duplicates)
  if (detail.tags.length > 0) {
    await prisma.workbenchPromptTag.createMany({
      data: detail.tags.map((t) => ({ promptId: originalPrompt.id, tagId: t.id })),
      skipDuplicates: true,
    });
  }

  await markCandidateApproved(candidateId, example.id);
  logger.info({ candidateId, exampleId: example.id, promptId: originalPrompt.id }, "remix promoted as improvement");

  return {
    candidateId,
    workbenchExampleId: example.id,
    workbenchPromptId: originalPrompt.id,
    categoryId,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────

async function createWorkbenchExample(
  promptId: string,
  code: string,
  iteration: number,
  filePaths: Awaited<ReturnType<typeof copyFilesToWorkbench>>,
) {
  return prisma.workbenchExample.create({
    data: {
      promptId,
      code: code || "(no code available)",
      renderStatus: "success",
      approvalStatus: "human_approved",
      iteration,
      stlPath: filePaths.stlPath,
      stepPath: filePaths.stepPath,
      threemfPath: filePaths.threemfPath,
      screenshotFront: filePaths.screenshotFront,
      screenshotBack: filePaths.screenshotBack,
      screenshotLeft: filePaths.screenshotLeft,
      screenshotRight: filePaths.screenshotRight,
      screenshotTop: filePaths.screenshotTop,
      screenshotBottom: filePaths.screenshotBottom,
      screenshotOrtho45: filePaths.screenshotOrtho45,
      screenshotOrtho45Bottom: filePaths.screenshotOrtho45Bottom,
      screenshotIso: filePaths.screenshotIso,
      screenshotIsoBack: filePaths.screenshotIsoBack,
    },
  });
}

async function markCandidateApproved(candidateId: string, exampleId: string) {
  await prisma.curationCandidate.update({
    where: { id: candidateId },
    data: {
      status: "approved",
      workbenchExampleId: exampleId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
