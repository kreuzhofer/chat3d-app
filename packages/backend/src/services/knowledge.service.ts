/**
 * Build123d Knowledge Base Service
 *
 * Manages external knowledge entries (docs, examples, tests, forum posts)
 * that the agent can search at runtime via semantic similarity.
 * Uses the same pgvector/embedding infrastructure as workbench examples.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { embedPromptText, embedPromptTextWithUsage } from "./workbench-embeddings.service.js";
import { getModelForPurpose } from "./llm-config.service.js";

const logger = createLogger("knowledge");

// ── Types ────────────────────────────────────────────────────────────

export type KnowledgeSourceType = "docs" | "github_example" | "github_test" | "forum" | "blog";
export type ValidationStatus = "pending" | "valid" | "invalid" | "error";

export interface KnowledgeEntry {
  id: string;
  sourceUrl: string;
  sourceType: KnowledgeSourceType;
  title: string;
  description: string | null;
  code: string;
  concepts: string[];
  build123dVersion: string | null;
  validatedAt: Date | null;
  validationStatus: ValidationStatus;
  qualityScore: number | null;
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeSearchMatch {
  id: string;
  title: string;
  description: string | null;
  code: string;
  concepts: string[];
  sourceType: KnowledgeSourceType;
  sourceUrl: string;
  similarity: number;
}

export interface KnowledgeStats {
  total: number;
  bySourceType: Record<string, number>;
  byValidation: Record<string, number>;
  embedded: number;
  notEmbedded: number;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function createKnowledgeEntry(input: {
  sourceUrl: string;
  sourceType: KnowledgeSourceType;
  title: string;
  description?: string;
  code: string;
  concepts?: string[];
  build123dVersion?: string;
  qualityScore?: number;
}): Promise<KnowledgeEntry> {
  const entry = await prisma.build123dKnowledge.create({
    data: {
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      title: input.title,
      description: input.description ?? null,
      code: input.code,
      concepts: input.concepts ?? [],
      build123dVersion: input.build123dVersion ?? null,
      qualityScore: input.qualityScore ?? null,
    },
  });
  return entry as unknown as KnowledgeEntry;
}

export async function createKnowledgeEntries(entries: Array<{
  sourceUrl: string;
  sourceType: KnowledgeSourceType;
  title: string;
  description?: string;
  code: string;
  concepts?: string[];
  build123dVersion?: string;
  qualityScore?: number;
}>): Promise<number> {
  const result = await prisma.build123dKnowledge.createMany({
    data: entries.map(e => ({
      sourceUrl: e.sourceUrl,
      sourceType: e.sourceType,
      title: e.title,
      description: e.description ?? null,
      code: e.code,
      concepts: e.concepts ?? [],
      build123dVersion: e.build123dVersion ?? null,
      qualityScore: e.qualityScore ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listKnowledgeEntries(options?: {
  sourceType?: KnowledgeSourceType;
  validationStatus?: ValidationStatus;
  limit?: number;
  offset?: number;
}): Promise<{ entries: KnowledgeEntry[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (options?.sourceType) where.sourceType = options.sourceType;
  if (options?.validationStatus) where.validationStatus = options.validationStatus;

  const [entries, total] = await Promise.all([
    prisma.build123dKnowledge.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.build123dKnowledge.count({ where }),
  ]);

  return { entries: entries as unknown as KnowledgeEntry[], total };
}

export async function getKnowledgeEntry(id: string): Promise<KnowledgeEntry | null> {
  const entry = await prisma.build123dKnowledge.findUnique({ where: { id } });
  return entry as unknown as KnowledgeEntry | null;
}

export async function deleteKnowledgeEntry(id: string): Promise<void> {
  await prisma.build123dKnowledge.delete({ where: { id } });
}

export async function deleteKnowledgeBySource(sourceType: KnowledgeSourceType): Promise<number> {
  const result = await prisma.build123dKnowledge.deleteMany({
    where: { sourceType },
  });
  return result.count;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const [total, bySource, byValidation, embedded] = await Promise.all([
    prisma.build123dKnowledge.count(),
    prisma.build123dKnowledge.groupBy({
      by: ["sourceType"],
      _count: true,
    }),
    prisma.build123dKnowledge.groupBy({
      by: ["validationStatus"],
      _count: true,
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM build123d_knowledge WHERE embedding IS NOT NULL
    `,
  ]);

  return {
    total,
    bySourceType: Object.fromEntries(bySource.map(r => [r.sourceType, r._count])),
    byValidation: Object.fromEntries(byValidation.map(r => [r.validationStatus, r._count])),
    embedded: Number(embedded[0]?.count ?? 0),
    notEmbedded: total - Number(embedded[0]?.count ?? 0),
  };
}

// ── Validation ───────────────────────────────────────────────────────

export async function markValidated(id: string, status: "valid" | "invalid" | "error"): Promise<void> {
  await prisma.build123dKnowledge.update({
    where: { id },
    data: {
      validationStatus: status,
      validatedAt: new Date(),
    },
  });
}

export async function markManyValidated(ids: string[], status: "valid" | "invalid" | "error"): Promise<void> {
  await prisma.build123dKnowledge.updateMany({
    where: { id: { in: ids } },
    data: {
      validationStatus: status,
      validatedAt: new Date(),
    },
  });
}

// ── Embedding ────────────────────────────────────────────────────────

/**
 * Embed a single knowledge entry.
 * Uses title + description + first 200 chars of code as the embedding text.
 */
