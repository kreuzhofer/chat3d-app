/**
 * Knowledge Data Transfer Service — export/import of knowledge base data.
 *
 * Exports produce a JSON file registered in the shared `backups` table.
 * Imports are destructive: clear all sources + entries, then re-insert.
 * Embeddings (pgvector) are included so the importing instance doesn't
 * need to re-embed.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { createBackup, type BackupRecord } from "./backup.service.js";

const logger = createLogger("knowledge-transfer");

// ── Export Format ─────────────────────────────────────────────────────

const EXPORT_VERSION = 1;

interface ExportSource {
  name: string;
  strategy: string;
  config: unknown;
  isActive: boolean;
  lastCrawlAt: string | null;
  lastCrawlStatus: string | null;
  lastCrawlMessage: string | null;
  lastCrawlAdded: number | null;
  lastCrawlSkipped: number | null;
}

interface ExportEntry {
  sourceUrl: string;
  sourceType: string;
  title: string;
  description: string | null;
  code: string;
  concepts: string[];
  build123dVersion: string | null;
  validatedAt: string | null;
  validationStatus: string;
  qualityScore: number | null;
  embeddingModel: string | null;
  embedding: number[] | null;
  /** Index into the sources array — used to re-link on import. */
  sourceIndex: number | null;
}

interface KnowledgeExportData {
  version: number;
  exportedAt: string;
  sources: ExportSource[];
  entries: ExportEntry[];
}

export interface KnowledgeTransferCounts {
  sources: number;
  entries: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getExportsDir(): string {
  return path.join(config.storage.rootDir, "knowledge-exports");
}

/** Redact githubToken from source config before exporting. */
function redactSourceConfig(cfg: unknown): unknown {
  if (typeof cfg !== "object" || cfg === null) return cfg;
  const copy = { ...cfg } as Record<string, unknown>;
  if ("githubToken" in copy) delete copy.githubToken;
  return copy;
}

// ── Export ─────────────────────────────────────────────────────────────

export async function exportKnowledge(): Promise<BackupRecord> {
  logger.info("starting knowledge export");

  // 1. Query sources
  const sources = await prisma.knowledgeSource.findMany({
    orderBy: { createdAt: "asc" },
  });

  // Build a map of sourceId → index for entry linking
  const sourceIdToIndex = new Map<string, number>();
  sources.forEach((s, i) => sourceIdToIndex.set(s.id, i));

  // 2. Query entries with embeddings via raw SQL (Prisma can't read Unsupported columns)
  const entries = await prisma.$queryRaw<Array<{
    id: string;
    source_url: string;
    source_type: string;
    title: string;
    description: string | null;
    code: string;
    concepts: string[];
    build123d_version: string | null;
    validated_at: Date | null;
    validation_status: string;
    quality_score: number | null;
    embedding_model: string | null;
    embedding_text: string | null;
    source_id: string | null;
  }>>`
    SELECT id, source_url, source_type, title, description, code, concepts,
           build123d_version, validated_at, validation_status, quality_score,
           embedding_model, embedding::text as embedding_text, source_id
    FROM build123d_knowledge
    ORDER BY created_at ASC
  `;

  // 3. Build export data
  const exportData: KnowledgeExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sources: sources.map((s) => ({
      name: s.name,
      strategy: s.strategy,
      config: redactSourceConfig(s.config),
      isActive: s.isActive,
      lastCrawlAt: s.lastCrawlAt?.toISOString() ?? null,
      lastCrawlStatus: s.lastCrawlStatus,
      lastCrawlMessage: s.lastCrawlMessage,
      lastCrawlAdded: s.lastCrawlAdded,
      lastCrawlSkipped: s.lastCrawlSkipped,
    })),
    entries: entries.map((e) => ({
      sourceUrl: e.source_url,
      sourceType: e.source_type,
      title: e.title,
      description: e.description,
      code: e.code,
      concepts: e.concepts,
      build123dVersion: e.build123d_version,
      validatedAt: e.validated_at?.toISOString() ?? null,
      validationStatus: e.validation_status,
      qualityScore: e.quality_score,
      embeddingModel: e.embedding_model,
      embedding: e.embedding_text ? parseEmbeddingText(e.embedding_text) : null,
      sourceIndex: e.source_id ? (sourceIdToIndex.get(e.source_id) ?? null) : null,
    })),
  };

