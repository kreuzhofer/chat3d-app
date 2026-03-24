/**
 * Research Agent — Parallel Search Orchestration
 *
 * Runs parallel searches (workbench examples + knowledge base) for each
 * identified technique. Deduplicates results across techniques.
 */

import { createLogger } from "../utils/logger.js";
import { findSimilarExamples, type FewShotMatch } from "./workbench-embeddings.service.js";
import { hybridSearchKnowledge, type KnowledgeSearchMatch } from "./knowledge-search.service.js";
import {
  getRagSimilarityThreshold,
  getRagGapThreshold,
  getRagGapThresholdReference,
  getRagMaxExamples,
  getRagMaxKnowledge,
} from "./generation-settings.service.js";
import type { TechniqueEntry } from "./research-technique-decomp.service.js";

const logger = createLogger("research-search");

// ── Types ────────────────────────────────────────────────────────────

export interface TechniqueResearch {
  technique: string;
  operationCategory: string;
  examples: FewShotMatch[];
  knowledge: KnowledgeSearchMatch[];
  bestSimilarity: number;
}

export interface TechniqueGap {
  technique: string;
  bestSimilarity: number;
  query: string;
}

export interface SearchResult {
  techniqueResults: TechniqueResearch[];
  gaps: TechniqueGap[];
  totalEmbeddingTokens: number;
}

// ── Parallel search ──────────────────────────────────────────────────

/**
 * Run parallel searches for a batch of techniques.
 * Each technique gets both a workbench example search and a knowledge search.
 * Results are filtered by the global similarity threshold.
 */
export async function searchTechniques(
  techniques: TechniqueEntry[],
): Promise<SearchResult> {
  const [simThreshold, gapThreshold, gapThresholdRef, maxExamples, maxKnowledge] = await Promise.all([
    getRagSimilarityThreshold(),
    getRagGapThreshold(),
    getRagGapThresholdReference(),
    getRagMaxExamples(),
    getRagMaxKnowledge(),
  ]);

  let totalEmbeddingTokens = 0;
  const gaps: TechniqueGap[] = [];

  // Run all searches in parallel
  const results = await Promise.all(
    techniques.map(async (t): Promise<TechniqueResearch> => {
      let examples: FewShotMatch[] = [];
      let knowledge: KnowledgeSearchMatch[] = [];

      // Parallel: examples + knowledge for this technique
      const [exResult, knResult] = await Promise.allSettled([
        findSimilarExamples(t.technique, maxExamples),
        hybridSearchKnowledge(t.technique, maxKnowledge),
      ]);

      if (exResult.status === "fulfilled") {
        totalEmbeddingTokens += exResult.value.embeddingTokens;
        examples = exResult.value.matches.filter(m => m.similarity >= simThreshold);
      } else {
        logger.warn({ technique: t.technique, err: exResult.reason?.message }, "example search failed");
      }

      if (knResult.status === "fulfilled") {
        totalEmbeddingTokens += knResult.value.embeddingTokens;
        knowledge = knResult.value.matches.filter(m => m.similarity >= simThreshold);
      } else {
        logger.warn({ technique: t.technique, err: knResult.reason?.message }, "knowledge search failed");
      }

      const bestSim = Math.max(
        ...examples.map(e => e.similarity),
        ...knowledge.map(k => k.similarity),
        0,
      );

      // Record gap if best match is below threshold.
      // Reference queries (subject-level, e.g. "Raspberry Pi 4") use a higher
      // threshold to be more demanding about building-block examples.
      const effectiveGapThreshold = t.operationCategory === "reference" ? gapThresholdRef : gapThreshold;
      if (bestSim < effectiveGapThreshold) {
        gaps.push({ technique: t.technique, bestSimilarity: bestSim, query: t.technique });
      }

      return {
        technique: t.technique,
        operationCategory: t.operationCategory,
        examples,
        knowledge,
        bestSimilarity: bestSim,
      };
    }),
  );

  logger.info({
    techniques: results.length,
    totalExamples: results.reduce((s, r) => s + r.examples.length, 0),
    totalKnowledge: results.reduce((s, r) => s + r.knowledge.length, 0),
    gaps: gaps.length,
  }, "technique searches completed");

  return { techniqueResults: results, gaps, totalEmbeddingTokens };
}

// ── Deduplication ────────────────────────────────────────────────────

/**
 * Deduplicate examples across multiple technique results.
 * Keeps the highest similarity score for each unique prompt.
 */
export function deduplicateExamples(techniqueResults: TechniqueResearch[]): FewShotMatch[] {
  const byPrompt = new Map<string, FewShotMatch>();
  for (const tr of techniqueResults) {
    for (const ex of tr.examples) {
      const existing = byPrompt.get(ex.prompt);
      if (!existing || ex.similarity > existing.similarity) {
        byPrompt.set(ex.prompt, ex);
      }
    }
  }
  return [...byPrompt.values()].sort((a, b) => b.similarity - a.similarity);
}

/**
 * Deduplicate knowledge entries across technique results.
 * Keeps the highest similarity score for each unique title.
 */
export function deduplicateKnowledge(techniqueResults: TechniqueResearch[]): KnowledgeSearchMatch[] {
  const byTitle = new Map<string, KnowledgeSearchMatch>();
  for (const tr of techniqueResults) {
    for (const k of tr.knowledge) {
      const existing = byTitle.get(k.title);
      if (!existing || k.similarity > existing.similarity) {
        byTitle.set(k.title, k);
      }
    }
  }
  return [...byTitle.values()].sort((a, b) => b.similarity - a.similarity);
}
