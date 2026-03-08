/**
 * Knowledge Source CRUD + config validation.
 *
 * A "source" describes WHERE to crawl and HOW (strategy + config).
 * Sources are managed by admins via the UI. Each source produces
 * build123d_knowledge entries when crawled.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("knowledge-source");

// ── Types ────────────────────────────────────────────────────────────

export type SourceStrategy = "github_file" | "github_test_functions" | "readthedocs" | "manual";
export type CrawlStatus = "idle" | "running" | "success" | "error";

export interface GitHubFileConfig {
  repo: string;
  branch: string;
  directory: string;
  fileExtension: string;
  skipPatterns?: string[];
  githubToken?: string;
}

export interface GitHubTestConfig {
  repo: string;
  branch: string;
  directory: string;
  functionPrefix: string;
  minCodeLength: number;
  githubToken?: string;
}

export interface ReadTheDocsConfig {
  baseUrl: string;
  pages: string[];
}

export type SourceConfig = GitHubFileConfig | GitHubTestConfig | ReadTheDocsConfig | Record<string, never>;

export interface KnowledgeSourceRow {
  id: string;
  name: string;
  strategy: SourceStrategy;
  config: SourceConfig;
  isActive: boolean;
  lastCrawlAt: Date | null;
  lastCrawlStatus: CrawlStatus | null;
  lastCrawlMessage: string | null;
  lastCrawlAdded: number | null;
  lastCrawlSkipped: number | null;
  createdAt: Date;
  updatedAt: Date;
  entryCount?: number;
}

// ── Config Validation ────────────────────────────────────────────────

export function validateSourceConfig(
  strategy: string,
  config: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cfg = config as Record<string, unknown>;

  if (!["github_file", "github_test_functions", "readthedocs", "manual"].includes(strategy)) {
    return { valid: false, errors: [`Invalid strategy: ${strategy}`] };
  }

  if (strategy === "github_file") {
    if (typeof cfg.repo !== "string" || !cfg.repo.includes("/")) errors.push("repo must be 'owner/name'");
    if (typeof cfg.branch !== "string" || cfg.branch.length === 0) errors.push("branch is required");
    if (typeof cfg.directory !== "string" || cfg.directory.length === 0) errors.push("directory is required");
    if (typeof cfg.fileExtension !== "string" || cfg.fileExtension.length === 0) errors.push("fileExtension is required");
    if (cfg.skipPatterns !== undefined && !Array.isArray(cfg.skipPatterns)) errors.push("skipPatterns must be an array");
  }

  if (strategy === "github_test_functions") {
    if (typeof cfg.repo !== "string" || !cfg.repo.includes("/")) errors.push("repo must be 'owner/name'");
    if (typeof cfg.branch !== "string" || cfg.branch.length === 0) errors.push("branch is required");
    if (typeof cfg.directory !== "string" || cfg.directory.length === 0) errors.push("directory is required");
    if (typeof cfg.functionPrefix !== "string" || cfg.functionPrefix.length === 0) errors.push("functionPrefix is required");
    if (typeof cfg.minCodeLength !== "number" || cfg.minCodeLength < 0) errors.push("minCodeLength must be a non-negative number");
  }

  if (strategy === "readthedocs") {
    if (typeof cfg.baseUrl !== "string" || cfg.baseUrl.length === 0) errors.push("baseUrl is required");
    if (!Array.isArray(cfg.pages) || cfg.pages.length === 0) errors.push("pages must be a non-empty array");
  }

  // "manual" requires no config

  return { valid: errors.length === 0, errors };
}

/** Strip secrets from config before returning to the API. */
function redactConfig(config: SourceConfig): SourceConfig {
  const cfg = { ...config } as Record<string, unknown>;
  if ("githubToken" in cfg && cfg.githubToken) {
    cfg.githubToken = "••••••••";
  }
  return cfg as SourceConfig;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listKnowledgeSources(): Promise<KnowledgeSourceRow[]> {
  const sources = await prisma.knowledgeSource.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { entries: true } } },
  });

  return sources.map((s) => toSourceRow(s, s._count.entries));
}

function toSourceRow(
  s: {
    id: string; name: string; strategy: string; config: unknown;
    isActive: boolean; lastCrawlAt: Date | null; lastCrawlStatus: string | null;
    lastCrawlMessage: string | null; lastCrawlAdded: number | null; lastCrawlSkipped: number | null;
    createdAt: Date; updatedAt: Date;
  },
  entryCount: number,
): KnowledgeSourceRow {
  return {
    id: s.id,
    name: s.name,
    strategy: s.strategy as SourceStrategy,
    config: redactConfig(s.config as SourceConfig),
    isActive: s.isActive,
    lastCrawlAt: s.lastCrawlAt,
    lastCrawlStatus: s.lastCrawlStatus as CrawlStatus | null,
    lastCrawlMessage: s.lastCrawlMessage,
    lastCrawlAdded: s.lastCrawlAdded,
    lastCrawlSkipped: s.lastCrawlSkipped,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    entryCount,
  };
}

export async function getKnowledgeSource(id: string): Promise<KnowledgeSourceRow | null> {
  const s = await prisma.knowledgeSource.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });
  if (!s) return null;
  return toSourceRow(s, s._count.entries);
}

export async function createKnowledgeSource(input: {
  name: string;
  strategy: SourceStrategy;
  config: SourceConfig;
}): Promise<KnowledgeSourceRow> {
  const validation = validateSourceConfig(input.strategy, input.config);
  if (!validation.valid) {
    throw new Error(`Invalid source config: ${validation.errors.join(", ")}`);
  }

  const s = await prisma.knowledgeSource.create({
    data: {
      name: input.name,
      strategy: input.strategy,
      config: input.config as object,
    },
    include: { _count: { select: { entries: true } } },
  });

  logger.info({ id: s.id, name: s.name, strategy: s.strategy }, "knowledge source created");
  return toSourceRow(s, s._count.entries);
}

export async function updateKnowledgeSource(
  id: string,
  patch: { name?: string; config?: SourceConfig; isActive?: boolean },
): Promise<KnowledgeSourceRow> {
  // If updating config, validate it
  if (patch.config) {
    const source = await prisma.knowledgeSource.findUnique({ where: { id } });
    if (!source) throw new Error("Source not found");
    const validation = validateSourceConfig(source.strategy, patch.config);
    if (!validation.valid) {
      throw new Error(`Invalid source config: ${validation.errors.join(", ")}`);
    }
  }

  const s = await prisma.knowledgeSource.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.config !== undefined ? { config: patch.config as object } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
    include: { _count: { select: { entries: true } } },
  });

  logger.info({ id: s.id, name: s.name }, "knowledge source updated");
  return toSourceRow(s, s._count.entries);
}

export async function deleteKnowledgeSource(id: string): Promise<void> {
  const s = await prisma.knowledgeSource.delete({ where: { id } });
  logger.info({ id: s.id, name: s.name }, "knowledge source deleted (entries cascade-deleted)");
}

/**
 * Update crawl status fields on a source. Used by the crawl worker.
 */
export async function updateCrawlStatus(
  id: string,
  status: CrawlStatus,
  message?: string,
  added?: number,
  skipped?: number,
): Promise<void> {
  await prisma.knowledgeSource.update({
    where: { id },
    data: {
      lastCrawlStatus: status,
      ...(status !== "idle" ? { lastCrawlAt: new Date() } : {}),
      ...(message !== undefined ? { lastCrawlMessage: message } : {}),
      ...(added !== undefined ? { lastCrawlAdded: added } : {}),
      ...(skipped !== undefined ? { lastCrawlSkipped: skipped } : {}),
    },
  });
}
