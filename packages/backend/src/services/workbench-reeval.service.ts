/**
 * Workbench Re-Evaluate Service
 *
 * Re-runs the full eval pipeline (assertions + code review + VLM) on an
 * existing workbench example using its current screenshots and code.
 * Updates the example in place — no new code generation or rendering.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { toAnnotatedCriteria } from "../utils/verification-criteria.js";
import { runFullEvaluation, type FullEvalResult } from "./eval-orchestrator.service.js";
import { runWithUsageContext } from "./usage-tracking.service.js";
import { readStorageFile, storageFileExists } from "./file-storage.service.js";
import { getAutoApproveThreshold, getCodeEvalWeight } from "./generation-settings.service.js";
import { shouldAutoApprove } from "./workbench-pipeline-helpers.service.js";
import { flattenStoredCode } from "../utils/code-flatten.js";
import type { LabeledImage } from "./visual-eval.service.js";
import type { CodeAssertion, AnnotatedCriterion } from "./spec-generation.service.js";
import { parseEvalPlan } from "../utils/eval-plan.js";

const logger = createLogger("workbench-reeval");

// ── Screenshot angle mapping ────────────────────────────────────────

const SCREENSHOT_FIELDS: Array<{ angle: string; field: string }> = [
  { angle: "front", field: "screenshotFront" },
  { angle: "back", field: "screenshotBack" },
  { angle: "left", field: "screenshotLeft" },
  { angle: "right", field: "screenshotRight" },
  { angle: "top", field: "screenshotTop" },
  { angle: "bottom", field: "screenshotBottom" },
  { angle: "ortho_45", field: "screenshotOrtho45" },
  { angle: "ortho_45_bottom", field: "screenshotOrtho45Bottom" },
];

// ── Load screenshots from storage ───────────────────────────────────

async function loadScreenshots(example: Record<string, unknown>): Promise<LabeledImage[]> {
  const images: LabeledImage[] = [];
  for (const { angle, field } of SCREENSHOT_FIELDS) {
    const path = example[field] as string | null;
    if (!path) continue;
    if (path.startsWith("data:") || path.length > 500) {
      images.push({ angle, base64: path.replace(/^data:image\/\w+;base64,/, "") });
    } else if (await storageFileExists(path)) {
      const buf = await readStorageFile({ relativePath: path });
      images.push({ angle, base64: buf.toString("base64") });
    }
  }
  return images;
}

// ── Re-evaluate a single example ────────────────────────────────────

export interface ReEvalResult {
  exampleId: string;
  evalScore: number | null;
  visualScore: number | null;
  codeEvalScore: number | null;
  assertionPassRate: number | null;
  approvalStatus: string;
  source: string | null;
}

export async function reEvaluateExample(exampleId: string): Promise<ReEvalResult> {
  const example = await prisma.workbenchExample.findUnique({
    where: { id: exampleId },
    include: {
      promptRef: {
        select: {
          prompt: true,
          constructionSpec: true,
          specInterpretation: true,
          codeAssertions: true,
          verificationChecklist: true,
          verificationCriteria: true,
          evalPlan: true,
          category: { select: { name: true, complexity: true } },
        },
      },
    },
  });
  if (!example) throw new Error(`Example ${exampleId} not found`);
  if (example.renderStatus !== "success") {
    throw new Error(`Example ${exampleId} has render status '${example.renderStatus}' — cannot re-evaluate`);
  }

  const images = await loadScreenshots(example as unknown as Record<string, unknown>);
  if (images.length === 0) {
    throw new Error(`No screenshots available for example ${exampleId}`);
  }

  const code = flattenStoredCode(example.code);
  const codeEvalWeight = await getCodeEvalWeight("workbench");
  const autoApproveThreshold = await getAutoApproveThreshold("workbench");

  logger.info({ exampleId, imageCount: images.length }, "starting re-evaluation");

  let evalResult: FullEvalResult | null = null;
  try {
    evalResult = await runWithUsageContext(
      { workbenchExampleId: exampleId, source: "workbench", sourceLabel: `Re-eval: ${example.promptRef.prompt.slice(0, 60)}` },
      () => runFullEvaluation({
      code,
      userPrompt: example.promptRef.prompt,
      images,
      categoryName: example.promptRef.category.name,
      complexity: example.promptRef.category.complexity,
      codeEvalWeight,
      constructionSpec: example.promptRef.constructionSpec ?? undefined,
      specInterpretation: example.promptRef.specInterpretation ?? undefined,
      codeAssertions: (example.promptRef.codeAssertions as CodeAssertion[] | null) ?? undefined,
      verificationChecklist: (example.promptRef.verificationChecklist as string[] | null) ?? undefined,
      // Validated, not asserted — this is the path a backfill will use, and
      // legacy rows here hold bare strings (issue #33).
      annotatedCriteria: toAnnotatedCriteria(example.promptRef.verificationCriteria),
      evalPlan: parseEvalPlan(example.promptRef.evalPlan ?? null),
    }),
    );
  } catch (err) {
    logger.error({ err, exampleId }, "re-evaluation failed");
    throw err;
  }

  const score = evalResult.compositeScore;
  const mergedIssues = [...evalResult.vlmIssues, ...evalResult.codeIssues];
  const approved = evalResult.assertionsFailed
    ? false
    : shouldAutoApprove(score, autoApproveThreshold, evalResult.checklistResults);

  if (!approved && score !== null && score >= autoApproveThreshold) {
    const clResults = evalResult.checklistResults ?? [];
    const clPassRate = clResults.length > 0
      ? clResults.filter((r) => r.pass).length / clResults.length
      : 1;
    logger.warn({
      exampleId, score, autoApproveThreshold,
      assertionsFailed: evalResult.assertionsFailed,
      checklistCount: clResults.length,
      checklistPassRate: clPassRate,
      checklistFails: clResults.filter((r) => !r.pass).map((r) => r.question?.slice(0, 80)),
    }, "high-scoring example NOT auto-approved — debugging approval gate");
  }

  // Update existing example in place
  await prisma.workbenchExample.update({
    where: { id: exampleId },
    data: {
      evalScore: score,
      visualScore: evalResult.visualScore,
      codeEvalScore: evalResult.codeScore,
      assertionPassRate: evalResult.assertionPassRate,
      evalSource: evalResult.source,
      compositeWeightSource: evalResult.compositeWeightSource ?? null,
      evalIssues: mergedIssues.length > 0 ? mergedIssues : undefined,
      evalSuggestions: evalResult.vlmSuggestions.length > 0 ? evalResult.vlmSuggestions : undefined,
      evalChecklistResults: evalResult.checklistResults ?? undefined,
      vlmModel: evalResult.vlmModel,
      vlmRawResponse: evalResult.vlmRawResponse ?? null,
      vlmReasoning: evalResult.vlmReasoning ?? null,
      vlmSystemPrompt: evalResult.vlmSystemPrompt ?? null,
      codeReviewRawResponse: evalResult.codeReviewRawResponse ?? null,
      codeReviewReasoning: evalResult.codeReviewReasoning ?? null,
      codeReviewSystemPrompt: evalResult.codeReviewSystemPrompt ?? null,
      approvalStatus: approved ? "auto_approved" : "pending",
    },
  });

  logger.info({
    exampleId, score, visualScore: evalResult.visualScore,
    codeEvalScore: evalResult.codeScore, assertionPassRate: evalResult.assertionPassRate,
    approved,
  }, "re-evaluation complete");

  return {
    exampleId,
    evalScore: score,
    visualScore: evalResult.visualScore,
    codeEvalScore: evalResult.codeScore,
    assertionPassRate: evalResult.assertionPassRate,
    approvalStatus: approved ? "auto_approved" : "pending",
    source: evalResult.source,
  };
}
