/**
 * RAG Gap Collector — records component descriptions that had no similar
 * workbench examples, so they can be reviewed and filled later.
 *
 * Gaps are stored as prompts in the "Missing Examples" workbench category.
 * Deduplicates against in-memory recent set + existing DB entries.
 *
 * Technique gaps use intelligent decomposition: the LLM decides whether
 * a gap is atomic (→ 1 prompt) or can be decomposed into sub-skill
 * prompts + a composition prompt. Falls back to simple single-prompt
 * generation if decomposition fails.
 */

import { createLogger } from "../utils/logger.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  getModelForPurposeWithFallback,
  createProviderModel,
} from "./llm-config.service.js";
import { decomposeAndCollectGap } from "./rag-gap-decomposer.service.js";
import { isSemanticDuplicateInCategory } from "./rag-gap-dedup.service.js";

const logger = createLogger("rag-gap");

const MISSING_EXAMPLES_CATEGORY = "Missing Examples";

/** In-memory dedup: track recently collected gap descriptions within this process. */
const recentGaps = new Set<string>();

// ── LLM prompt generation ─────────────────────────────────────────────

const TECHNIQUE_PROMPT_SYSTEM = `You are a 3D CAD prompt writer for Build123d. Given a Build123d technique description, generate a specific, concrete prompt for a simple 3D model that demonstrates this technique.

Rules:
- Write 1-2 sentences describing a specific physical object
- Include exact dimensions in millimeters
- Be completely unambiguous — there should be only one reasonable interpretation
- Keep the model as simple as possible while clearly demonstrating the technique
- Do NOT mention Build123d, techniques, or coding — just describe the physical object
- Do NOT use brackets, tags, or prefixes

Example input technique: "hollow shell with wall thickness using offset"
Example output: "A 50×30×25mm rectangular box hollowed out with 2mm wall thickness, open on top."

Example input technique: "3D operations extrude cut hole"
Example output: "A 60×40×20mm rectangular block with a 12mm diameter through-hole centered on the top face and a 15×10mm rectangular pocket cut 5mm deep on the front face."

Return ONLY the prompt text, nothing else.`;

/**
 * Use LLM to generate a concrete model prompt from a technique description.
 * Returns null on failure (caller falls back to raw technique string).
 */
async function generateConcretePrompt(technique: string, originalPrompt?: string): Promise<string | null> {
  try {
    const config = await getModelForPurposeWithFallback("spec_generation", "conversation");
    const model = createProviderModel(config);

    const userMessage = originalPrompt
      ? `Technique: ${technique}\n\nContext (the user was trying to build): ${originalPrompt.slice(0, 200)}`
      : `Technique: ${technique}`;

    const result = await trackedGenerateText({
      model,
      system: TECHNIQUE_PROMPT_SYSTEM,
      prompt: userMessage,
      maxOutputTokens: 256,
    }, {
      purpose: "gap_prompt_generation",
      providerName: config.provider,
      modelId: config.id,
      modelName: config.modelName,
      modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
    });

    const text = result.text?.trim();
    if (!text || text.length < 10) return null;

    logger.debug({ technique, generatedPrompt: text }, "generated concrete prompt for technique gap");
    return text;
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "LLM prompt generation failed");
    return null;
  }
}

// ── Gap collection ────────────────────────────────────────────────────

/**
 * Collect a RAG gap into the "Missing Examples" workbench category.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function collectMissingExample(componentName: string, description: string): Promise<void> {
  // In-memory dedup (same process / same batch)
  const key = description.trim().toLowerCase().slice(0, 200);
  if (recentGaps.has(key)) return;
  recentGaps.add(key);

  try {
    const { prisma } = await import("../db/prisma.js");

    // Find or skip if "Missing Examples" category doesn't exist
    const category = await prisma.workbenchCategory.findFirst({
      where: { name: MISSING_EXAMPLES_CATEGORY },
      select: { id: true },
    });
    if (!category) {
      logger.debug("Missing Examples category not found — skipping gap collection");
      return;
    }

    // DB dedup: check if a similar prompt already exists in this category
    const existing = await prisma.workbenchExamplePrompt.findFirst({
      where: {
        categoryId: category.id,
        prompt: { contains: description.slice(0, 50), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) return;

    // Embedding-based dedup catches paraphrases the prefix check misses.
    if (await isSemanticDuplicateInCategory(description, category.id)) return;

    // Use timestamp-based index to avoid race conditions on parallel inserts
    const nextIndex = Date.now() % 1_000_000;

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId: category.id,
        index: nextIndex,
        prompt: description,
        description: `Component: ${componentName}`,
      },
    });

    logger.info({ component: componentName, categoryId: category.id }, "collected missing example gap");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "gap collection failed");
  }
}

/**
 * Collect a technique-level RAG gap. Uses intelligent decomposition:
 * the LLM decides whether the gap is atomic (1 prompt) or decomposable
 * (N sub-skill prompts + 1 composition prompt). Falls back to simple
 * single-prompt generation if decomposition fails.
 */
export async function collectMissingTechnique(
  technique: string,
  query: string,
  originalPrompt?: string,
): Promise<void> {
  const key = technique.trim().toLowerCase().slice(0, 200);
  if (recentGaps.has(key)) return;
  recentGaps.add(key);

  try {
    const { prisma } = await import("../db/prisma.js");

    const category = await prisma.workbenchCategory.findFirst({
      where: { name: MISSING_EXAMPLES_CATEGORY },
      select: { id: true },
    });
    if (!category) return;

    // Try intelligent decomposition first
    try {
      const result = await decomposeAndCollectGap(technique, query, originalPrompt, category.id, recentGaps);
      logger.info({ technique, ...result }, "gap decomposition completed");
      return;
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, "gap decomposition failed, falling back to single prompt");
    }

    // Fallback: generate a single concrete prompt (old behavior)
    const concretePrompt = await generateConcretePrompt(technique, originalPrompt);
    const prompt = concretePrompt ?? `[technique] ${technique}`;

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId: category.id,
        index: Date.now() % 1_000_000,
        prompt,
        description: `Demonstrates Build123d technique: ${technique}. Search query: ${query}`,
      },
    });

    logger.info({ technique, categoryId: category.id, llmGenerated: !!concretePrompt }, "collected missing technique gap (fallback)");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "technique gap collection failed");
  }
}
