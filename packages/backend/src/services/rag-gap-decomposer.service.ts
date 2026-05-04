/**
 * RAG Gap Decomposer — intelligent gap analysis that decides whether a
 * technique gap is atomic (→ 1 prompt) or decomposable (→ N sub-skill
 * prompts + 1 composition prompt).
 *
 * Single LLM call makes the judgment. Produces training-ready prompts
 * stored in the "Missing Examples" workbench category.
 */

import { createLogger } from "../utils/logger.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  getModelForPurposeWithFallback,
  createProviderModel,
} from "./llm-config.service.js";
import { getGapMaxSubskills } from "./generation-settings.service.js";
import { isSemanticDuplicateInCategory } from "./rag-gap-dedup.service.js";

const logger = createLogger("rag-gap-decomp");

// ── Types ────────────────────────────────────────────────────────────

interface SubSkillEntry {
  name: string;
  prompt: string;
}

type GapAnalysisResult =
  | { mode: "single"; prompt: string }
  | { mode: "decomposed"; subskills: SubSkillEntry[]; composition: string };

// ── System prompt ────────────────────────────────────────────────────

function buildGapAnalysisSystem(maxSubskills: number): string {
  return `You are a Build123d training data curator. Given a CAD technique that is missing from a training dataset, decide how to fill the gap.

If the technique is already simple and atomic (one Build123d concept), generate a single concrete model prompt.

If the technique combines multiple distinct Build123d concepts, decompose it into 2-${maxSubskills} atomic sub-skill prompts PLUS one composition prompt that combines all sub-skills into a single realistic object.

Rules for ALL prompts:
- Describe a specific physical object with exact dimensions in mm
- Be completely unambiguous — one reasonable interpretation only
- Do NOT mention Build123d, techniques, coding, or programming
- Do NOT use brackets, tags, or prefixes

Rules for sub-skill prompts:
- Simplest possible model demonstrating ONLY that one technique
- No extra features, fillets, or decorations beyond what the skill requires

Rules for the composition prompt:
- A realistic, functional object (enclosure, bracket, mount, tool, etc.)
- Must use ALL listed sub-skills
- 2-4 sentences with exact dimensions for each major feature

Return JSON only. Two possible formats:

For atomic techniques:
{"mode":"single","prompt":"A 50x30x25mm rectangular box hollowed out with 2mm wall thickness, open on top."}

For decomposable techniques:
{"mode":"decomposed","subskills":[{"name":"rectangular shell","prompt":"A 50x30x25mm box hollowed out with 2mm walls, open on top."},{"name":"rectangular wall cutout","prompt":"A 60x40x30mm box with a 20x10mm rectangular hole cut through the front face."},{"name":"cylindrical standoff","prompt":"A 6mm diameter, 10mm tall cylinder with a 3mm through-hole, standing on a 15x15x2mm base plate."}],"composition":"An 80x50x35mm electronics enclosure with 2mm walls, open on top. The front face has a 25x10mm rectangular cutout centered 15mm from the bottom. Four 6mm diameter, 8mm tall standoffs with 3mm through-holes are placed 5mm inward from each corner on the interior floor."}`;
}

// ── LLM call ─────────────────────────────────────────────────────────

/**
 * Single LLM call that analyzes a technique gap and returns either a
 * single prompt or a decomposed set of sub-skill + composition prompts.
 */
async function analyzeGap(
  technique: string,
  originalPrompt: string | undefined,
  maxSubskills: number,
): Promise<GapAnalysisResult | null> {
  const config = await getModelForPurposeWithFallback("spec_generation");
  const model = createProviderModel(config);

  const userMessage = originalPrompt
    ? `Technique: ${technique}\n\nContext (the user was trying to build): ${originalPrompt.slice(0, 200)}`
    : `Technique: ${technique}`;

  const result = await trackedGenerateText({
    model,
    system: buildGapAnalysisSystem(maxSubskills),
    prompt: userMessage,
    maxOutputTokens: 800,
  }, {
    purpose: "gap_decomposition",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });

  const text = result.text?.trim();
  if (!text || text.length < 10) return null;

  // Parse JSON — strip code fences if present
  const cleanText = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  const parsed = JSON.parse(cleanText);

  if (parsed.mode === "single" && typeof parsed.prompt === "string" && parsed.prompt.length >= 10) {
    return { mode: "single", prompt: parsed.prompt };
  }

  if (parsed.mode === "decomposed" && Array.isArray(parsed.subskills) && typeof parsed.composition === "string") {
    const subskills = parsed.subskills
      .filter((s: { name?: string; prompt?: string }) =>
        typeof s.name === "string" && typeof s.prompt === "string" && s.prompt.length >= 10)
      .slice(0, maxSubskills)
      .map((s: { name: string; prompt: string }) => ({ name: s.name, prompt: s.prompt }));

    if (subskills.length === 0) return null;
    if (parsed.composition.length < 10) return null;

    return { mode: "decomposed", subskills, composition: parsed.composition };
  }

  return null;
}

