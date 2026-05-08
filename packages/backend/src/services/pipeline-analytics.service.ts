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
  categoryId?: string;
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
  p50DurationMs: number;
  p95DurationMs: number;
  failureBreakdown: Record<string, number>;
  recentFailureSamples: string[];
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

export interface DetailViewTimeseriesPoint {
  bucket: string;
  detailViewCount: number;
  submitCount: number;
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
  // categoryId requires joining workbench_example_prompts. generation_traces.prompt_id
  // is varchar containing the prompt UUID as text, so we cast wep.id::text.
  const categoryJoin = filters.categoryId ? "JOIN workbench_example_prompts wep ON wep.id::text = gt.prompt_id" : "";
  const categoryClause = filters.categoryId
    ? (whereClause ? `AND wep.category_id = $${params.length + 1}::uuid` : `WHERE wep.category_id = $${params.length + 1}::uuid`)
    : "";
  const allParams = filters.categoryId ? [...params, filters.categoryId] : params;

  const query = `
    WITH tool_calls AS (
      SELECT
        tool->>'toolName' AS tool_name,
        (tool->>'success')::boolean AS success,
        (tool->>'durationMs')::int AS duration_ms,
        tool->'errorInfo'->>'category' AS error_category,
        LEFT(tool->>'outputSummary', 200) AS output_summary,
        gt.created_at AS created_at
      FROM generation_traces gt
      ${categoryJoin},
        jsonb_array_elements(gt.trace->'nodes') AS node,
        jsonb_array_elements(COALESCE(node->'toolCalls', '[]'::jsonb)) AS tool
      ${whereClause}
      ${categoryClause}
    ),
    failure_breakdown AS (
      SELECT tool_name, error_category, COUNT(*)::int AS cnt
      FROM tool_calls
      WHERE NOT success AND error_category IS NOT NULL
      GROUP BY 1, 2
    ),
    failure_samples AS (
      SELECT tool_name, output_summary,
             row_number() OVER (PARTITION BY tool_name ORDER BY created_at DESC) AS rn
      FROM tool_calls
      WHERE NOT success AND output_summary IS NOT NULL AND output_summary <> ''
    )
    SELECT
      tc.tool_name AS "toolName",
      COUNT(*)::int AS "callCount",
      COUNT(*) FILTER (WHERE tc.success)::int AS "successCount",
      COALESCE(
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tc.duration_ms)
          FILTER (WHERE tc.duration_ms IS NOT NULL),
        0
      )::int AS "p50DurationMs",
      COALESCE(
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tc.duration_ms)
          FILTER (WHERE tc.duration_ms IS NOT NULL),
        0
      )::int AS "p95DurationMs",
      COALESCE(
        (SELECT jsonb_object_agg(fb.error_category, fb.cnt)
         FROM failure_breakdown fb WHERE fb.tool_name = tc.tool_name),
        '{}'::jsonb
      ) AS "failureBreakdown",
      COALESCE(
        (SELECT array_agg(s.output_summary ORDER BY s.rn)
         FROM failure_samples s WHERE s.tool_name = tc.tool_name AND s.rn <= 5),
        ARRAY[]::text[]
      ) AS "recentFailureSamples"
    FROM tool_calls tc
    GROUP BY tc.tool_name
    ORDER BY "callCount" DESC
  `;

  try {
    return await prisma.$queryRawUnsafe<PipelineToolUsageRow[]>(query, ...allParams);
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
      TRIM(REPLACE(SPLIT_PART(tool->>'inputSummary', ', angle: ', 2), 'angle:', '')) AS "angle",
      COUNT(*)::int AS "callCount"
    FROM generation_traces gt,
         jsonb_array_elements(gt.trace->'nodes') AS node,
         jsonb_array_elements(COALESCE(node->'toolCalls', '[]'::jsonb)) AS tool
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} tool->>'toolName' = 'zoom_followup'
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

export async function getDetailViewTimeseries(
  filters: PipelineFilters,
  granularity: string,
): Promise<DetailViewTimeseriesPoint[]> {
  if (!VALID_GRANULARITIES.has(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }

  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      date_trunc('${granularity}', gt.created_at) AS bucket,
      COUNT(*) FILTER (WHERE tool->>'toolName' = 'zoom_followup')::int AS "detailViewCount",
      COUNT(*) FILTER (WHERE tool->>'toolName' = 'submit_result')::int AS "submitCount"
    FROM generation_traces gt,
         jsonb_array_elements(gt.trace->'nodes') AS node,
         jsonb_array_elements(COALESCE(node->'toolCalls', '[]'::jsonb)) AS tool
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} tool->>'toolName' IN ('zoom_followup', 'submit_result')
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      bucket: Date;
      detailViewCount: number;
      submitCount: number;
    }>>(query, ...params);

    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      detailViewCount: r.detailViewCount,
      submitCount: r.submitCount,
    }));
  } catch (err) {
    logger.warn({ err }, "detail view timeseries query failed");
    return [];
  }
}
