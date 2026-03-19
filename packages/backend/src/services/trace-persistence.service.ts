/**
 * Trace Persistence Service
 *
 * CRUD operations for generation_traces table.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import type { GenerationTrace, TraceSummary } from "@chat3d/shared";

const logger = createLogger("trace-persist");

// ── Persist ──────────────────────────────────────────────────────────

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
