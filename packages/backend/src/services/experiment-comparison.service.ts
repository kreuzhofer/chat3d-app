/**
 * Experiment Comparison Service
 *
 * Computes aggregate and per-prompt comparison metrics across experiment runs.
 */

import { prisma } from "../db/prisma.js";
import { ExperimentError } from "./experiment.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("experiment-compare");

// ── Types ───────────────────────────────────────────────────────────

interface RunMetrics {
  runId: string;
  modelLabel: string;
  runOrder: number;
  totalPrompts: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgEvalScore: number | null;
  avgVisualScore: number | null;
  avgCodeEvalScore: number | null;
  avgAssertionPassRate: number | null;
  autoApprovalRate: number;
  avgSteps: number | null;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
  totalCostUsd: number | null;
  avgLlmCalls: number | null;
}

interface PromptRunResult {
  runId: string;
  modelLabel: string;
  exampleId: string | null;
  evalScore: number | null;
  visualScore: number | null;
  codeEvalScore: number | null;
  renderStatus: string | null;
  approvalStatus: string | null;
  durationMs: number | null;
  costUsd: number | null;
  totalSteps: number | null;
  renderError: string | null;
  failureReason: string | null;
}

interface PromptComparison {
  promptId: string;
  promptText: string;
  promptIndex: number;
  runs: PromptRunResult[];
}

// ── Aggregate comparison ────────────────────────────────────────────

interface AggRow {
  run_id: string;
  model_label: string;
  run_order: number;
  total_prompts: string;
  success_count: string;
  failed_count: string;
  avg_eval_score: number | null;
  avg_visual_score: number | null;
  avg_code_eval_score: number | null;
  avg_assertion_pass_rate: number | null;
  auto_approved_count: string;
}

interface TraceAggRow {
  run_id: string;
  avg_steps: number | null;
  avg_duration_ms: number | null;
  avg_cost_usd: number | null;
  total_cost_usd: number | null;
  avg_llm_calls: number | null;
}

export async function getExperimentComparison(experimentId: string): Promise<{ runs: RunMetrics[] }> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  // Aggregate example metrics per run
  const aggRows = await prisma.$queryRaw<AggRow[]>`
    SELECT
      r.id AS run_id,
      r.model_label,
      r.run_order,
      COUNT(e.id)::text AS total_prompts,
      COUNT(CASE WHEN e.render_status = 'success' THEN 1 END)::text AS success_count,
      COUNT(CASE WHEN e.render_status = 'error' THEN 1 END)::text AS failed_count,
      AVG(e.eval_score) FILTER (WHERE e.eval_score IS NOT NULL) AS avg_eval_score,
      AVG(e.visual_score) FILTER (WHERE e.visual_score IS NOT NULL) AS avg_visual_score,
      AVG(e.code_eval_score) FILTER (WHERE e.code_eval_score IS NOT NULL) AS avg_code_eval_score,
      AVG(e.assertion_pass_rate) FILTER (WHERE e.assertion_pass_rate IS NOT NULL) AS avg_assertion_pass_rate,
      COUNT(CASE WHEN e.approval_status = 'auto_approved' THEN 1 END)::text AS auto_approved_count
    FROM experiment_runs r
    LEFT JOIN workbench_examples e ON e.experiment_run_id = r.id
    WHERE r.experiment_id = ${experimentId}::uuid
    GROUP BY r.id, r.model_label, r.run_order
    ORDER BY r.run_order
  `;

  // Aggregate trace metrics per run
  const traceRows = await prisma.$queryRaw<TraceAggRow[]>`
    SELECT
      r.id AS run_id,
      AVG(t.total_steps) AS avg_steps,
      AVG(t.total_duration_ms) AS avg_duration_ms,
      AVG(t.total_cost_usd) AS avg_cost_usd,
      SUM(t.total_cost_usd) AS total_cost_usd,
      AVG(t.total_llm_calls) AS avg_llm_calls
    FROM experiment_runs r
    JOIN workbench_examples e ON e.experiment_run_id = r.id
    JOIN generation_traces t ON t.workbench_example_id = e.id
    WHERE r.experiment_id = ${experimentId}::uuid
    GROUP BY r.id
  `;
  const traceMap = new Map(traceRows.map((t) => [t.run_id, t]));

  const runs: RunMetrics[] = aggRows.map((row) => {
    const total = Number(row.total_prompts);
    const success = Number(row.success_count);
    const autoApproved = Number(row.auto_approved_count);
    const trace = traceMap.get(row.run_id);

    return {
      runId: row.run_id,
      modelLabel: row.model_label,
      runOrder: row.run_order,
      totalPrompts: total,
      successCount: success,
      failedCount: Number(row.failed_count),
      successRate: total > 0 ? Math.round((success / total) * 1000) / 1000 : 0,
      avgEvalScore: row.avg_eval_score != null ? Math.round(Number(row.avg_eval_score) * 10) / 10 : null,
      avgVisualScore: row.avg_visual_score != null ? Math.round(Number(row.avg_visual_score) * 10) / 10 : null,
      avgCodeEvalScore: row.avg_code_eval_score != null ? Math.round(Number(row.avg_code_eval_score) * 10) / 10 : null,
      avgAssertionPassRate: row.avg_assertion_pass_rate != null ? Math.round(Number(row.avg_assertion_pass_rate) * 100) / 100 : null,
      autoApprovalRate: total > 0 ? Math.round((autoApproved / total) * 1000) / 1000 : 0,
      avgSteps: trace?.avg_steps != null ? Math.round(Number(trace.avg_steps) * 10) / 10 : null,
      avgDurationMs: trace?.avg_duration_ms != null ? Math.round(Number(trace.avg_duration_ms)) : null,
      avgCostUsd: trace?.avg_cost_usd != null ? Number(Number(trace.avg_cost_usd).toFixed(6)) : null,
      totalCostUsd: trace?.total_cost_usd != null ? Number(Number(trace.total_cost_usd).toFixed(6)) : null,
      avgLlmCalls: trace?.avg_llm_calls != null ? Math.round(Number(trace.avg_llm_calls) * 10) / 10 : null,
    };
  });

  return { runs };
}

