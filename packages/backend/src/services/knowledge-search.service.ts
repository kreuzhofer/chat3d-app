/**
 * Knowledge Search Service — Hybrid RAG
 *
 * Combines semantic vector search (pgvector cosine similarity) with
 * lexical full-text search (PostgreSQL tsvector/tsquery) using
 * Reciprocal Rank Fusion (RRF) for merged ranking.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { embedPromptTextWithUsage } from "./workbench-embeddings.service.js";
import type { KnowledgeSearchMatch, KnowledgeSourceType } from "./knowledge.service.js";

export interface PreRetrievedReference {
  title: string;
  content: string;
}

const logger = createLogger("knowledge-search");

/** RRF constant k (from Cormack et al., 2009). Higher values flatten rank contribution. */
const RRF_K = 60;

// ── Helpers ──────────────────────────────────────────────────────────

/** Common English stop words to filter out before FTS. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "over", "out", "up", "down", "off",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "that", "which", "who", "whom", "this", "these", "those",
  "it", "its", "my", "your", "his", "her", "our", "their",
  "what", "where", "when", "how", "all", "each", "every", "any",
  "few", "more", "most", "some", "such", "no", "only", "very",
  "just", "about", "also", "then", "than", "too", "here", "there",
  "create", "make", "use", "using", "like", "want", "please",
]);

/** Max significant tokens to keep for FTS (long prompts are for semantic search). */
const MAX_FTS_TOKENS = 8;

/**
 * Extract key terms from natural language text for FTS.
 * Removes stop words, deduplicates, and caps at MAX_FTS_TOKENS.
 * Returns an OR-joined tsquery string. We use OR so entries matching any
 * subset of terms are returned, while ts_rank_cd naturally scores entries
 * with more matching terms higher. AND is too strict — even 3 technical
 * terms AND-ed together often yields 0 results in a small knowledge base.
 */
function extractKeyTerms(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
    .filter((t, i, arr) => arr.indexOf(t) === i) // deduplicate
    .slice(0, MAX_FTS_TOKENS);
  if (tokens.length === 0) return null;
  return tokens.join(" | ");
}

// ── Semantic (vector) search ─────────────────────────────────────────

async function searchSemantic(
  queryEmbedding: number[],
  limit: number,
): Promise<Array<KnowledgeSearchMatch & { rank: number }>> {
  const pgVector = `[${queryEmbedding.join(",")}]`;

  const rows = await prisma.$queryRaw<{
    id: string;
    title: string;
    description: string | null;
    code: string;
    source_type: string;
    source_url: string;
    similarity: number;
  }[]>`
    SELECT id, title, description, code, source_type, source_url,
           1 - (embedding <=> ${pgVector}::vector) AS similarity
    FROM build123d_knowledge
    WHERE embedding IS NOT NULL
      AND validation_status = 'valid'
    ORDER BY embedding <=> ${pgVector}::vector ASC
    LIMIT ${limit}
  `;

  return rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    code: r.code,
    sourceType: r.source_type as KnowledgeSourceType,
    sourceUrl: r.source_url,
    similarity: r.similarity,
    rank: i + 1,
  }));
}

// ── Lexical (full-text) search ───────────────────────────────────────

async function searchLexical(
  queryText: string,
  limit: number,
): Promise<Array<KnowledgeSearchMatch & { rank: number }>> {
  // Extract key terms (stop words removed, capped at 8 tokens) joined with OR.
  // OR matching surfaces entries containing any subset of terms, while
  // ts_rank_cd scores entries with more matching terms higher.
  const orQuery = extractKeyTerms(queryText);
  if (!orQuery) return [];

  const rows = await prisma.$queryRaw<{
    id: string;
    title: string;
    description: string | null;
    code: string;
    source_type: string;
    source_url: string;
    fts_rank: number;
  }[]>`
    SELECT id, title, description, code, source_type, source_url,
           ts_rank_cd(search_vector, to_tsquery('english', ${orQuery})) AS fts_rank
    FROM build123d_knowledge
    WHERE search_vector @@ to_tsquery('english', ${orQuery})
      AND validation_status = 'valid'
    ORDER BY fts_rank DESC
    LIMIT ${limit}
  `;

  return rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    code: r.code,
    sourceType: r.source_type as KnowledgeSourceType,
    sourceUrl: r.source_url,
    similarity: r.fts_rank,
    rank: i + 1,
  }));
}

// ── Reciprocal Rank Fusion ───────────────────────────────────────────

interface RRFCandidate extends KnowledgeSearchMatch {
  rrfScore: number;
}

