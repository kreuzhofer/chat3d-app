/**
 * Build123d Knowledge Base Service
 *
 * Manages external knowledge entries (docs, examples, tests, forum posts)
 * that the agent can search at runtime via semantic similarity.
 * Uses the same pgvector/embedding infrastructure as workbench examples.
 */

import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { embedPromptText } from "./workbench-embeddings.service.js";
import { getModelForPurpose } from "./llm-config.service.js";

const logger = createLogger("knowledge");

// ── Types ────────────────────────────────────────────────────────────

export type KnowledgeSourceType = "docs" | "github_example" | "github_test" | "forum" | "blog" | "reference" | "manual";
export type ValidationStatus = "pending" | "valid" | "invalid" | "error";

export interface KnowledgeEntry {
  id: string;
  sourceUrl: string;
  sourceType: KnowledgeSourceType;
  title: string;
  description: string | null;
  code: string;
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
  stale: number;
  currentEmbeddingModel: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function createKnowledgeEntry(input: {
  sourceUrl: string;
  sourceType: KnowledgeSourceType;
  title: string;
  description?: string;
  code: string;
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
  sourceId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: KnowledgeEntry[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (options?.sourceType) where.sourceType = options.sourceType;
  if (options?.validationStatus) where.validationStatus = options.validationStatus;
  if (options?.sourceId) where.sourceId = options.sourceId;
  if (options?.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { code: { contains: options.search, mode: "insensitive" } },
    ];
  }

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

export async function updateKnowledgeEntry(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    code?: string;
    sourceUrl?: string;
  },
): Promise<KnowledgeEntry | null> {
  const existing = await prisma.build123dKnowledge.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.code !== undefined) data.code = patch.code;
  if (patch.sourceUrl !== undefined) data.sourceUrl = patch.sourceUrl;

  const contentChanged = patch.code !== undefined && patch.code !== existing.code;

  if (contentChanged) {
    // Clear embedding so it gets re-embedded on next embed run
    await prisma.$executeRaw`
      UPDATE build123d_knowledge
      SET embedding = NULL, embedding_model = NULL
      WHERE id = ${id}::uuid
    `;

    if (existing.sourceType === "reference") {
      data.validationStatus = "valid";
      data.validatedAt = new Date();
    } else {
      data.validationStatus = "pending";
      data.validatedAt = null;
    }

    logger.info({ id, sourceType: existing.sourceType }, "knowledge entry content changed, embedding cleared");
  }

  const updated = await prisma.build123dKnowledge.update({ where: { id }, data });
  return updated as unknown as KnowledgeEntry;
}

export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  let currentModel = "unknown";
  try {
    const embeddingCfg = await getModelForPurpose("embedding");
    currentModel = embeddingCfg.modelName;
  } catch { /* no embedding model configured */ }

  const [total, bySource, byValidation, embeddingStats] = await Promise.all([
    prisma.build123dKnowledge.count(),
    prisma.build123dKnowledge.groupBy({
      by: ["sourceType"],
      _count: true,
    }),
    prisma.build123dKnowledge.groupBy({
      by: ["validationStatus"],
      _count: true,
    }),
    prisma.$queryRaw<[{ embedded: bigint; current_model: bigint }]>`
      SELECT
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as embedded,
        COUNT(CASE WHEN embedding IS NOT NULL AND embedding_model = ${currentModel} THEN 1 END) as current_model
      FROM build123d_knowledge
      WHERE validation_status = 'valid'
    `,
  ]);

  const embeddedCount = Number(embeddingStats[0]?.embedded ?? 0);
  const currentModelCount = Number(embeddingStats[0]?.current_model ?? 0);

  return {
    total,
    bySourceType: Object.fromEntries(bySource.map(r => [r.sourceType, r._count])),
    byValidation: Object.fromEntries(byValidation.map(r => [r.validationStatus, r._count])),
    embedded: currentModelCount,
    notEmbedded: total - embeddedCount,
    stale: embeddedCount - currentModelCount,
    currentEmbeddingModel: currentModel,
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
    select: { title: true, description: true, code: true, sourceType: true },
  });
  if (!entry) return;

  const embeddingCfg = await getModelForPurpose("embedding");
  const text = buildEmbeddingText(entry.title, entry.description, entry.code, entry.sourceType);
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

  const rows = await prisma.$queryRaw<{ id: string; title: string; description: string | null; code: string; source_type: string }[]>`
    SELECT id, title, description, code, source_type
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

  // Import trackedEmbedMany dynamically to avoid circular dependency issues
  const { trackedEmbedMany } = await import("./tracked-llm.service.js");
  const { createEmbeddingModel } = await import("./llm-config.service.js");
  const model = createEmbeddingModel(embeddingCfg);

  const BATCH_SIZE = 50;
  let embedded = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(r => buildEmbeddingText(r.title, r.description, r.code, r.source_type));

    logger.debug({ batchIdx: Math.floor(i / BATCH_SIZE) + 1, titles: batch.map(r => r.title), textLengths: texts.map(t => t.length) }, "embedding batch starting");

    try {
      const embedResult = await trackedEmbedMany({
        model,
        values: texts,
        providerOptions: { openai: { dimensions: 1536 }, openaiCompatible: { dimensions: 1536 } },
      }, {
        purpose: "knowledge_embedding",
        providerName: embeddingCfg.provider,
        modelId: embeddingCfg.id,
        modelName: embeddingCfg.modelName,
        modelConfig: {
          costPer1mInput: embeddingCfg.costPer1mInput,
          costPer1mOutput: embeddingCfg.costPer1mOutput,
        },
      });

      logger.debug({ batchIdx: Math.floor(i / BATCH_SIZE) + 1, embeddingCount: embedResult.embeddings.length }, "embedding API call succeeded");

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
    } catch (err) {
      logger.error({ err, batchIdx: Math.floor(i / BATCH_SIZE) + 1, titles: batch.map(r => r.title), textLengths: texts.map(t => t.length) }, "knowledge embedding batch FAILED");
      throw err;
    }
  }

  return { embedded, skipped: 0 };
}

// ── Validation Pipeline ──────────────────────────────────────────────

const BUILD123D_MARKERS = [
  "BuildPart", "BuildSketch", "BuildLine",
  "Box", "Cylinder", "Sphere", "Cone", "Torus", "Wedge",
  "extrude", "revolve", "sweep", "loft", "fillet", "chamfer",
  "offset", "Circle", "Rectangle", "Polygon", "Ellipse",
  "Locations", "GridLocations", "PolarLocations",
  "Mode.ADD", "Mode.SUBTRACT", "Mode.INTERSECT",
  "build123d",
];

function isBuild123dCode(code: string): boolean {
  return BUILD123D_MARKERS.some(marker => code.includes(marker));
}

async function isValidPython(code: string): Promise<{ valid: boolean; error?: string }> {
  const build123dUrl = config.query.build123dUrl;
  const resp = await fetch(`${build123dUrl}/validate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, skip_root_part: true, skip_lint: true }),
  });

  if (!resp.ok) {
    throw new Error(`Build123d /validate/ returned ${resp.status}`);
  }

  const result = await resp.json() as { valid: boolean; errors: string[] };
  const syntaxError = result.errors.find(e => e.startsWith("Syntax error:"));
  if (syntaxError) {
    return { valid: false, error: syntaxError };
  }
  return { valid: true };
}

