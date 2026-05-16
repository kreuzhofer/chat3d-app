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
  fewShotCount: number | null;
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
  avgOutputTps: number | null;
}

interface BaselineMetrics {
  llmModel: string | null;
  totalPrompts: number;
  successCount: number;
  successRate: number;
  avgEvalScore: number | null;
  avgVisualScore: number | null;
  avgCodeEvalScore: number | null;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
}

interface PromptRunResult {
  runId: string;
  modelLabel: string;
  fewShotCount: number | null;
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
  baseline?: {
    evalScore: number;
    visualScore: number | null;
    codeEvalScore: number | null;
    durationMs: number | null;
    costUsd: number | null;
    totalSteps: number | null;
    llmModel: string | null;
  };
}

// ── Aggregate comparison ────────────────────────────────────────────

interface AggRow {
  run_id: string;
  model_label: string;
  run_order: number;
  few_shot_count: number | null;
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

interface TpsAggRow {
  run_id: string;
  avg_output_tps: number | null;
}

export async function getExperimentComparison(experimentId: string): Promise<{ runs: RunMetrics[]; baseline: BaselineMetrics | null }> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true } });
  if (!exp) throw new ExperimentError("Experiment not found", 404);

  // Aggregate example metrics per run
  const aggRows = await prisma.$queryRaw<AggRow[]>`
    SELECT
      r.id AS run_id,
      r.model_label,
      r.run_order,
      r.few_shot_count,
      COUNT(CASE WHEN e.eval_score IS NOT NULL OR e.render_status = 'error' THEN 1 END)::text AS total_prompts,
      COUNT(CASE WHEN e.approval_status IN ('auto_approved', 'human_approved') THEN 1 END)::text AS success_count,
      COUNT(CASE WHEN (e.eval_score IS NOT NULL AND e.eval_score < 7.5) OR e.render_status = 'error' THEN 1 END)::text AS failed_count,
      AVG(e.eval_score) FILTER (WHERE e.eval_score IS NOT NULL) AS avg_eval_score,
      AVG(e.visual_score) FILTER (WHERE e.visual_score IS NOT NULL) AS avg_visual_score,
      AVG(e.code_eval_score) FILTER (WHERE e.code_eval_score IS NOT NULL) AS avg_code_eval_score,
      AVG(e.assertion_pass_rate) FILTER (WHERE e.assertion_pass_rate IS NOT NULL) AS avg_assertion_pass_rate,
      COUNT(CASE WHEN e.approval_status = 'auto_approved' THEN 1 END)::text AS auto_approved_count
    FROM experiment_runs r
    LEFT JOIN workbench_examples e ON e.experiment_run_id = r.id
    WHERE r.experiment_id = ${experimentId}::uuid
    GROUP BY r.id, r.model_label, r.run_order, r.few_shot_count
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

  // Aggregate output TPS per run from usage events
  // Note: workbench_example_id in usage events stores the prompt_id (not example id),
  // so we join via prompt_id. We also time-scope events to the run's execution window.
  // Use stored value if present, otherwise compute from output_tokens / duration_ms.
  const tpsRows = await prisma.$queryRaw<TpsAggRow[]>`
    SELECT
      r.id AS run_id,
      AVG(
        COALESCE(
          u.output_tokens_per_second,
          CASE WHEN u.duration_ms > 0 AND u.output_tokens > 0
               THEN (u.output_tokens::numeric / u.duration_ms * 1000)
               ELSE NULL END
        )
      ) AS avg_output_tps
    FROM experiment_runs r
    JOIN workbench_examples e ON e.experiment_run_id = r.id
    JOIN llm_usage_events u ON u.workbench_example_id = e.prompt_id
      AND u.output_tokens > 0 AND u.duration_ms > 0
      AND u.created_at >= r.started_at
      AND u.created_at <= COALESCE(r.completed_at, NOW())
    WHERE r.experiment_id = ${experimentId}::uuid
    GROUP BY r.id
  `;
  const tpsMap = new Map(tpsRows.map((t) => [t.run_id, t]));

  const runs: RunMetrics[] = aggRows.map((row) => {
    const total = Number(row.total_prompts);
    const success = Number(row.success_count);
    const autoApproved = Number(row.auto_approved_count);
    const trace = traceMap.get(row.run_id);
    const tps = tpsMap.get(row.run_id);

    return {
      runId: row.run_id,
      modelLabel: row.model_label,
      runOrder: row.run_order,
      fewShotCount: row.few_shot_count,
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
      avgOutputTps: tps?.avg_output_tps != null ? Math.round(Number(tps.avg_output_tps) * 100) / 100 : null,
    };
  });

  const baseline = await getBaselineMetricsForExperiment(experimentId);
  return { runs, baseline };
}

// ── Baseline aggregate ──────────────────────────────────────────────

export async function getBaselineMetricsForExperiment(
  experimentId: string,
): Promise<BaselineMetrics | null> {
  const promptIds = await prisma.$queryRaw<Array<{ prompt_id: string }>>`
    SELECT DISTINCT e.prompt_id
    FROM workbench_examples e
    INNER JOIN experiment_runs r ON r.id = e.experiment_run_id
    WHERE r.experiment_id = ${experimentId}::uuid
  `;

  if (promptIds.length === 0) return null;

  const ids = promptIds.map(p => p.prompt_id);

  const rows = await prisma.$queryRaw<Array<{
    eval_score: number;
    visual_score: number | null;
    code_eval_score: number | null;
    total_duration_ms: number | null;
    total_cost_usd: number | null;
    llm_model: string | null;
  }>>`
    SELECT DISTINCT ON (e.prompt_id)
      e.eval_score,
      e.visual_score,
      e.code_eval_score,
      t.total_duration_ms,
      t.total_cost_usd,
      e.llm_model
    FROM workbench_examples e
    LEFT JOIN generation_traces t ON t.workbench_example_id = e.id
    WHERE e.prompt_id = ANY(${ids}::uuid[])
      AND e.experiment_run_id IS NULL
      AND e.eval_score IS NOT NULL
      AND e.approval_status = 'auto_approved'
    ORDER BY e.prompt_id, e.eval_score DESC
  `;

  if (rows.length === 0) return null;

  const avg = (vals: Array<number | null>) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  const labelCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.llm_model) labelCounts.set(r.llm_model, (labelCounts.get(r.llm_model) ?? 0) + 1);
  }
  const llmModel = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const avgCost = avg(rows.map(r => r.total_cost_usd != null ? Number(r.total_cost_usd) : null));

  return {
    llmModel,
    totalPrompts: promptIds.length,
    successCount: rows.length,
    successRate: rows.length / promptIds.length,
    avgEvalScore: avg(rows.map(r => Number(r.eval_score))),
    avgVisualScore: avg(rows.map(r => r.visual_score != null ? Number(r.visual_score) : null)),
    avgCodeEvalScore: avg(rows.map(r => r.code_eval_score != null ? Number(r.code_eval_score) : null)),
    avgDurationMs: avg(rows.map(r => r.total_duration_ms != null ? Number(r.total_duration_ms) : null)),
    avgCostUsd: avgCost != null ? Number(avgCost.toFixed(6)) : null,
  };
}

// ── Per-prompt comparison ───────────────────────────────────────────

interface PromptResultRow {
  prompt_id: string;
  prompt_text: string;
  prompt_index: number;
  run_id: string;
  model_label: string;
  few_shot_count: number | null;
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
      r.few_shot_count,
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
    ORDER BY eps.selection_order, r.run_order, r.created_at, r.id
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
      fewShotCount: row.few_shot_count,
      exampleId: row.example_id,
      evalScore: row.eval_score != null ? Number(row.eval_score) : null,
      visualScore: row.visual_score != null ? Number(row.visual_score) : null,
      codeEvalScore: row.code_eval_score != null ? Number(row.code_eval_score) : null,
      renderStatus: row.render_status,
      approvalStatus: row.approval_status,
      durationMs: row.total_duration_ms != null ? Number(row.total_duration_ms) : null,
      costUsd: row.total_cost_usd != null ? Number(Number(row.total_cost_usd).toFixed(6)) : null,
      totalSteps: row.total_steps != null ? Number(row.total_steps) : null,
      renderError: row.render_error,
      failureReason: row.failure_reason,
    });
  }

  // Fetch baseline scores: best non-experiment approved example per prompt
  const promptIds = [...byPrompt.keys()];
  if (promptIds.length > 0) {
    const baselines = await prisma.$queryRaw<Array<{
      prompt_id: string;
      eval_score: number;
      visual_score: number | null;
      code_eval_score: number | null;
      total_steps: number | null;
      total_duration_ms: number | null;
      total_cost_usd: number | null;
      llm_model: string | null;
    }>>`
      SELECT DISTINCT ON (e.prompt_id)
        e.prompt_id,
        e.eval_score,
        e.visual_score,
        e.code_eval_score,
        t.total_steps,
        t.total_duration_ms,
        t.total_cost_usd,
        e.llm_model
      FROM workbench_examples e
      LEFT JOIN generation_traces t ON t.workbench_example_id = e.id
      WHERE e.prompt_id = ANY(${promptIds}::uuid[])
        AND e.experiment_run_id IS NULL
        AND e.eval_score IS NOT NULL
        AND e.approval_status = 'auto_approved'
      ORDER BY e.prompt_id, e.eval_score DESC
    `;
    const baselineMap = new Map(baselines.map(b => [b.prompt_id, b]));
    for (const [promptId, entry] of byPrompt) {
      const bl = baselineMap.get(promptId);
      if (bl) {
        entry.baseline = {
          evalScore: Number(bl.eval_score),
          visualScore: bl.visual_score != null ? Number(bl.visual_score) : null,
          codeEvalScore: bl.code_eval_score != null ? Number(bl.code_eval_score) : null,
          durationMs: bl.total_duration_ms != null ? Number(bl.total_duration_ms) : null,
          costUsd: bl.total_cost_usd != null ? Number(Number(bl.total_cost_usd).toFixed(6)) : null,
          totalSteps: bl.total_steps != null ? Number(bl.total_steps) : null,
          llmModel: bl.llm_model,
        };
      }
    }
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
