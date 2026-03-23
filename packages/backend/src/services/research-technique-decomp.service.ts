/**
 * Research Agent — Technique Decomposition
 *
 * Identifies specific Build123d techniques/patterns needed for a prompt.
 * Hybrid approach: rule-based extraction + optional LLM refinement.
 */

import { createLogger } from "../utils/logger.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  getModelForPurposeWithFallback,
  createProviderModel,
  calculateCostUsd,
} from "./llm-config.service.js";

const logger = createLogger("research-decomp");

// ── Types ────────────────────────────────────────────────────────────

export interface TechniqueEntry {
  technique: string;         // Search query, e.g., "rectangular cutout in box wall"
  operationCategory: string; // Maps to detectPromptOperations key
}

export interface TechniqueDecomposition {
  techniques: TechniqueEntry[];
  llmTokens: { prompt: number; completion: number } | null;
}

// ── Rule-based operation → technique mapping ─────────────────────────

const OPERATION_TECHNIQUE_MAP: Record<string, string> = {
  fillets: "fillet and chamfer on edges of solid body",
  offset_shell: "hollow shell with wall thickness using offset",
  sweep: "sweep solid along wire path",
  loft: "loft between two profile sketches",
  sketch_on_face: "sketch and extrude feature on existing face",
  revolve: "revolve profile around axis",
  arrays: "polar or rectangular array pattern of features",
  buildline: "custom wire profile with BuildLine",
  bd_warehouse: "bd_warehouse fastener thread bearing pipe",
  gridfinity: "gridfinity bin baseplate storage",
  boolean: "boolean union subtract intersect operations",
  "3d_ops": "3D operations extrude cut hole",
  "2d_sketch": "2D sketch rectangle circle polygon",
  positioning: "position and orient parts using Pos Rot Locations",
};

/**
 * Rule-based technique extraction from detected operations.
 * Fast fallback for simple prompts or when LLM is disabled.
 */
export function extractTechniquesFromOperations(
  promptText: string,
  _interpretation: string | undefined,
  operations: Set<string>,
): TechniqueDecomposition {
  const techniques: TechniqueEntry[] = [];

  for (const op of operations) {
    const technique = OPERATION_TECHNIQUE_MAP[op];
    if (technique) {
      techniques.push({ technique, operationCategory: op });
    }
  }

  // Always add the full prompt as an "overall model" query
  if (promptText.length > 0) {
    techniques.push({
      technique: promptText.slice(0, 200),
      operationCategory: "overall",
    });
  }

  return { techniques, llmTokens: null };
}

// ── LLM-based technique decomposition ────────────────────────────────

const DECOMP_SYSTEM_PROMPT = `You are a Build123d technique analyst. Given a 3D model request, identify the specific Build123d coding techniques needed to implement it.

For each technique, write a concise search query (5-15 words) that would find a relevant code example. Focus on HOW to implement each feature in Build123d, not WHAT the model looks like.

Rules:
- Return 3-8 techniques
- Each technique is a specific coding pattern, not a high-level description
- Focus on tricky/non-obvious techniques — skip trivial ones like "create a Box"
- Map each to a category: 2d_sketch, sketch_ops, 3d_ops, edge_face, fillets, offset_shell, arrays, buildline, sweep, loft, sketch_on_face, revolve, positioning, boolean, bd_warehouse, gridfinity

Example input: "Raspberry Pi 4 case with snap-fit lid, port cutouts, and standoffs"
Example output:
[
  {"technique": "hollow rectangular box using offset shell with open top", "category": "offset_shell"},
  {"technique": "rectangular cutout subtracted from box wall face for port opening", "category": "sketch_on_face"},
  {"technique": "cylindrical standoff with through-hole on interior floor", "category": "3d_ops"},
  {"technique": "two separate parts positioned side by side using Compound", "category": "positioning"}
]

Return JSON array only, no explanation.`;

/**
 * LLM-based technique decomposition. Produces 3-8 specific Build123d
 * technique descriptions suitable as search queries.
 */
export async function decomposeTechniquesWithLlm(
  promptText: string,
  interpretation: string | undefined,
): Promise<TechniqueDecomposition> {
  const config = await getModelForPurposeWithFallback("spec_generation");
  const model = createProviderModel(config);

  const userMessage = interpretation
    ? `User request: ${promptText}\n\nInterpretation: ${interpretation}`
    : promptText;

  const result = await trackedGenerateText({
    model,
    system: DECOMP_SYSTEM_PROMPT,
    prompt: userMessage,
    maxOutputTokens: 512,
  }, {
    purpose: "technique_research",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });

  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;

  try {
    const cleanText = result.text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleanText) as Array<{ technique: string; category: string }>;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Empty or non-array response");
    }

    const techniques: TechniqueEntry[] = parsed
      .filter(t => t.technique && t.category)
      .slice(0, 8)
      .map(t => ({ technique: t.technique, operationCategory: t.category }));

    logger.info({ count: techniques.length, techniques: techniques.map(t => t.technique) }, "LLM technique decomposition");

    return {
      techniques,
      llmTokens: { prompt: promptTokens, completion: completionTokens },
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), text: result.text.slice(0, 200) }, "technique decomposition parsing failed, falling back to rule-based");
    // Return empty — caller will use rule-based fallback
    return { techniques: [], llmTokens: { prompt: promptTokens, completion: completionTokens } };
  }
}
