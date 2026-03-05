import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("curation");

const VALID_STATUSES = ["pending", "reviewing", "approved", "rejected", "dismissed"] as const;
type CurationStatus = (typeof VALID_STATUSES)[number];
const TERMINAL_STATUSES: CurationStatus[] = ["approved", "rejected", "dismissed"];

export class CurationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

/**
 * Find conversations that have at least one assistant item with positive signals
 * (rating >= 1 OR downloadCount >= 1) and no existing curation_candidate row,
 * then bulk-create pending candidate rows scoped to the chat_context.
 */
export async function syncCandidates(): Promise<number> {
  // Remove pending candidates whose context no longer has any qualifying signals
  // (e.g. user liked then unliked). Leave non-pending candidates alone.
  const stale = await prisma.curationCandidate.findMany({
    where: {
      status: "pending",
      chatContext: {
        items: {
          none: {
            role: "assistant",
            OR: [{ rating: { gte: 1 } }, { downloadCount: { gte: 1 } }],
          },
        },
      },
    },
    select: { id: true },
  });

  if (stale.length > 0) {
    await prisma.curationCandidate.deleteMany({
      where: { id: { in: stale.map((s) => s.id) } },
    });
    logger.info({ count: stale.length }, "removed stale curation candidates");
  }

  // Find contexts with qualifying assistant items that don't yet have a candidate
  const contexts = await prisma.chatContext.findMany({
    where: {
      curationCandidate: null,
      items: {
        some: {
          role: "assistant",
          OR: [{ rating: { gte: 1 } }, { downloadCount: { gte: 1 } }],
        },
      },
    },
    select: { id: true },
  });

  if (contexts.length === 0) return 0;

  const created = await prisma.curationCandidate.createMany({
    data: contexts.map((ctx) => ({ chatContextId: ctx.id })),
    skipDuplicates: true,
  });

  if (created.count > 0) {
    logger.info({ count: created.count }, "synced new curation candidates");
  }

  return created.count;
}

/**
 * Aggregate likes and downloads across all assistant items in a context.
 */
function aggregateSignals(items: Array<{ role: string; rating: number; downloadCount: number }>) {
  let totalLikes = 0;
  let totalDownloads = 0;
  for (const item of items) {
    if (item.role !== "assistant") continue;
    if (item.rating > 0) totalLikes += item.rating;
    totalDownloads += item.downloadCount;
  }
  return { totalLikes, totalDownloads };
}

export async function listCurationCandidates(opts: {
  status?: string;
  limit?: number;
  offset?: number;
}) {
  // Sync before listing so new signals are reflected
  await syncCandidates();

  const { status, limit = 50, offset = 0 } = opts;

  const where = status && status !== "all" ? { status } : {};

  const candidates = await prisma.curationCandidate.findMany({
    where,
    include: {
      chatContext: {
        select: {
          id: true,
          name: true,
          deletedAt: true,
          items: {
            select: {
              id: true,
              role: true,
              rating: true,
              downloadCount: true,
              messages: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  const total = await prisma.curationCandidate.count({ where });

  return {
    candidates: candidates.map((c) => {
      const { totalLikes, totalDownloads } = aggregateSignals(c.chatContext.items);
      // Find the last assistant item with model content for the thumbnail
      const lastAssistantItem = [...c.chatContext.items]
        .reverse()
        .find((i) => i.role === "assistant");

      return {
        id: c.id,
        status: c.status,
        notes: c.notes,
        reviewedAt: c.reviewedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        totalLikes,
        totalDownloads,
        lastAssistantItem: lastAssistantItem
          ? {
              id: lastAssistantItem.id,
              messages: lastAssistantItem.messages,
              createdAt: lastAssistantItem.createdAt.toISOString(),
            }
          : null,
        chatContext: {
          id: c.chatContext.id,
          name: c.chatContext.name,
          deletedAt: c.chatContext.deletedAt?.toISOString() ?? null,
        },
      };
    }),
    total,
  };
}

export async function getCandidateDetail(candidateId: string) {
  const candidate = await prisma.curationCandidate.findUnique({
    where: { id: candidateId },
    include: {
      chatContext: {
        select: {
          id: true,
          name: true,
          deletedAt: true,
          items: {
            select: {
              id: true,
              role: true,
              messages: true,
              rating: true,
              downloadCount: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!candidate) {
    throw new CurationError("Curation candidate not found", 404);
  }

  const { totalLikes, totalDownloads } = aggregateSignals(candidate.chatContext.items);

  return {
    id: candidate.id,
    status: candidate.status,
    notes: candidate.notes,
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
    totalLikes,
    totalDownloads,
    chatContext: {
      id: candidate.chatContext.id,
      name: candidate.chatContext.name,
      deletedAt: candidate.chatContext.deletedAt?.toISOString() ?? null,
    },
    conversationItems: candidate.chatContext.items.map((item) => ({
      id: item.id,
      role: item.role,
      messages: item.messages,
      rating: item.rating,
      downloadCount: item.downloadCount,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

export async function updateCandidateStatus(
  candidateId: string,
  status: string,
  notes?: string,
) {
  if (!VALID_STATUSES.includes(status as CurationStatus)) {
    throw new CurationError(
      `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}`,
    );
  }

  const existing = await prisma.curationCandidate.findUnique({
    where: { id: candidateId },
  });

  if (!existing) {
    throw new CurationError("Curation candidate not found", 404);
  }

  const data: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (notes !== undefined) {
    data.notes = notes;
  }

  if (TERMINAL_STATUSES.includes(status as CurationStatus)) {
    data.reviewedAt = new Date();
  }

  const updated = await prisma.curationCandidate.update({
    where: { id: candidateId },
    data,
  });

  return {
    id: updated.id,
    status: updated.status,
    notes: updated.notes,
    reviewedAt: updated.reviewedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}
