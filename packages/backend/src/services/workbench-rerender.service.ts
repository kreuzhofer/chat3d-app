/**
 * Workbench Re-Render Service
 *
 * Re-render pipeline: takes existing code, renders via Build123d,
 * takes screenshots, runs evaluation, persists as new example.
 * No AI codegen — no fix loop.
 *
 * Extracted from workbench-codegen.service.ts.
 */

import crypto from "node:crypto";
import { createLogger } from "../utils/logger.js";
import { prisma } from "../db/prisma.js";
import { renderBuild123d, type RenderedFile } from "./rendering.service.js";
import { renderModelScreenshots, type RenderedScreenshot } from "./stl-rendering-client.service.js";
import type { CodeAssertion, AnnotatedCriterion } from "./spec-generation.service.js";
import { runFullEvaluation, type FullEvalResult } from "./eval-orchestrator.service.js";
import { persistTrace } from "./trace-persistence.service.js";
import { TraceBuilder, runWithTrace } from "./trace-builder.service.js";
import { WorkbenchCatalogError as WorkbenchSeederError } from "./workbench-catalog.service.js";
import { getAutoApproveThreshold, getCodeEvalWeight } from "./generation-settings.service.js";
import { insertExample, persistWorkbenchFiles } from "./workbench-persist.service.js";
import { wrapInTemplate, findFileByExtension } from "../utils/workbench-code-utils.js";
import { flattenStoredCode } from "../utils/code-flatten.js";
import type { GenerateResult, ProgressCallback } from "./workbench-codegen.service.js";

const logger = createLogger("workbench-rerender");

// ── Approval logic (duplicated from codegen for isolation) ──────────

function shouldAutoApprove(
  score: number | null,
  threshold: number,
  checklistResults?: Array<{ pass: boolean }> | null,
  renderSuccess?: boolean,
): boolean {
  if (renderSuccess === false) return false;
  if (score === null || score < threshold) return false;
  if (!checklistResults || checklistResults.length === 0) return true;
  const passCount = checklistResults.filter((r) => r.pass).length;
  const passRate = passCount / checklistResults.length;
  return passRate >= 0.8;
}

// ── Prompt context loading ──────────────────────────────────────────

async function loadPromptContext(promptId: string) {
  const row = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: promptId },
    include: { category: true },
  });
  if (!row) throw new WorkbenchSeederError("Prompt not found", 404);
  return {
    promptId: row.id,
    prompt: row.prompt,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    complexity: row.category.complexity,
    constructionSpec: row.constructionSpec ?? undefined,
    specInterpretation: row.specInterpretation ?? undefined,
    codeAssertions: (row.codeAssertions as unknown[] | null) ?? undefined,
    verificationChecklist: (row.verificationChecklist as string[] | null) ?? undefined,
    verificationCriteria: (row.verificationCriteria as unknown[] | null) ?? undefined,
  };
}

// ── Re-render pipeline ──────────────────────────────────────────────