// ── Storage ──────────────────────────────────────────────────────────

interface StoreResult {
  stored: number;
  skipped: number;
}

/**
 * Check if a prompt already exists in the category (DB substring dedup).
 */
async function isDuplicate(
  promptText: string,
  categoryId: string,
  prisma: import("@prisma/client").PrismaClient,
): Promise<boolean> {
  const existing = await prisma.workbenchExamplePrompt.findFirst({
    where: {
      categoryId,
      prompt: { contains: promptText.slice(0, 50), mode: "insensitive" },
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Analyze a technique gap and store the resulting prompts.
 * Returns the number of prompts stored and skipped.
 */
export async function decomposeAndCollectGap(
  technique: string,
  query: string,
  originalPrompt: string | undefined,
  categoryId: string,
  recentGaps: Set<string>,
): Promise<StoreResult> {
  const maxSubskills = await getGapMaxSubskills();
  const analysisResult = await analyzeGap(technique, originalPrompt, maxSubskills);

  if (!analysisResult) {
    throw new Error("Gap analysis returned no usable result");
  }

  const { prisma } = await import("../db/prisma.js");
  let stored = 0;
  let skipped = 0;

  if (analysisResult.mode === "single") {
    // Atomic gap — store one prompt (same as old behavior)
    const key = analysisResult.prompt.trim().toLowerCase().slice(0, 200);
    if (recentGaps.has(key) || await isDuplicate(analysisResult.prompt, categoryId, prisma)) {
      return { stored: 0, skipped: 1 };
    }
    if (await isSemanticDuplicateInCategory(analysisResult.prompt, categoryId)) {
      return { stored: 0, skipped: 1 };
    }
    recentGaps.add(key);

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId,
        index: Date.now() % 1_000_000,
        prompt: analysisResult.prompt,
        description: `Demonstrates: ${technique}. Search query: ${query}`,
      },
    });

    logger.info({ technique, mode: "single" }, "stored atomic gap prompt");
    return { stored: 1, skipped: 0 };
  }

  // Decomposed gap — store sub-skills + composition
  const groupId = `g-${Date.now()}`;
  const { subskills, composition } = analysisResult;

  // Store sub-skill prompts (dedup each individually)
  for (const skill of subskills) {
    const key = skill.prompt.trim().toLowerCase().slice(0, 200);
    if (recentGaps.has(key) || await isDuplicate(skill.prompt, categoryId, prisma)) {
      skipped++;
      continue;
    }
    if (await isSemanticDuplicateInCategory(skill.prompt, categoryId)) {
      skipped++;
      continue;
    }
    recentGaps.add(key);

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId,
        index: Date.now() % 1_000_000,
        prompt: skill.prompt,
        description: `[gap-group:${groupId}] Sub-skill: ${skill.name}. Gap: ${technique}`,
      },
    });
    stored++;
  }

  // Always store the composition prompt (combining skills is a distinct need)
  const compKey = composition.trim().toLowerCase().slice(0, 200);
  const compositionDup =
    recentGaps.has(compKey) || (await isSemanticDuplicateInCategory(composition, categoryId));
  if (!compositionDup) {
    recentGaps.add(compKey);

    await prisma.workbenchExamplePrompt.create({
      data: {
        categoryId,
        index: Date.now() % 1_000_000,
        prompt: composition,
        description: `[gap-group:${groupId}] Composition of ${subskills.length} sub-skills. Gap: ${technique}`,
      },
    });
    stored++;
  }

  logger.info({
    technique,
    mode: "decomposed",
    subskills: subskills.length,
    stored,
    skipped,
    groupId,
  }, "stored decomposed gap prompts");

  return { stored, skipped };
}
