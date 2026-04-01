/**
 * Research Agent — Technique-Level RAG Before Codegen
 *
 * Runs after spec generation, before codegen. Decomposes the prompt into
 * required Build123d techniques, searches for each one in the workbench
 * examples and knowledge base, and compiles a knowledge package.
 *
 * The package replaces the old preRetrieveReferenceKnowledge approach
 * with technique-targeted results that match HOW to implement features,
 * not just WHAT the model looks like.
 */

import { createLogger } from "../utils/logger.js";
import type { FewShotMatch } from "./workbench-embeddings.service.js";
import type { KnowledgeSearchMatch } from "./knowledge-search.service.js";
import {
  extractTechniquesFromOperations,
  decomposeTechniquesWithLlm,
  type TechniqueEntry,
} from "./research-technique-decomp.service.js";
import {
  searchTechniques,
  deduplicateExamples,
  deduplicateKnowledge,
  type TechniqueResearch,
  type TechniqueGap,
} from "./research-search.service.js";
import { collectMissingTechnique } from "./rag-gap-collector.service.js";

const logger = createLogger("research-agent");

// ── Types ────────────────────────────────────────────────────────────

export interface ResearchInput {
  promptText: string;
  interpretation?: string;
  /** What the thing IS — for RAG reference search (replaces promptText for "reference" queries). */
  semanticContext?: string;
  /** Precise geometric blueprint — for technique decomposition (replaces interpretation). */
  constructionSpec?: string;
  complexity?: "simple" | "medium" | "complex";
  detectedOperations: Set<string>;
  signal?: AbortSignal;
  /** Override the max workbench examples retrieved per technique (for experiments). */
  ragMaxExamplesOverride?: number;
  /** Prompt IDs to exclude from RAG retrieval (experiment contamination prevention). */
  excludePromptIds?: string[];
}

export interface ResearchPackage {
  /** Deduplicated examples across all techniques, ordered by relevance */
  examples: FewShotMatch[];
  /** Deduplicated knowledge entries across all techniques */
  knowledge: KnowledgeSearchMatch[];
  /** Human-readable gap warnings for techniques with no good matches */
  gapWarnings: string[];
  /** Raw technique analysis for multi-agent routing */
  techniques: TechniqueResearch[];
  /** Embedding token usage */
  embeddingTokens: number;
  /** LLM token usage (null if rule-based only) */
  llmTokens: { prompt: number; completion: number } | null;
}

// ── Main entry point ─────────────────────────────────────────────────

/**
 * Run the research phase: decompose into techniques → parallel search → compile package.
 * Skips LLM decomposition for simple prompts (rule-based only).
 */
export async function runResearch(input: ResearchInput): Promise<ResearchPackage> {
  const { promptText, interpretation, semanticContext, constructionSpec, complexity, detectedOperations, signal } = input;

  if (signal?.aborted) {
    return emptyPackage();
  }

  // Step 1: Technique decomposition
  // Prefer constructionSpec for technique extraction (it lists geometric operations directly)
  let techniques: TechniqueEntry[];
  let llmTokens: { prompt: number; completion: number } | null = null;
  const decompInput = constructionSpec || interpretation;

  const useRuleBased = complexity === "simple" || detectedOperations.size <= 2;

  if (useRuleBased) {
    const result = extractTechniquesFromOperations(promptText, decompInput, detectedOperations);
    techniques = result.techniques;
    logger.info({ count: techniques.length, method: "rule-based" }, "technique decomposition");
  } else {
    // Try LLM first, fall back to rule-based
    const llmResult = await decomposeTechniquesWithLlm(promptText, decompInput);
    llmTokens = llmResult.llmTokens;

    if (llmResult.techniques.length > 0) {
      techniques = llmResult.techniques;
      logger.info({ count: techniques.length, method: "llm" }, "technique decomposition");
    } else {
      const fallback = extractTechniquesFromOperations(promptText, decompInput, detectedOperations);
      techniques = fallback.techniques;
      logger.info({ count: techniques.length, method: "rule-based-fallback" }, "technique decomposition");
    }
  }

  // Always include a reference search query for subject-specific data
  // (e.g., "Raspberry Pi 4 Model B enclosure" → finds Pi 4 mechanical dimensions).
  // Prefer semanticContext (domain-focused, no dimensions) over raw prompt.
  const referenceQuery = semanticContext
    ? semanticContext.slice(0, 300)
    : (interpretation ? `${promptText} ${interpretation}`.slice(0, 300) : promptText.slice(0, 300));
  techniques.push({ technique: referenceQuery, operationCategory: "reference" });

  if (signal?.aborted) {
    return emptyPackage(llmTokens);
  }

  // Step 2: Parallel search for all techniques + prompt reference
  const searchResult = await searchTechniques(techniques, input.ragMaxExamplesOverride, input.excludePromptIds);

  // Step 3: Deduplicate across techniques
  const examples = deduplicateExamples(searchResult.techniqueResults);
  const knowledge = deduplicateKnowledge(searchResult.techniqueResults);

  // Step 4: Record technique-level gaps (fire-and-forget)
  const gapWarnings: string[] = [];
  for (const gap of searchResult.gaps) {
    gapWarnings.push(gap.technique);
    collectMissingTechnique(gap.technique, gap.query, promptText)
      .catch(err => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "technique gap collection failed"));
  }

  logger.info({
    techniques: techniques.length,
    examples: examples.length,
    knowledge: knowledge.length,
    gaps: gapWarnings.length,
    embeddingTokens: searchResult.totalEmbeddingTokens,
  }, "research phase completed");

  return {
    examples,
    knowledge,
    gapWarnings,
    techniques: searchResult.techniqueResults,
    embeddingTokens: searchResult.totalEmbeddingTokens,
    llmTokens,
  };
}

// ── Multi-agent routing ──────────────────────────────────────────────

/**
 * Filter a ResearchPackage to return only results relevant to a specific
 * component description. Uses keyword overlap between the component
 * description and each technique's search query.
 */
export function filterResearchForComponent(
  pkg: ResearchPackage,
  componentDescription: string,
): ResearchPackage {
  const descWords = new Set(
    componentDescription.toLowerCase().split(/\W+/).filter(w => w.length > 3),
  );

  // Score each technique by keyword overlap with component description
  const scored = pkg.techniques.map(t => {
    const techWords = t.technique.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const overlap = techWords.filter(w => descWords.has(w)).length;
    return { technique: t, overlap };
  });

  // Keep techniques with any overlap, plus the highest-scoring ones
  const relevant = scored
    .filter(s => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  if (relevant.length === 0) {
    // No keyword overlap — return all techniques (better than nothing)
    return pkg;
  }

  const relevantTechniques = relevant.map(r => r.technique);
  return {
    examples: deduplicateExamples(relevantTechniques),
    knowledge: deduplicateKnowledge(relevantTechniques),
    gapWarnings: pkg.gapWarnings, // Keep all gap warnings
    techniques: relevantTechniques,
    embeddingTokens: 0, // Already counted in parent
    llmTokens: null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function emptyPackage(llmTokens?: { prompt: number; completion: number } | null): ResearchPackage {
  return {
    examples: [],
    knowledge: [],
    gapWarnings: [],
    techniques: [],
    embeddingTokens: 0,
    llmTokens: llmTokens ?? null,
  };
}