export async function reRenderForExample(
  exampleId: string,
  onProgress?: ProgressCallback,
): Promise<GenerateResult> {
  logger.info({ exampleId }, "starting re-render for example");

  const { getExample: getExampleDetail } = await import("./workbench-examples.service.js");
  const existingExample = await getExampleDetail(exampleId);
  const code = existingExample.code;

  if (!code || code.trim() === "") {
    throw new WorkbenchSeederError("Example has no code to re-render", 400);
  }

  const ctx = await loadPromptContext(existingExample.promptId);
  const rrAutoApprove = await getAutoApproveThreshold("workbench");

  // Render with Build123d
  onProgress?.("rendering", "Rendering 3D model...");
  const baseFileName = `wb-${ctx.promptId.slice(0, 8)}-rerender`;
  const executableCode = wrapInTemplate(code, baseFileName);

  let renderedFiles: RenderedFile[] = [];
  let renderError: string | null = null;

  try {
    const renderResult = await renderBuild123d({ code: executableCode, baseFileName });
    renderedFiles = renderResult.files;
    logger.info({ fileCount: renderedFiles.length }, "Build123d re-render success");
  } catch (error) {
    renderError = error instanceof Error ? error.message : String(error);
    onProgress?.("failed", renderError);
    logger.warn({ exampleId, renderError }, "re-render failed — stopping");

    const failedExampleId = crypto.randomUUID();
    await insertExample({
      id: failedExampleId, promptId: ctx.promptId, iteration: 0, code,
      renderStatus: "error", renderError,
      stlPath: null, stepPath: null, threemfPath: null,
      screenshotFront: null, screenshotBack: null, screenshotLeft: null,
      screenshotRight: null, screenshotTop: null, screenshotBottom: null,
      screenshotOrtho45: null, screenshotOrtho45Bottom: null,
      screenshotIso: null, screenshotIsoBack: null,
      evalScore: null, evalIssues: null, evalSuggestions: null,
      evalChecklistResults: null, approvalStatus: "pending",
      llmModel: existingExample.llmModel ?? "unknown", vlmModel: null, promptTokens: 0, completionTokens: 0,
    });

    return {
      exampleId: failedExampleId, promptId: ctx.promptId, iteration: 0, code,
      renderStatus: "error", renderError,
      evalScore: null, evalIssues: null, evalSuggestions: null,
      evalChecklistResults: null, approvalStatus: "pending",
      llmModel: existingExample.llmModel ?? "unknown", vlmModel: null,
    };
  }

  // Screenshots
  onProgress?.("screenshots", "Taking screenshots...");
  let screenshots: RenderedScreenshot[] = [];
  let screenshotFailed = false;
  const stlFile = findFileByExtension(renderedFiles, ".stl");
  if (stlFile) {
    try {
      const ssResult = await renderModelScreenshots({
        modelData: stlFile.contentBase64, format: "stl",
      });
      screenshots = ssResult.images;
    } catch (error) {
      screenshotFailed = true;
      logger.error({ err: error, exampleId }, "screenshot failed during re-render — VLM eval will be skipped");
    }
  }

  // Full evaluation — VLM + code eval + assertions (uses stored spec from prompt)
  onProgress?.("evaluating", "Evaluating quality...");

  // Create a trace builder for re-render pipeline
  const traceBuilder = new TraceBuilder("single_agent");
  traceBuilder.startPhase("root", "root", "Re-Render Pipeline");

  const evalResult = await runWithTrace(traceBuilder, async () => {
    let rrFullEval: FullEvalResult | null = null;
    const vlmImages = screenshots.filter(s => s.angle !== "isometric").map(s => ({ angle: s.angle, base64: s.base64 }));
    const rrCodeEvalWeight = await getCodeEvalWeight("workbench");
    const evalCode = flattenStoredCode(code);
    if (vlmImages.length > 0 || evalCode.trim()) {
      rrFullEval = await runFullEvaluation({
        code: evalCode, userPrompt: ctx.prompt, images: vlmImages,
        categoryName: ctx.categoryName, complexity: ctx.complexity,
        stlBase64: stlFile?.contentBase64, modelFormat: "stl",
        codeEvalWeight: rrCodeEvalWeight,
        constructionSpec: ctx.constructionSpec,
        specInterpretation: ctx.specInterpretation,
        codeAssertions: ctx.codeAssertions as CodeAssertion[] | undefined,
        verificationChecklist: ctx.verificationChecklist,
        annotatedCriteria: ctx.verificationCriteria as AnnotatedCriterion[] | undefined,
      });
    }
    return rrFullEval;
  });

  const score = evalResult?.compositeScore ?? null;
  // VLM is mandatory: if screenshots failed, never auto-approve
  const approved = screenshotFailed
    ? false
    : evalResult?.assertionsFailed
      ? false
      : shouldAutoApprove(score, rrAutoApprove, evalResult?.checklistResults);
  if (screenshotFailed) {
    logger.warn({ exampleId }, "screenshots failed, VLM eval skipped — blocking auto-approval");
  }

  const rrMergedIssues = [...(evalResult?.vlmIssues ?? []), ...(evalResult?.codeIssues ?? [])];

  const newExampleId = crypto.randomUUID();
  const filePaths = await persistWorkbenchFiles({
    categoryId: ctx.categoryId, exampleId: newExampleId,
    renderedFiles, code, screenshots,
  });

  await insertExample({
    id: newExampleId, promptId: ctx.promptId, iteration: 0, code,
    renderStatus: "success", renderError: null,
    stlPath: filePaths.stlPath, stepPath: filePaths.stepPath,
    threemfPath: filePaths.threemfPath,
    screenshotFront: filePaths.screenshotFrontPath,
    screenshotBack: filePaths.screenshotBackPath,
    screenshotLeft: filePaths.screenshotLeftPath,
    screenshotRight: filePaths.screenshotRightPath,
    screenshotTop: filePaths.screenshotTopPath,
    screenshotBottom: filePaths.screenshotBottomPath,
    screenshotOrtho45: filePaths.screenshotOrtho45Path,
    screenshotOrtho45Bottom: filePaths.screenshotOrtho45BottomPath,
    screenshotIso: filePaths.screenshotIsoPath,
    screenshotIsoBack: filePaths.screenshotIsoBackPath,
    evalScore: score,
    evalIssues: rrMergedIssues.length > 0 ? rrMergedIssues : null,
    evalSuggestions: evalResult?.vlmSuggestions ?? null,
    evalChecklistResults: evalResult?.checklistResults ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: existingExample.llmModel ?? "unknown", vlmModel: evalResult?.vlmModel ?? null,
    promptTokens: evalResult?.totalPromptTokens ?? 0,
    completionTokens: evalResult?.totalCompletionTokens ?? 0,
    visualScore: evalResult?.visualScore ?? null,
    codeEvalScore: evalResult?.codeScore ?? null,
    assertionPassRate: evalResult?.assertionPassRate ?? null,
    evalSource: evalResult?.source ?? null,
  });

  // Persist trace
  traceBuilder.endPhase("completed");
  const trace = traceBuilder.build();
  const summary = traceBuilder.computeSummary();
  persistTrace({
    workbenchExampleId: newExampleId, pipelineType: trace.pipelineType,
    trace, summary,
  }).catch(err => logger.warn({ err }, "re-render trace persistence failed"));

  onProgress?.("completed", "Done");
  logger.info({ exampleId: newExampleId, score, status: approved ? "auto_approved" : "pending" }, "re-render example persisted");

  return {
    exampleId: newExampleId, promptId: ctx.promptId, iteration: 0, code,
    renderStatus: "success", renderError: null, evalScore: score,
    evalIssues: rrMergedIssues.length > 0 ? rrMergedIssues : null,
    evalSuggestions: evalResult?.vlmSuggestions ?? null,
    evalChecklistResults: evalResult?.checklistResults ?? null,
    approvalStatus: approved ? "auto_approved" : "pending",
    llmModel: existingExample.llmModel ?? "unknown", vlmModel: evalResult?.vlmModel ?? null,
  };
}