// ── Per-prompt comparison ───────────────────────────────────────────

interface PromptResultRow {
  prompt_id: string;
  prompt_text: string;
  prompt_index: number;
  run_id: string;
  model_label: string;
  example_id: string | null;
  eval_score: number | null;
  visual_score: number | null;
  code_eval_score: number | null;
  render_status: string | null;
  approval_status: string | null;
  total_duration_ms: number | null;
  total_cost_usd: number | null;
  total_steps: number | null;
  render_error: string | null;
  failure_reason: string | null;
}

export async function getPerPromptComparison(experimentId: string): Promise<PromptComparison[]> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  // Extract failure reason from the last failed node in the trace JSON
  const rows = await prisma.$queryRaw<PromptResultRow[]>`
    SELECT
      eps.prompt_id,
      p.prompt AS prompt_text,
      p.index AS prompt_index,
      r.id AS run_id,
      r.model_label,
      e.id AS example_id,
      e.eval_score,
      e.visual_score,
      e.code_eval_score,
      e.render_status,
      e.approval_status,
      t.total_duration_ms,
      t.total_cost_usd,
      t.total_steps,
      e.render_error,
      (
        SELECT n->>'error'
        FROM jsonb_array_elements(t.trace->'nodes') n
        WHERE n->>'error' IS NOT NULL AND n->>'status' = 'failed'
        ORDER BY jsonb_array_length(t.trace->'nodes') DESC
        LIMIT 1
      ) AS failure_reason
    FROM experiment_prompt_selections eps
    CROSS JOIN experiment_runs r
    JOIN workbench_example_prompts p ON p.id = eps.prompt_id
    LEFT JOIN workbench_examples e ON e.experiment_run_id = r.id AND e.prompt_id = eps.prompt_id
    LEFT JOIN generation_traces t ON t.workbench_example_id = e.id
    WHERE eps.experiment_id = ${experimentId}::uuid
      AND r.experiment_id = ${experimentId}::uuid
    ORDER BY eps.selection_order, r.run_order
  `;

  // Group by prompt
  const byPrompt = new Map<string, PromptComparison>();
  for (const row of rows) {
    let entry = byPrompt.get(row.prompt_id);
    if (!entry) {
      entry = {
        promptId: row.prompt_id,
        promptText: row.prompt_text,
        promptIndex: row.prompt_index,
        runs: [],
      };
      byPrompt.set(row.prompt_id, entry);
    }
    entry.runs.push({
      runId: row.run_id,
      modelLabel: row.model_label,
      exampleId: row.example_id,
      evalScore: row.eval_score != null ? Number(row.eval_score) : null,
      visualScore: row.visual_score != null ? Number(row.visual_score) : null,
      codeEvalScore: row.code_eval_score != null ? Number(row.code_eval_score) : null,
      renderStatus: row.render_status,
      approvalStatus: row.approval_status,
      durationMs: row.total_duration_ms != null ? Number(row.total_duration_ms) : null,
      costUsd: row.total_cost_usd != null ? Number(row.total_cost_usd) : null,
      totalSteps: row.total_steps != null ? Number(row.total_steps) : null,
      renderError: row.render_error,
      failureReason: row.failure_reason,
    });
  }

  return [...byPrompt.values()];
}

// ── Run examples ────────────────────────────────────────────────────

export async function getRunExamples(experimentId: string, runId: string) {
  const run = await prisma.experimentRun.findFirst({
    where: { id: runId, experimentId },
    select: { id: true },
  });
  if (!run) throw new ExperimentError("Run not found", 404);

  const examples = await prisma.workbenchExample.findMany({
    where: { experimentRunId: runId },
    include: {
      promptRef: { select: { prompt: true, index: true } },
      generationTrace: {
        select: { totalDurationMs: true, totalCostUsd: true, totalSteps: true, totalLlmCalls: true, finalStatus: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return examples.map((e) => ({
    id: e.id,
    promptId: e.promptId,
    promptText: e.promptRef.prompt,
    promptIndex: e.promptRef.index,
    evalScore: e.evalScore != null ? Number(e.evalScore) : null,
    visualScore: e.visualScore != null ? Number(e.visualScore) : null,
    codeEvalScore: e.codeEvalScore != null ? Number(e.codeEvalScore) : null,
    renderStatus: e.renderStatus,
    renderError: e.renderError,
    approvalStatus: e.approvalStatus,
    llmModel: e.llmModel,
    screenshotIso: e.screenshotIso,
    trace: e.generationTrace
      ? {
          durationMs: e.generationTrace.totalDurationMs,
          costUsd: e.generationTrace.totalCostUsd != null ? Number(e.generationTrace.totalCostUsd) : null,
          steps: e.generationTrace.totalSteps,
          llmCalls: e.generationTrace.totalLlmCalls,
          status: e.generationTrace.finalStatus,
        }
      : null,
    createdAt: e.createdAt,
  }));
}