  // 4. Write to file
  const dir = getExportsDir();
  await fs.mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `knowledge-export-${timestamp}.json`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, JSON.stringify(exportData, null, 2));

  const stat = await fs.stat(filePath);

  // 5. Register backup
  const backup = await createBackup({
    type: "knowledge",
    label: `Knowledge Export ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
    fileName,
    filePath,
    sizeBytes: BigInt(stat.size),
    counts: { sources: sources.length, entries: entries.length },
    completedAt: new Date(),
  });

  logger.info(
    { sources: sources.length, entries: entries.length, fileName },
    "knowledge export completed",
  );
  return backup;
}

// ── Import ────────────────────────────────────────────────────────────

export async function importKnowledge(
  filePath: string,
): Promise<KnowledgeTransferCounts> {
  logger.info({ filePath }, "starting knowledge import");

  const raw = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as KnowledgeExportData;

  // Validate
  if (!data.version || data.version > EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }
  if (!Array.isArray(data.sources) || !Array.isArray(data.entries)) {
    throw new Error("Invalid export format: missing sources or entries arrays");
  }

  // Destructive import in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Delete all entries (cascade from sources handles most, but orphans may exist)
    await tx.build123dKnowledge.deleteMany({});
    logger.info("cleared all knowledge entries");

    // 2. Delete all sources
    await tx.knowledgeSource.deleteMany({});
    logger.info("cleared all knowledge sources");

    // 3. Insert sources — collect new IDs
    const newSourceIds: string[] = [];
    for (const src of data.sources) {
      const created = await tx.knowledgeSource.create({
        data: {
          name: src.name,
          strategy: src.strategy,
          config: (src.config as object) ?? {},
          isActive: src.isActive,
          lastCrawlAt: src.lastCrawlAt ? new Date(src.lastCrawlAt) : null,
          lastCrawlStatus: src.lastCrawlStatus,
          lastCrawlMessage: src.lastCrawlMessage,
          lastCrawlAdded: src.lastCrawlAdded,
          lastCrawlSkipped: src.lastCrawlSkipped,
        },
      });
      newSourceIds.push(created.id);
    }
    logger.info({ count: newSourceIds.length }, "sources inserted");

    // 4. Insert entries in batches (without embeddings first via createMany)
    const BATCH = 50;
    for (let i = 0; i < data.entries.length; i += BATCH) {
      const batch = data.entries.slice(i, i + BATCH);
      await tx.build123dKnowledge.createMany({
        data: batch.map((e) => ({
          sourceUrl: e.sourceUrl,
          sourceType: e.sourceType,
          title: e.title,
          description: e.description,
          code: e.code,
          concepts: e.concepts,
          build123dVersion: e.build123dVersion,
          validatedAt: e.validatedAt ? new Date(e.validatedAt) : null,
          validationStatus: e.validationStatus,
          qualityScore: e.qualityScore,
          embeddingModel: e.embeddingModel,
          sourceId: e.sourceIndex !== null && e.sourceIndex < newSourceIds.length
            ? newSourceIds[e.sourceIndex]
            : null,
        })),
      });
    }
    logger.info({ count: data.entries.length }, "entries inserted");
  });

  // 5. Backfill embeddings via raw SQL (outside transaction — pgvector needs separate queries)
  const entriesWithEmbeddings = data.entries.filter((e) => e.embedding && e.embedding.length > 0);
  if (entriesWithEmbeddings.length > 0) {
    logger.info({ count: entriesWithEmbeddings.length }, "restoring embeddings");

    // Match by sourceUrl since IDs are regenerated
    for (const entry of entriesWithEmbeddings) {
      const vecStr = `[${entry.embedding!.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE build123d_knowledge SET embedding = $1::vector WHERE source_url = $2`,
        vecStr,
        entry.sourceUrl,
      );
    }
    logger.info("embeddings restored");
  }

  // Cleanup uploaded file
  try {
    await fs.unlink(filePath);
  } catch {
    // non-fatal
  }

  const counts: KnowledgeTransferCounts = {
    sources: data.sources.length,
    entries: data.entries.length,
  };

  logger.info(counts, "knowledge import completed");
  return counts;
}

// ── Utilities ─────────────────────────────────────────────────────────

/** Parse pgvector text representation "[0.1,0.2,...]" into number array. */
function parseEmbeddingText(text: string): number[] {
  const inner = text.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return [];
  return inner.split(",").map(Number);
}