/**
 * Validate pending (or all) knowledge entries.
 * Returns counts of how many moved to each status.
 */
export async function validatePendingEntries(opts?: {
  sourceId?: string;
  revalidateAll?: boolean;
  limit?: number;
}): Promise<{ validated: number; valid: number; invalid: number; errors: number }> {
  const where: Record<string, unknown> = {};
  if (!opts?.revalidateAll) where.validationStatus = "pending";
  if (opts?.sourceId) where.sourceId = opts.sourceId;

  const entries = await prisma.build123dKnowledge.findMany({
    where,
    select: { id: true, title: true, code: true, sourceType: true },
    take: opts?.limit ?? 500,
    orderBy: { createdAt: "asc" },
  });

  logger.info({ count: entries.length, revalidateAll: !!opts?.revalidateAll }, "starting validation");

  let valid = 0;
  let invalid = 0;
  let errored = 0;

  for (const entry of entries) {
    try {
      // Reference entries are auto-validated (not code, no syntax check needed)
      if (entry.sourceType === "reference") {
        await prisma.build123dKnowledge.update({
          where: { id: entry.id },
          data: { validationStatus: "valid", validatedAt: new Date() },
        });
        valid++;
        continue;
      }

      if (!isBuild123dCode(entry.code)) {
        await prisma.build123dKnowledge.update({
          where: { id: entry.id },
          data: { validationStatus: "invalid", validatedAt: new Date() },
        });
        invalid++;
        continue;
      }

      const result = await isValidPython(entry.code);
      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: {
          validationStatus: result.valid ? "valid" : "invalid",
          validatedAt: new Date(),
        },
      });

      if (result.valid) valid++;
      else invalid++;
    } catch (err) {
      errored++;
      await prisma.build123dKnowledge.update({
        where: { id: entry.id },
        data: { validationStatus: "error", validatedAt: new Date() },
      });
      logger.warn({ err: err instanceof Error ? err.message : String(err), title: entry.title }, "validation error");
    }
  }

  logger.info({ valid, invalid, errored, total: entries.length }, "validation complete");
  return { validated: entries.length, valid, invalid, errors: errored };
}

// ── Manual Entry ─────────────────────────────────────────────────────

export async function createManualEntry(input: {
  sourceId: string;
  title: string;
  code: string;
  description?: string;
}): Promise<KnowledgeEntry> {
  const entry = await prisma.build123dKnowledge.create({
    data: {
      sourceUrl: `manual://${Date.now()}`,
      sourceType: "manual",
      title: input.title,
      description: input.description ?? null,
      code: input.code,
      sourceId: input.sourceId,
    },
  });
  return entry as unknown as KnowledgeEntry;
}

// ── Reference Entry ──────────────────────────────────────────────

/**
 * Create a reference knowledge entry (non-code: specs, docs, guides).
 * Reference entries are auto-validated (no build123d marker or syntax check)
 * and use a wider embedding window (2000 chars instead of 500).
 */
export async function createReferenceEntry(input: {
  sourceId: string;
  sourceUrl?: string;
  title: string;
  content: string;
  description?: string;
}): Promise<KnowledgeEntry> {
  const entry = await prisma.build123dKnowledge.create({
    data: {
      sourceUrl: input.sourceUrl || `reference://${Date.now()}`,
      sourceType: "reference",
      title: input.title,
      description: input.description ?? null,
      code: input.content,
      validationStatus: "valid",
      validatedAt: new Date(),
      sourceId: input.sourceId,
    },
  });
  return entry as unknown as KnowledgeEntry;
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildEmbeddingText(title: string, description: string | null, code: string, sourceType?: string): string {
  const parts = [title];
  if (description) parts.push(description);
  // Reference entries use a wider window (2000 chars) since they are prose, not code
  const contentLimit = sourceType === "reference" ? 2000 : 500;
  if (code.length > 0) parts.push(code.slice(0, contentLimit));
  return parts.join("\n\n");
}