export async function embedKnowledgeEntry(id: string): Promise<void> {
  const entry = await prisma.build123dKnowledge.findUnique({
    where: { id },
    select: { title: true, description: true, code: true },
  });
  if (!entry) return;

  const embeddingCfg = await getModelForPurpose("embedding");
  const text = buildEmbeddingText(entry.title, entry.description, entry.code);
  const embedding = await embedPromptText(text);
  const pgVector = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    UPDATE build123d_knowledge
    SET embedding = ${pgVector}::vector, embedding_model = ${embeddingCfg.modelName}
    WHERE id = ${id}::uuid
  `;
}

/**
 * Batch-embed all knowledge entries that are validated and missing embeddings.
 */
export async function backfillKnowledgeEmbeddings(): Promise<{ embedded: number; skipped: number }> {
  const embeddingCfg = await getModelForPurpose("embedding");
  const currentModel = embeddingCfg.modelName;

  const rows = await prisma.$queryRaw<{ id: string; title: string; description: string | null; code: string }[]>`
    SELECT id, title, description, code
    FROM build123d_knowledge
    WHERE validation_status = 'valid'
      AND (embedding IS NULL OR embedding_model IS NULL OR embedding_model != ${currentModel})
    ORDER BY created_at
  `;

  if (rows.length === 0) {
    logger.info("knowledge embeddings: nothing to backfill");
    return { embedded: 0, skipped: 0 };
  }

  logger.info({ count: rows.length, model: currentModel }, "backfilling knowledge embeddings");

  // Import embedMany dynamically to avoid circular dependency issues
  const { embedMany } = await import("ai");
  const { createEmbeddingModel } = await import("./llm-config.service.js");
  const model = createEmbeddingModel(embeddingCfg);

  const BATCH_SIZE = 50;
  let embedded = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(r => buildEmbeddingText(r.title, r.description, r.code));

    const embedResult = await embedMany({
      model,
      values: texts,
      providerOptions: { openai: { dimensions: 1536 } },
    });

    await prisma.$transaction(async (tx) => {
      for (let j = 0; j < batch.length; j++) {
        const pgVector = `[${embedResult.embeddings[j].join(",")}]`;
        await tx.$executeRaw`
          UPDATE build123d_knowledge
          SET embedding = ${pgVector}::vector, embedding_model = ${currentModel}
          WHERE id = ${batch[j].id}::uuid
        `;
      }
    });

    embedded += batch.length;
    logger.info({ batch: Math.floor(i / BATCH_SIZE) + 1, embedded }, "knowledge embedding batch done");
  }

  return { embedded, skipped: 0 };
}

// ── Semantic Search ──────────────────────────────────────────────────

/**
 * Search knowledge entries by semantic similarity.
 * Only returns validated + embedded entries.
 */
export async function searchKnowledge(
  query: string,
  limit = 5,
): Promise<{ matches: KnowledgeSearchMatch[]; embeddingTokens: number }> {
  const { embedding: queryEmbedding, tokens: embeddingTokens } = await embedPromptTextWithUsage(query);
  const pgVector = `[${queryEmbedding.join(",")}]`;

  const rows = await prisma.$queryRaw<{
    id: string;
    title: string;
    description: string | null;
    code: string;
    concepts: string[];
    source_type: string;
    source_url: string;
    similarity: number;
  }[]>`
    SELECT id, title, description, code, concepts, source_type, source_url,
           1 - (embedding <=> ${pgVector}::vector) AS similarity
    FROM build123d_knowledge
    WHERE embedding IS NOT NULL
      AND validation_status = 'valid'
    ORDER BY embedding <=> ${pgVector}::vector ASC
    LIMIT ${limit}
  `;

  return {
    matches: rows.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      code: r.code,
      concepts: r.concepts,
      sourceType: r.source_type as KnowledgeSourceType,
      sourceUrl: r.source_url,
      similarity: r.similarity,
    })),
    embeddingTokens,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildEmbeddingText(title: string, description: string | null, code: string): string {
  const parts = [title];
  if (description) parts.push(description);
  // Include start of code for context, but cap to avoid excessive embedding tokens
  if (code.length > 0) parts.push(code.slice(0, 500));
  return parts.join("\n\n");
}
