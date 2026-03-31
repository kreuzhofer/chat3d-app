/**
 * Usage Analytics Service
 *
 * Query functions for cost analysis: summary totals, time-series breakdowns,
 * and CSV/JSON export of raw usage events.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("usage-analytics");

// ── Types ──────────────────────────────────────────────────────────

export interface UsageFilters {
  from?: Date;
  to?: Date;
  userId?: string;
  modelName?: string;
  providerName?: string;
  purpose?: string;
}

export interface UsageSummary {
  totalCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  avgCostPerRequest: number;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
  avgOutputTps: number | null;
}

export interface TimeseriesPoint {
  bucket: string;
  group: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface TimeseriesResponse {
  totals: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  };
  averages: {
    costPerRequest: number;
    inputTokensPerRequest: number;
    outputTokensPerRequest: number;
  };
  series: TimeseriesPoint[];
}

// ── Filter builder ─────────────────────────────────────────────────

function buildWhereClause(filters: UsageFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.from) {
    conditions.push(`created_at >= $${idx}`);
    params.push(filters.from);
    idx++;
  }
  if (filters.to) {
    conditions.push(`created_at <= $${idx}`);
    params.push(filters.to);
    idx++;
  }
  if (filters.userId) {
    conditions.push(`user_id = $${idx}::uuid`);
    params.push(filters.userId);
    idx++;
  }
  if (filters.modelName) {
    conditions.push(`model_name = $${idx}`);
    params.push(filters.modelName);
    idx++;
  }
  if (filters.providerName) {
    conditions.push(`provider_name = $${idx}`);
    params.push(filters.providerName);
    idx++;
  }
  if (filters.purpose) {
    conditions.push(`purpose = $${idx}`);
    params.push(filters.purpose);
    idx++;
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

// ── Summary ────────────────────────────────────────────────────────

export async function getUsageSummary(filters: UsageFilters): Promise<UsageSummary> {
  const { sql: whereClause, params } = buildWhereClause(filters);

  const query = `
    SELECT
      COALESCE(SUM(estimated_cost_usd), 0)::float AS "totalCost",
      COUNT(*)::int AS "totalRequests",
      COALESCE(SUM(input_tokens), 0)::int AS "totalInputTokens",
      COALESCE(SUM(output_tokens), 0)::int AS "totalOutputTokens",
      COALESCE(SUM(reasoning_tokens), 0)::int AS "totalReasoningTokens",
      COALESCE(SUM(cache_read_tokens), 0)::int AS "totalCacheReadTokens",
      COALESCE(SUM(cache_write_tokens), 0)::int AS "totalCacheWriteTokens",
      AVG(
        COALESCE(
          output_tokens_per_second,
          CASE WHEN duration_ms > 0 AND output_tokens > 0
               THEN (output_tokens::numeric / duration_ms * 1000)
               ELSE NULL END
        )
      )::float AS "avgOutputTps"
    FROM llm_usage_events
    ${whereClause}
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{
    totalCost: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalReasoningTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    avgOutputTps: number | null;
  }>>(query, ...params);

  const row = rows[0];
  const reqs = row.totalRequests || 1;

  return {
    ...row,
    avgCostPerRequest: Number((row.totalCost / reqs).toFixed(8)),
    avgInputTokensPerRequest: Math.round(row.totalInputTokens / reqs),
    avgOutputTokensPerRequest: Math.round(row.totalOutputTokens / reqs),
    avgOutputTps: row.avgOutputTps != null ? Math.round(row.avgOutputTps * 100) / 100 : null,
  };
}

// ── Timeseries ─────────────────────────────────────────────────────

const VALID_GRANULARITIES = new Set(["hour", "day", "week", "month"]);
const VALID_GROUP_BY = new Set(["model", "provider", "purpose", "user"]);

const GROUP_COLUMN: Record<string, string> = {
  model: "model_name",
  provider: "provider_name",
  purpose: "purpose",
  user: "user_id",
};

export async function getUsageTimeseries(
  filters: UsageFilters,
  granularity: string,
  groupBy?: string,
): Promise<TimeseriesResponse> {
  if (!VALID_GRANULARITIES.has(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }
  if (groupBy && !VALID_GROUP_BY.has(groupBy)) {
    throw new Error(`Invalid groupBy: ${groupBy}`);
  }

  const { sql: whereClause, params } = buildWhereClause(filters);
  const groupCol = groupBy ? GROUP_COLUMN[groupBy] : null;
  const groupSelect = groupCol ? `, ${groupCol} AS "group"` : `, NULL AS "group"`;
  const groupByClause = groupCol ? `, ${groupCol}` : "";

  const query = `
    SELECT
      date_trunc('${granularity}', created_at) AS bucket
      ${groupSelect},
      COALESCE(SUM(estimated_cost_usd), 0)::float AS cost,
      COALESCE(SUM(input_tokens), 0)::int AS "inputTokens",
      COALESCE(SUM(output_tokens), 0)::int AS "outputTokens",
      COUNT(*)::int AS requests
    FROM llm_usage_events
    ${whereClause}
    GROUP BY bucket ${groupByClause}
    ORDER BY bucket ASC ${groupCol ? `, ${groupCol} ASC` : ""}
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{
    bucket: Date;
    group: string | null;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  }>>(query, ...params);

  const series: TimeseriesPoint[] = rows.map((row) => ({
    bucket: row.bucket.toISOString(),
    group: row.group,
    cost: row.cost,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    requests: row.requests,
  }));

  // Compute totals
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalReqs = 0;
  for (const s of series) {
    totalCost += s.cost;
    totalInput += s.inputTokens;
    totalOutput += s.outputTokens;
    totalReqs += s.requests;
  }

  // When groupBy is used, totals sum across groups. Deduplicate by computing from summary.
  if (groupBy) {
    const summary = await getUsageSummary(filters);
    totalCost = summary.totalCost;
    totalInput = summary.totalInputTokens;
    totalOutput = summary.totalOutputTokens;
    totalReqs = summary.totalRequests;
  }

  const reqs = totalReqs || 1;

  return {
    totals: {
      cost: totalCost,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      requests: totalReqs,
    },
    averages: {
      costPerRequest: Number((totalCost / reqs).toFixed(8)),
      inputTokensPerRequest: Math.round(totalInput / reqs),
      outputTokensPerRequest: Math.round(totalOutput / reqs),
    },
    series,
  };
}

// ── Export ──────────────────────────────────────────────────────────

export async function exportUsageEvents(
  filters: UsageFilters,
  format: "csv" | "json",
): Promise<string | object[]> {
  const where: Record<string, unknown> = {};

  if (filters.from || filters.to) {
    const createdAt: Record<string, Date> = {};
    if (filters.from) createdAt.gte = filters.from;
    if (filters.to) createdAt.lte = filters.to;
    where.createdAt = createdAt;
  }
  if (filters.userId) where.userId = filters.userId;
  if (filters.modelName) where.modelName = filters.modelName;
  if (filters.providerName) where.providerName = filters.providerName;
  if (filters.purpose) where.purpose = filters.purpose;

  const events = await prisma.llmUsageEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  if (format === "json") {
    return events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      userId: e.userId,
      chatContextId: e.chatContextId,
      chatItemId: e.chatItemId,
      workbenchExampleId: e.workbenchExampleId,
      providerName: e.providerName,
      modelName: e.modelName,
      purpose: e.purpose,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      reasoningTokens: e.reasoningTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheWriteTokens: e.cacheWriteTokens,
      totalTokens: e.totalTokens,
      estimatedCostUsd: Number(e.estimatedCostUsd),
      durationMs: e.durationMs,
      isEstimated: e.isEstimated,
      generationAttempt: e.generationAttempt,
      outputTokensPerSecond: e.outputTokensPerSecond != null ? Number(e.outputTokensPerSecond) : null,
    }));
  }

  // CSV format
  const headers = [
    "id", "created_at", "user_id", "chat_context_id", "chat_item_id",
    "workbench_example_id", "provider_name", "model_name", "purpose",
    "input_tokens", "output_tokens", "reasoning_tokens",
    "cache_read_tokens", "cache_write_tokens", "total_tokens",
    "estimated_cost_usd", "duration_ms", "is_estimated", "generation_attempt",
    "output_tokens_per_second",
  ];

  const rows = events.map((e) => [
    e.id, e.createdAt.toISOString(), e.userId ?? "", e.chatContextId ?? "",
    e.chatItemId ?? "", e.workbenchExampleId ?? "", e.providerName,
    e.modelName, e.purpose, e.inputTokens, e.outputTokens, e.reasoningTokens,
    e.cacheReadTokens, e.cacheWriteTokens, e.totalTokens,
    Number(e.estimatedCostUsd), e.durationMs ?? "", e.isEstimated ?? false,
    e.generationAttempt ?? 1, e.outputTokensPerSecond != null ? Number(e.outputTokensPerSecond) : "",
  ].join(","));

  return [headers.join(","), ...rows].join("\n");
}
