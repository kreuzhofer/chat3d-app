/**
 * Trace Persistence Service
 *
 * CRUD operations for generation_traces table.
 * Supports incremental persistence: createTraceEarly → updateTraceIncremental → finalizeTrace.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import type { GenerationTrace, TraceSummary } from "@chat3d/shared";

const logger = createLogger("trace-persist");

// ── Single-shot persist (kept for reRenderForExample and chat) ──────

interface PersistTraceParams {
  workbenchExampleId?: string;
  chatItemId?: string;
  pipelineType: string;
  trace: GenerationTrace;
  summary: TraceSummary;
}

export async function persistTrace(params: PersistTraceParams): Promise<string> {
  try {
    const row = await prisma.generationTrace.create({
      data: {
        workbenchExampleId: params.workbenchExampleId ?? null,
        chatItemId: params.chatItemId ?? null,
        totalDurationMs: params.summary.totalDurationMs,
        totalCostUsd: params.summary.totalCostUsd,
        totalSteps: params.summary.totalSteps,
        totalLlmCalls: params.summary.totalLlmCalls,
        finalStatus: params.summary.finalStatus,
        pipelineType: params.pipelineType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trace: params.trace as any,
      },
      select: { id: true },
    });
    logger.info(
      { traceId: row.id, exampleId: params.workbenchExampleId, chatItemId: params.chatItemId },
      "trace persisted",
    );
    return row.id;
  } catch (err) {
    logger.error({ err }, "failed to persist trace");
    throw err;
  }
}

// ── Incremental persistence ─────────────────────────────────────────

interface CreateTraceEarlyParams {
  promptId?: string;
  pipelineType: string;
  trace: GenerationTrace;
}

/**
 * Create a trace row early in the pipeline with finalStatus "running".
 * Returns the traceId, or null if creation fails (graceful degradation).
 */
export async function createTraceEarly(params: CreateTraceEarlyParams): Promise<string | null> {
  try {
    const row = await prisma.generationTrace.create({
      data: {
        promptId: params.promptId ?? null,
        finalStatus: "running",
        pipelineType: params.pipelineType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trace: params.trace as any,
      },
      select: { id: true },
    });
    logger.info({ traceId: row.id, promptId: params.promptId }, "trace created early");
    return row.id;
  } catch (err) {
    logger.warn({ err }, "failed to create early trace (degrading gracefully)");
    return null;
  }
}

/**
 * Incrementally update the trace snapshot. Fire-and-forget — logs warnings on failure.
 */
export function updateTraceIncremental(
  traceId: string | null,
  trace: GenerationTrace,
  summary?: Partial<TraceSummary>,
): void {
  if (!traceId) return;
  prisma.generationTrace.update({
    where: { id: traceId },
    data: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trace: trace as any,
      ...(summary?.totalDurationMs != null ? { totalDurationMs: summary.totalDurationMs } : {}),
      ...(summary?.totalCostUsd != null ? { totalCostUsd: summary.totalCostUsd } : {}),
      ...(summary?.totalSteps != null ? { totalSteps: summary.totalSteps } : {}),
      ...(summary?.totalLlmCalls != null ? { totalLlmCalls: summary.totalLlmCalls } : {}),
      ...(summary?.finalStatus ? { finalStatus: summary.finalStatus } : {}),
    },
  }).catch(err => logger.warn({ err, traceId }, "incremental trace update failed"));
}

interface FinalizeTraceParams {
  workbenchExampleId?: string;
  chatItemId?: string;
  trace: GenerationTrace;
  summary: TraceSummary;
}

/**
 * Final update: sets workbenchExampleId, terminal finalStatus, and full trace + summary.
 */
export async function finalizeTrace(traceId: string | null, params: FinalizeTraceParams): Promise<void> {
  if (!traceId) return;
  try {
    await prisma.generationTrace.update({
      where: { id: traceId },
      data: {
        workbenchExampleId: params.workbenchExampleId ?? null,
        chatItemId: params.chatItemId ?? null,
        totalDurationMs: params.summary.totalDurationMs,
        totalCostUsd: params.summary.totalCostUsd,
        totalSteps: params.summary.totalSteps,
        totalLlmCalls: params.summary.totalLlmCalls,
        finalStatus: params.summary.finalStatus,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trace: params.trace as any,
      },
    });
    logger.info({ traceId, exampleId: params.workbenchExampleId }, "trace finalized");
  } catch (err) {
    logger.warn({ err, traceId }, "trace finalization failed");
  }
}

// ── Retrieve ─────────────────────────────────────────────────────────

export async function getTraceForWorkbenchExample(
  exampleId: string,
): Promise<GenerationTrace | null> {
  const row = await prisma.generationTrace.findUnique({
    where: { workbenchExampleId: exampleId },
  });
  return row ? (row.trace as unknown as GenerationTrace) : null;
}

export async function getTraceForChatItem(
  chatItemId: string,
): Promise<GenerationTrace | null> {
  const row = await prisma.generationTrace.findUnique({
    where: { chatItemId },
  });
  return row ? (row.trace as unknown as GenerationTrace) : null;
}

/** Get full trace record with summary fields for an example. */
export async function getTraceRecordForWorkbenchExample(exampleId: string) {
  return prisma.generationTrace.findUnique({
    where: { workbenchExampleId: exampleId },
    select: {
      id: true,
      totalDurationMs: true,
      totalCostUsd: true,
      totalSteps: true,
      totalLlmCalls: true,
      finalStatus: true,
      pipelineType: true,
      trace: true,
      createdAt: true,
    },
  });
}
