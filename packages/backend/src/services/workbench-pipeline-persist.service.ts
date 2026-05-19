/**
 * Workbench Pipeline Persistence — Error Paths
 *
 * Handles persisting examples for aborted and rejected pipelines.
 * Extracted from workbench-codegen.service.ts.
 */

import { createLogger } from "../utils/logger.js";
import { flattenForEval } from "../utils/code-flatten.js";
import { markTimeoutObserved } from "./decomposition-decision.service.js";
import { TraceBuilder } from "./trace-builder.service.js";
import { finalizeTrace } from "./trace-persistence.service.js";
import { insertExample } from "./workbench-persist.service.js";
import { runAgentCodegen } from "./agent-codegen.service.js";
import type { LlmModelConfig } from "./llm-config.service.js";
import type { GenerateResult, ProgressCallback } from "./workbench-codegen.service.js";
import {
  type PromptContext,
  NULL_SCREENSHOTS,
  earlyExitResult,
} from "./workbench-pipeline-helpers.service.js";
import crypto from "node:crypto";

const logger = createLogger("workbench");

// ── Aborted pipeline persistence ─────────────────────────────────────

export async function persistAbortedPipeline(
  ctx: PromptContext,
  agResult: Awaited<ReturnType<typeof runAgentCodegen>>,
  modelConfig: LlmModelConfig,
  traceBuilder: TraceBuilder,
  traceId: string | null,
  experimentRunId?: string,
): Promise<GenerateResult> {
  logger.info({ promptId: ctx.promptId, stepCount: agResult.stepCount }, "pipeline aborted — skipping screenshots/eval");

  // Failure-aware retro-routing: a single-agent run that aborted on timeout
  // with zero tool calls is a clear over-reasoning hang. Pin future routing
  // for this (prompt, model) pair to multi-agent so the next run doesn't
  // repeat the same dead end. Only fires on the workbench path (promptId set).
  if (ctx.promptId && agResult.stepCount === 0) {
    await markTimeoutObserved(ctx.promptId, modelConfig.id);
  }

  const exampleId = crypto.randomUUID();
  const code = flattenForEval(agResult.files.length > 1 ? agResult.files : [{ path: "main.py", content: agResult.code }]);
  const renderError = "Pipeline aborted (timeout or cancellation)";
  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code,
    renderStatus: "error", renderError,
    stlPath: null, stepPath: null, threemfPath: null, ...NULL_SCREENSHOTS,
    evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "pending", llmModel: modelConfig.label, vlmModel: null,
    promptTokens: agResult.usage.promptTokens, completionTokens: agResult.usage.completionTokens,
    experimentRunId,
  });
  const abortInfo = TraceBuilder.classifyError(new Error(renderError));
  traceBuilder.endPhase("failed", { error: renderError, errorInfo: abortInfo });
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });
  return earlyExitResult({ exampleId, promptId: ctx.promptId, iteration: agResult.stepCount, code, renderError, approvalStatus: "pending", llmModel: modelConfig.label });
}

// ── Rejected prompt persistence ──────────────────────────────────────

export async function persistRejectedPrompt(
  ctx: PromptContext,
  validation: { reason?: string; promptTokens: number; completionTokens: number },
  llmModelLabel: string,
  traceBuilder: TraceBuilder,
  traceId: string | null,
  onProgress?: ProgressCallback,
  experimentRunId?: string,
): Promise<GenerateResult> {
  logger.info({ reason: validation.reason }, "prompt rejected by validation");
  onProgress?.("failed", `Prompt validation failed: ${validation.reason}`);
  const exampleId = crypto.randomUUID();
  const renderError = `Prompt validation failed: ${validation.reason}`;
  await insertExample({
    id: exampleId, promptId: ctx.promptId, iteration: 0,
    code: "-- PROMPT VALIDATION REJECTED --", renderStatus: "error", renderError,
    stlPath: null, stepPath: null, threemfPath: null, ...NULL_SCREENSHOTS,
    evalScore: null, evalIssues: null, evalSuggestions: null, evalChecklistResults: null,
    approvalStatus: "rejected", rejectionNote: validation.reason,
    llmModel: llmModelLabel, vlmModel: null,
    promptTokens: validation.promptTokens, completionTokens: validation.completionTokens,
    experimentRunId,
  });
  traceBuilder.endPhase("completed");
  await finalizeTrace(traceId, { workbenchExampleId: exampleId, trace: traceBuilder.build(), summary: traceBuilder.computeSummary() });
  return earlyExitResult({ exampleId, promptId: ctx.promptId, iteration: 0, code: "-- PROMPT VALIDATION REJECTED --", renderError, approvalStatus: "rejected", llmModel: llmModelLabel });
}
