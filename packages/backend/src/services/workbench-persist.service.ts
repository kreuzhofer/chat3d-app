/**
 * Workbench Persistence Service
 *
 * Handles DB insertion and file storage for workbench examples.
 * Extracted from workbench-codegen.service.ts.
 */

import { prisma } from "../db/prisma.js";
import { writeStorageFile } from "./file-storage.service.js";
import { mapExtension } from "../utils/workbench-code-utils.js";
import type { RenderedFile } from "./rendering.service.js";
import type { RenderedScreenshot } from "./stl-rendering-client.service.js";

// ── DB persistence ───────────────────────────────────────────────────

export async function insertExample(data: {
  id: string;
  promptId: string;
  iteration: number;
  code: string;
  renderStatus: string;
  renderError: string | null;
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFront: string | null;
  screenshotBack: string | null;
  screenshotLeft: string | null;
  screenshotRight: string | null;
  screenshotTop: string | null;
  screenshotBottom: string | null;
  screenshotOrtho45: string | null;
  screenshotOrtho45Bottom: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
  evalScore: number | null;
  evalIssues: string[] | null;
  evalSuggestions: string[] | null;
  evalChecklistResults: Array<{ question: string; pass: boolean; detail: string }> | null;
  approvalStatus: string;
  rejectionNote?: string | null;
  llmModel: string;
  vlmModel: string | null;
  promptTokens: number;
  completionTokens: number;
  visualScore?: number | null;
  codeEvalScore?: number | null;
  assertionPassRate?: number | null;
  evalSource?: string | null;
  experimentRunId?: string | null;
  vlmRawResponse?: string | null;
  vlmReasoning?: string | null;
  vlmSystemPrompt?: string | null;
  codeReviewRawResponse?: string | null;
  codeReviewReasoning?: string | null;
  codeReviewSystemPrompt?: string | null;
  agentConversation?: unknown | null;
  agentSystemPrompt?: string | null;
}): Promise<string> {
  const created = await prisma.workbenchExample.upsert({
    where: { id: data.id },
    create: {
      id: data.id,
      promptId: data.promptId,
      iteration: data.iteration,
      code: data.code,
      renderStatus: data.renderStatus,
      renderError: data.renderError,
      stlPath: data.stlPath,
      stepPath: data.stepPath,
      threemfPath: data.threemfPath,
      screenshotFront: data.screenshotFront,
      screenshotBack: data.screenshotBack,
      screenshotLeft: data.screenshotLeft,
      screenshotRight: data.screenshotRight,
      screenshotTop: data.screenshotTop,
      screenshotBottom: data.screenshotBottom,
      screenshotOrtho45: data.screenshotOrtho45,
      screenshotOrtho45Bottom: data.screenshotOrtho45Bottom,
      screenshotIso: data.screenshotIso,
      screenshotIsoBack: data.screenshotIsoBack,
      evalScore: data.evalScore,
      evalIssues: data.evalIssues ?? undefined,
      evalSuggestions: data.evalSuggestions ?? undefined,
      evalChecklistResults: data.evalChecklistResults ?? undefined,
      approvalStatus: data.approvalStatus,
      rejectionNote: data.rejectionNote ?? null,
      llmModel: data.llmModel,
      vlmModel: data.vlmModel,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      visualScore: data.visualScore ?? null,
      codeEvalScore: data.codeEvalScore ?? null,
      assertionPassRate: data.assertionPassRate ?? null,
      evalSource: data.evalSource ?? null,
      experimentRunId: data.experimentRunId ?? null,
      vlmRawResponse: data.vlmRawResponse ?? null,
      vlmReasoning: data.vlmReasoning ?? null,
      vlmSystemPrompt: data.vlmSystemPrompt ?? null,
      codeReviewRawResponse: data.codeReviewRawResponse ?? null,
      codeReviewReasoning: data.codeReviewReasoning ?? null,
      codeReviewSystemPrompt: data.codeReviewSystemPrompt ?? null,
      agentConversation: data.agentConversation ?? null,
      agentSystemPrompt: data.agentSystemPrompt ?? null,
    },
    update: {
      iteration: data.iteration,
      code: data.code,
      renderStatus: data.renderStatus,
      renderError: data.renderError,
      stlPath: data.stlPath,
      stepPath: data.stepPath,
      threemfPath: data.threemfPath,
      screenshotFront: data.screenshotFront,
      screenshotBack: data.screenshotBack,
      screenshotLeft: data.screenshotLeft,
      screenshotRight: data.screenshotRight,
      screenshotTop: data.screenshotTop,
      screenshotBottom: data.screenshotBottom,
      screenshotOrtho45: data.screenshotOrtho45,
      screenshotOrtho45Bottom: data.screenshotOrtho45Bottom,
      screenshotIso: data.screenshotIso,
      screenshotIsoBack: data.screenshotIsoBack,
      evalScore: data.evalScore,
      evalIssues: data.evalIssues ?? undefined,
      evalSuggestions: data.evalSuggestions ?? undefined,
      evalChecklistResults: data.evalChecklistResults ?? undefined,
      approvalStatus: data.approvalStatus,
      rejectionNote: data.rejectionNote ?? null,
      llmModel: data.llmModel,
      vlmModel: data.vlmModel,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      visualScore: data.visualScore ?? null,
      codeEvalScore: data.codeEvalScore ?? null,
      assertionPassRate: data.assertionPassRate ?? null,
      evalSource: data.evalSource ?? null,
      experimentRunId: data.experimentRunId ?? null,
      vlmRawResponse: data.vlmRawResponse ?? null,
      vlmReasoning: data.vlmReasoning ?? null,
      vlmSystemPrompt: data.vlmSystemPrompt ?? null,
      codeReviewRawResponse: data.codeReviewRawResponse ?? null,
      codeReviewReasoning: data.codeReviewReasoning ?? null,
      codeReviewSystemPrompt: data.codeReviewSystemPrompt ?? null,
      agentConversation: data.agentConversation ?? null,
      agentSystemPrompt: data.agentSystemPrompt ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

// ── File persistence ─────────────────────────────────────────────────

export interface PersistedFilePaths {
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFrontPath: string | null;
  screenshotBackPath: string | null;
  screenshotLeftPath: string | null;
  screenshotRightPath: string | null;
  screenshotTopPath: string | null;
  screenshotBottomPath: string | null;
  screenshotOrtho45Path: string | null;
  screenshotOrtho45BottomPath: string | null;
  screenshotIsoPath: string | null;
  screenshotIsoBackPath: string | null;
}

export async function persistWorkbenchFiles(opts: {
  categoryId: string;
  exampleId: string;
  renderedFiles: RenderedFile[];
  code: string;
  screenshots: RenderedScreenshot[];
}): Promise<PersistedFilePaths> {
  const artifactPrefix = `workbench/${opts.categoryId}/artifacts/${opts.exampleId}`;
  const codePrefix = `workbench/${opts.categoryId}/code/${opts.exampleId}`;

  let stlPath: string | null = null;
  let stepPath: string | null = null;
  let threemfPath: string | null = null;

  for (const file of opts.renderedFiles) {
    const ext = mapExtension(file.filename);
    const relativePath = `${artifactPrefix}.${ext}`;
    await writeStorageFile({ relativePath, contentBase64: file.contentBase64 });
    if (ext === "stl") stlPath = relativePath;
    else if (ext === "step") stepPath = relativePath;
    else if (ext === "3mf") threemfPath = relativePath;
  }

  if (opts.code.trim()) {
    await writeStorageFile({
      relativePath: `${codePrefix}.b123d`,
      contentBase64: Buffer.from(opts.code, "utf-8").toString("base64"),
    });
  }

  const pathsByAngle: Record<string, string> = {};
  for (const ss of opts.screenshots) {
    const ssPath = `${artifactPrefix}-screenshot-${ss.angle}.png`;
    await writeStorageFile({ relativePath: ssPath, contentBase64: ss.base64 });
    pathsByAngle[ss.angle] = ssPath;
  }

  return {
    stlPath,
    stepPath,
    threemfPath,
    screenshotFrontPath: pathsByAngle["front"] ?? null,
    screenshotBackPath: pathsByAngle["back"] ?? null,
    screenshotLeftPath: pathsByAngle["left"] ?? null,
    screenshotRightPath: pathsByAngle["right"] ?? null,
    screenshotTopPath: pathsByAngle["top"] ?? null,
    screenshotBottomPath: pathsByAngle["bottom"] ?? null,
    screenshotOrtho45Path: pathsByAngle["ortho_45"] ?? null,
    screenshotOrtho45BottomPath: pathsByAngle["ortho_45_bottom"] ?? null,
    screenshotIsoPath: pathsByAngle["isometric"] ?? null,
    screenshotIsoBackPath: pathsByAngle["isometric_back"] ?? null,
  };
}
