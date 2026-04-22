/**
 * Workbench Backfill Specs Service
 *
 * Batch operation that generates spec data (spec_interpretation, construction_spec,
 * code_assertions, verification_checklist, verification_criteria) for prompts
 * missing it. Uses the existing job queue infrastructure for progress tracking.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { generateSpec } from "./spec-generation.service.js";
import { storeSpecAndEmbedding } from "./workbench-embeddings.service.js";
import {
  type BatchJob,
  type BatchJobSummary,
  jobs,
  generateJobId,
  toSummary,
  getRunningJobForCategory,
} from "./workbench-batch.service.js";

const logger = createLogger("workbench-backfill-specs");

export async function startBatchBackfillSpecs(categoryId: string, regenerate?: boolean, missingTraining?: boolean): Promise<BatchJobSummary> {
  const existing = getRunningJobForCategory(categoryId);
  if (existing) {
    const err = new Error("A batch job is already running for this category");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const cat = await prisma.workbenchCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!cat) throw new Error("Category not found");

  // Find prompts based on mode:
  // - regenerate: all prompts (re-run spec gen for everything)
  // - missingTraining: have spec but missing training data (spec_raw_response)
  // - default: only prompts with no spec at all
  const filter = regenerate
    ? {}
    : missingTraining
      ? { specInterpretation: { not: null }, specRawResponse: null }
      : { specInterpretation: null };

  const promptRows = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId, ...filter },
    select: { id: true, prompt: true, index: true },
    orderBy: { index: "asc" },
  });

  if (promptRows.length === 0) {
    const msg = regenerate
      ? "No prompts found in this category"
      : missingTraining
        ? "All prompts in this category already have spec training data"
        : "All prompts in this category already have spec data";
    throw new Error(msg);
  }

  const jobId = generateJobId("batch-backfill-specs");
  const job: BatchJob = {
    jobId,
    type: "batch-backfill-specs",
    categoryId,
    categoryName: cat.name,
    status: "running",
    total: promptRows.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    currentPromptId: null,
    currentPromptText: null,
    exampleId: null,
    results: [],
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    pendingPromptIds: new Set(promptRows.map((p) => p.id)),
    userId: null,
    abortController: new AbortController(),
  };

  jobs.set(jobId, job);
  void runBatchBackfillSpecs(job, promptRows, missingTraining);

  logger.info({ jobId, categoryId, total: promptRows.length }, "batch backfill specs started");
  return toSummary(job);
}

async function runBatchBackfillSpecs(
  job: BatchJob,
  prompts: Array<{ id: string; prompt: string; index: number }>,
  missingTraining?: boolean,
): Promise<void> {
  for (const prompt of prompts) {
    if (job.status === "cancelled") break;

    job.currentPromptId = prompt.id;
    job.currentPromptText = prompt.prompt;
    job.pendingPromptIds.delete(prompt.id);

    try {
      const specResult = await generateSpec(prompt.prompt);

      // In missingTraining mode: only persist training data (raw response + system prompt),
      // preserve existing spec fields (checklist, assertions, etc.) to avoid
      // overwriting curated data with potentially different regenerated values.
      const updateData = missingTraining
        ? {
            specRawResponse: specResult.rawResponse ?? null,
            specSystemPrompt: specResult.systemPrompt ?? null,
          }
        : {
            specInterpretation: specResult.interpretation,
            constructionSpec: specResult.constructionSpec,
            codeAssertions: specResult.codeAssertions as unknown as undefined,
            verificationChecklist: specResult.verificationChecklist,
            verificationCriteria: specResult.verificationCriteria as unknown as undefined,
            specRawResponse: specResult.rawResponse ?? null,
            specSystemPrompt: specResult.systemPrompt ?? null,
          };

      await prisma.workbenchExamplePrompt.update({
        where: { id: prompt.id },
        data: updateData,
      });

      // Store spec embedding for remix matching
      if (specResult.constructionSpec) {
        await storeSpecAndEmbedding(prompt.id, specResult.constructionSpec)
          .catch((err) => logger.warn({ err, promptId: prompt.id }, "spec embedding failed (non-fatal)"));
      }

      job.completed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "success",
        exampleId: null,
        evalScore: null,
        approvalStatus: null,
        error: null,
      });
    } catch (error) {
      job.failed += 1;
      job.results.push({
        promptId: prompt.id,
        promptText: prompt.prompt,
        status: "error",
        exampleId: null,
        evalScore: null,
        approvalStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error({ err: error, promptId: prompt.id }, "backfill spec failed for prompt");
    }
  }

  job.currentPromptId = null;
  job.currentPromptText = null;
  job.status = job.status === "cancelled" ? "cancelled" : "completed";
  job.finishedAt = new Date().toISOString();

  logger.info(
    { jobId: job.jobId, completed: job.completed, failed: job.failed },
    "batch backfill specs finished",
  );
}