function fuseResults(
  semanticResults: Array<KnowledgeSearchMatch & { rank: number }>,
  lexicalResults: Array<KnowledgeSearchMatch & { rank: number }>,
  semanticWeight: number,
  lexicalWeight: number,
  penaltyRank: number,
): RRFCandidate[] {
  const candidates = new Map<string, RRFCandidate>();

  // Score from semantic results
  for (const r of semanticResults) {
    const score = semanticWeight / (RRF_K + r.rank);
    candidates.set(r.id, { ...r, rrfScore: score });
  }

  // Add/merge lexical scores
  for (const r of lexicalResults) {
    const score = lexicalWeight / (RRF_K + r.rank);
    const existing = candidates.get(r.id);
    if (existing) {
      existing.rrfScore += score;
    } else {
      // Appeared only in lexical — penalize missing semantic rank
      const semanticPenalty = semanticWeight / (RRF_K + penaltyRank);
      candidates.set(r.id, { ...r, rrfScore: score + semanticPenalty });
    }
  }

  // Penalize semantic-only results for missing lexical rank
  for (const [id, c] of candidates) {
    const inLexical = lexicalResults.some(r => r.id === id);
    if (!inLexical) {
      c.rrfScore += lexicalWeight / (RRF_K + penaltyRank);
    }
  }

  return Array.from(candidates.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

// ── Public API ───────────────────────────────────────────────────────

export interface HybridSearchOptions {
  /** Weight for semantic search (default 0.7) */
  semanticWeight?: number;
  /** Weight for lexical search (default 0.3) */
  lexicalWeight?: number;
  /** How many candidates to fetch from each method before fusing (default 3x limit) */
  candidateMultiplier?: number;
}

export interface HybridSearchResult {
  matches: KnowledgeSearchMatch[];
  embeddingTokens: number;
}

/**
 * Hybrid search combining semantic vector similarity and lexical full-text search
 * via Reciprocal Rank Fusion (RRF).
 */
export async function hybridSearchKnowledge(
  query: string,
  limit = 5,
  options?: HybridSearchOptions,
): Promise<HybridSearchResult> {
  const semanticWeight = options?.semanticWeight ?? 0.7;
  const lexicalWeight = options?.lexicalWeight ?? 0.3;
  const candidateLimit = (options?.candidateMultiplier ?? 3) * limit;

  // Run both searches in parallel
  const { embedding: queryEmbedding, tokens: embeddingTokens } = await embedPromptTextWithUsage(query);

  const [semanticResults, lexicalResults] = await Promise.all([
    searchSemantic(queryEmbedding, candidateLimit),
    searchLexical(query, candidateLimit),
  ]);

  logger.debug(
    { semantic: semanticResults.length, lexical: lexicalResults.length, query: query.slice(0, 80) },
    "hybrid search candidates",
  );

  // Fuse results with RRF
  const fused = fuseResults(
    semanticResults,
    lexicalResults,
    semanticWeight,
    lexicalWeight,
    candidateLimit + 1, // penalty rank for missing results
  );

  // Normalize RRF scores to 0-1 range for the similarity field
  const maxScore = fused.length > 0 ? fused[0].rrfScore : 1;
  const matches = fused.slice(0, limit).map(c => ({
    id: c.id,
    title: c.title,
    description: c.description,
    code: c.code,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl,
    similarity: maxScore > 0 ? c.rrfScore / maxScore : 0,
  }));

  return { matches, embeddingTokens };
}

// ── Pre-Retrieval for Agent Codegen ──────────────────────────────────

/** Minimum normalized RRF relevance to include in pre-retrieval (0-1 scale) */
const PRE_RETRIEVAL_THRESHOLD = 0.3;

/**
 * Pre-retrieve reference knowledge matching the prompt using hybrid search.
 * Filters to reference-type entries and applies a relevance threshold to avoid
 * injecting irrelevant context into the system prompt.
 */
export async function preRetrieveReferenceKnowledge(
  promptText: string,
  interpretation?: string,
): Promise<{ references: PreRetrievedReference[]; embeddingTokens: number }> {
  const queryText = interpretation
    ? `${promptText} ${interpretation}`
    : promptText;

  const { matches, embeddingTokens } = await hybridSearchKnowledge(queryText, 5, {
    semanticWeight: 0.6,
    lexicalWeight: 0.4,
  });

  const filtered = matches
    .filter(m => m.sourceType === "reference" && m.similarity >= PRE_RETRIEVAL_THRESHOLD)
    .slice(0, 3);

  return {
    references: filtered.map(m => ({
      title: m.title,
      content: m.code,
    })),
    embeddingTokens,
  };
}

/**
 * Format pre-retrieved reference knowledge as a prompt section.
 */
export function formatReferenceSection(matches: PreRetrievedReference[]): string {
  const entries = matches.map(m =>
    `### ${m.title}\n\n${m.content}`
  ).join("\n\n---\n\n");

  return `## Reference Data (Pre-Retrieved)\n\nThe following reference specifications are relevant to this request. Use these exact dimensions and guidelines — do NOT use approximate or memorized values.\n\n${entries}`;
}
