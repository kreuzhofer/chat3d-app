/**
 * Pipeline Analytics Service
 *
 * Queries generation_traces table for pipeline performance metrics.
 * Uses summary columns + JSONB extraction for tool call analysis.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("pipeline-analytics");

// ── Types ──────────────────────────────────────────────────────────

export interface PipelineFilters {
  from?: Date;
  to?: Date;
  pipelineType?: string;
}

export interface PipelineSummary {
  totalGenerations: number;
  avgDurationMs: number;
  avgCostUsd: number;
  avgSteps: number;
  avgLlmCalls: number;
  completedCount: number;
  failedCount: number;
  abortedCount: number;
  failureRate: number;
  avgEvalScore: number | null;
}

export interface PipelineTimeseriesPoint {
  bucket: string;
  count: number;
  avgSteps: number;
  avgDurationMs: number;
  avgCostUsd: number;
  failureRate: number;
  avgEvalScore: number | null;
}

export interface PipelineToolUsageRow {
  toolName: string;
  callCount: number;
  successCount: number;
}

export interface PipelineBreakdown {
  singleAgentCount: number;
  multiAgentCount: number;
  submittedCount: number;
  stepLimitCount: number;
}

export interface DetailViewAngleRow {
  angle: string;
  callCount: number;
}

// ── Filter builder ─────────────────────────────────────────────────

function buildWhereClause(filters: PipelineFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.from) {
    conditions.push(`gt.created_at >= $${idx}`);
    params.push(filters.from);
    idx++;
  }
  if (filters.to) {
    conditions.push(`gt.created_at <= $${idx}`);
    params.push(filters.to);
    idx++;
  }
  if (filters.pipelineType) {
    conditions.push(`gt.pipeline_type = $${idx}`);
    params.push(filters.pipelineType);
    idx++;
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

// ── Summary ────────────────────────────────────────────────────────

export async function getPipelineSummary(filters: PipelineFilters): Promise<PipelineSummary> {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      COUNT(*)::int AS "totalGenerations",
      COALESCE(AVG(gt.total_duration_ms), 0)::float AS "avgDurationMs",
      COALESCE(AVG(gt.total_cost_usd), 0)::float AS "avgCostUsd",
      COALESCE(AVG(gt.total_steps), 0)::float AS "avgSteps",
      COALESCE(AVG(gt.total_llm_calls), 0)::float AS "avgLlmCalls",
      COUNT(*) FILTER (WHERE gt.final_status = 'completed')::int AS "completedCount",
      COUNT(*) FILTER (WHERE gt.final_status = 'failed')::int AS "failedCount",
      COUNT(*) FILTER (WHERE gt.final_status = 'aborted')::int AS "abortedCount",
      COALESCE(AVG(we.eval_score), NULL)::float AS "avgEvalScore"
    FROM generation_traces gt
    LEFT JOIN workbench_examples we ON we.id = gt.workbench_example_id
    ${whereClause}
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{
    totalGenerations: number;
    avgDurationMs: number;
    avgCostUsd: number;
    avgSteps: number;
    avgLlmCalls: number;
    completedCount: number;
    failedCount: number;
    abortedCount: number;
    avgEvalScore: number | null;
  }>>(query, ...params);

  const row = rows[0];
  const total = row.totalGenerations || 1;

  return {
    ...row,
    failureRate: (row.failedCount + row.abortedCount) / total,
  };
}

// ── Timeseries ─────────────────────────────────────────────────────

const VALID_GRANULARITIES = new Set(["hour", "day", "week", "month"]);

export async function getPipelineTimeseries(
  filters: PipelineFilters,
  granularity: string,
): Promise<PipelineTimeseriesPoint[]> {
  if (!VALID_GRANULARITIES.has(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }

  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      date_trunc('${granularity}', gt.created_at) AS bucket,
      COUNT(*)::int AS count,
      COALESCE(AVG(gt.total_steps), 0)::float AS "avgSteps",
      COALESCE(AVG(gt.total_duration_ms), 0)::float AS "avgDurationMs",
      COALESCE(AVG(gt.total_cost_usd), 0)::float AS "avgCostUsd",
      CASE WHEN COUNT(*) > 0
        THEN (COUNT(*) FILTER (WHERE gt.final_status IN ('failed', 'aborted')))::float / COUNT(*)
        ELSE 0
      END AS "failureRate",
      COALESCE(AVG(we.eval_score), NULL)::float AS "avgEvalScore"
    FROM generation_traces gt
    LEFT JOIN workbench_examples we ON we.id = gt.workbench_example_id
    ${whereClause}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{
    bucket: Date;
    count: number;
    avgSteps: number;
    avgDurationMs: number;
    avgCostUsd: number;
    failureRate: number;
    avgEvalScore: number | null;
  }>>(query, ...params);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    count: r.count,
    avgSteps: r.avgSteps,
    avgDurationMs: r.avgDurationMs,
    avgCostUsd: r.avgCostUsd,
    failureRate: r.failureRate,
    avgEvalScore: r.avgEvalScore,
  }));
}

// ── Tool Usage ──────────────────────────────────────────────────────

export async function getPipelineToolUsage(filters: PipelineFilters): Promise<PipelineToolUsageRow[]> {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      tool->>'toolName' AS "toolName",
      COUNT(*)::int AS "callCount",
      COUNT(*) FILTER (WHERE (tool->>'success')::boolean)::int AS "successCount"
    FROM generation_traces gt,
         jsonb_array_elements(gt.trace->'nodes') AS node,
         jsonb_array_elements(COALESCE(node->'toolCalls', '[]'::jsonb)) AS tool
    ${whereClause}
    GROUP BY tool->>'toolName'
    ORDER BY "callCount" DESC
  `;

  try {
    return await prisma.$queryRawUnsafe<PipelineToolUsageRow[]>(query, ...params);
  } catch (err) {
    logger.warn({ err }, "tool usage query failed");
    return [];
  }
}

// ── Breakdown ──────────────────────────────────────────────────────

export async function getPipelineBreakdown(filters: PipelineFilters): Promise<PipelineBreakdown> {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      COUNT(*) FILTER (WHERE gt.pipeline_type = 'single_agent')::int AS "singleAgentCount",
      COUNT(*) FILTER (WHERE gt.pipeline_type = 'multi_agent')::int AS "multiAgentCount"
    FROM generation_traces gt
    ${whereClause}
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{
    singleAgentCount: number;
    multiAgentCount: number;
  }>>(query, ...params);

  // Submitted vs step-limit from JSONB agent_codegen nodes
  const submittedQuery = `
    SELECT
      COUNT(*) FILTER (WHERE (node->>'type') = 'agent_codegen' AND (node->'agentMeta'->>'submitted')::boolean = true)::int AS "submittedCount",
      COUNT(*) FILTER (WHERE (node->>'type') = 'agent_codegen' AND ((node->'agentMeta'->>'submitted')::boolean = false OR node->'agentMeta'->>'submitted' IS NULL))::int AS "stepLimitCount"
    FROM generation_traces gt,
         jsonb_array_elements(gt.trace->'nodes') AS node
    ${whereClause}
      ${whereClause ? 'AND' : 'WHERE'} (node->>'type') = 'agent_codegen'
  `;

  let submittedCount = 0;
  let stepLimitCount = 0;
  try {
    const subRows = await prisma.$queryRawUnsafe<Array<{
      submittedCount: number;
      stepLimitCount: number;
    }>>(submittedQuery, ...params);
    submittedCount = subRows[0]?.submittedCount ?? 0;
    stepLimitCount = subRows[0]?.stepLimitCount ?? 0;
  } catch (err) {
    logger.warn({ err }, "submitted/step-limit query failed");
  }

  return {
    singleAgentCount: rows[0]?.singleAgentCount ?? 0,
    multiAgentCount: rows[0]?.multiAgentCount ?? 0,
    submittedCount,
    stepLimitCount,
  };
}

// ── Detail View Angle Breakdown ─────────────────────────────────

export async function getDetailViewAngleBreakdown(filters: PipelineFilters): Promise<DetailViewAngleRow[]> {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      TRIM(REPLACE(SPLIT_PART(tool->>'inputSummary', ',', 1), 'angle:', '')) AS "angle",
      COUNT(*)::int AS "callCount"
    FROM generation_traces gt,
         jsonb_array_elements(gt.trace->'nodes') AS node,
         jsonb_array_elements(COALESCE(node->'toolCalls', '[]'::jsonb)) AS tool
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} tool->>'toolName' = 'request_detail_view'
    GROUP BY 1
    ORDER BY "callCount" DESC
  `;

  try {
    return await prisma.$queryRawUnsafe<DetailViewAngleRow[]>(query, ...params);
  } catch (err) {
    logger.warn({ err }, "detail view angle breakdown query failed");
    return [];
  }
}
