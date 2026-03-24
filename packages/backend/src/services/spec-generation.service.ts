/**
 * Spec Generation Service
 *
 * Lightweight LLM pre-check that analyzes a prompt before codegen to:
 * 1. Produce an interpretation of the requested model
 * 2. Generate a verification checklist for VLM evaluation
 * 3. Flag critically ambiguous prompts that need disambiguation
 *
 * Design: fail-open (LLM errors → disambiguationNeeded: false) so transient
 * failures never block the codegen pipeline.
 */

import { trackedGenerateText } from "./tracked-llm.service.js";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { detectPromptOperations } from "../prompts/system-prompts.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("spec-gen");

// ── Types ────────────────────────────────────────────────────────────

export type SpecComplexity = "simple" | "medium" | "complex";

export interface CodeAssertion {
  /** Expected variable name in generated code (e.g., "diameter", "height") */
  parameter: string;
  /** Alternate variable names the code might use */
  aliases: string[];
  /** Comparison operator */
  operator: "==" | ">=" | "<=" | "approx";
  /** Expected numeric value */
  value: number;
  /** Human-readable description of what this checks */
  description: string;
}

export interface SpecResult {
  interpretation: string;
  verificationChecklist: string[];
  codeAssertions: CodeAssertion[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
  complexity: SpecComplexity;
  promptTokens: number;
  completionTokens: number;
  /** What the thing IS — domain/object type, no dimensions. For RAG search only. */
  semanticContext: string;
  /** Precise geometric blueprint — dimensions, operations, positions. For codegen agent. */
  constructionSpec: string;
  /** Objective structural checks referencing only geometry, not object identity. For VLM/code eval. */
  verificationCriteria: string[];
}

// ── System prompt ───────────────────────────────────────────────────

const SPEC_SYSTEM_PROMPT = `You are a CAD specification analyst for Build123d 3D model generation.

Given a user's prompt describing a 3D model, produce:

1. **interpretation**: A 1-2 sentence description of what you understand the model should look like. Be specific about dimensions, positions, and relationships you'll assume if not stated.

2. **verificationChecklist**: 3-6 binary yes/no questions a visual evaluator can answer by looking at the rendered model. Focus on the key geometric features. Examples:
   - "Does the model have exactly 4 through-holes?"
   - "Is there a fillet on the top edges?"
   - "Is the lid a separate piece sitting on top?"

3. **disambiguationNeeded**: true ONLY if the prompt has critical ambiguities that would lead to significantly different models. Minor ambiguities (exact fillet radius, precise hole placement) are fine — the code generator handles those.

4. **disambiguationQuestions**: If disambiguationNeeded is true, list 1-3 specific questions. Each should offer concrete choices. Example: "Should the handle be a solid bar or a hollow loop? (bar/loop)"

5. **codeAssertions**: Extract testable numeric constraints from the prompt. Each assertion should verify a specific dimension, count, or measurement that the generated code MUST satisfy. Only include assertions for values the prompt EXPLICITLY states. Each assertion has:
   - "parameter": the likely variable name in snake_case (e.g., "diameter", "wall_thickness", "num_holes")
   - "aliases": 2-4 alternate variable names the code might use (e.g., ["d", "dia", "diam"])
   - "operator": "==" for exact values, "approx" for approximate (within 10%), ">=" or "<=" for bounds
   - "value": the numeric value
   - "description": human-readable explanation (e.g., "Cylinder diameter should be 15mm")

   Example for "A cylinder with 15mm diameter and 30mm height with 4 holes":
   [
     { "parameter": "diameter", "aliases": ["d", "dia", "cyl_diameter"], "operator": "==", "value": 15, "description": "Cylinder diameter should be 15mm" },
     { "parameter": "height", "aliases": ["h", "cyl_height"], "operator": "==", "value": 30, "description": "Cylinder height should be 30mm" },
     { "parameter": "num_holes", "aliases": ["hole_count", "n_holes"], "operator": "==", "value": 4, "description": "Should have exactly 4 holes" }
   ]

   If the prompt has no explicit numeric values, return an empty array.

6. **semanticContext**: 1-2 sentences identifying the object and its domain. No dimensions or construction details. This is used as a search query to find reference material and similar examples.
   Example: "Raspberry Pi 4 Model B enclosure with removable lid"

7. **constructionSpec**: A bulleted list of geometric operations with dimensions, positions, and relationships — a machinist's blueprint. Each bullet should be one discrete construction step. Include ALL dimensions from the prompt. If exact dimensions are not stated, derive reasonable defaults and note them. Example:
   - Base box: 90×62×30mm, wall thickness 2mm
   - Port cutouts (short side): USB-C 9×3.5mm at offset 7mm from corner
   - 4× M2.5 standoffs at corner insets, height 3mm

8. **verificationCriteria**: 3-6 objective structural checks that reference ONLY geometry, not the object's name or identity. A visual evaluator should be able to check these by looking at rendered views without knowing what the object is supposed to be. Example:
   - "Rectangular box with a separate removable lid piece"
   - "Rectangular openings visible on side faces"
   - "4 cylindrical posts inside the box"

Be LENIENT about disambiguation. Most prompts should NOT need disambiguation. Only flag when multiple fundamentally different interpretations exist (e.g., "container with lid" — is the lid attached with a hinge, threaded, or snap-fit?).

Return JSON only:
{
  "interpretation": "...",
  "verificationChecklist": ["..."],
  "codeAssertions": [{"parameter": "...", "aliases": [...], "operator": "...", "value": N, "description": "..."}],
  "disambiguationNeeded": true|false,
  "disambiguationQuestions": ["..."],
  "semanticContext": "...",
  "constructionSpec": "- step 1\\n- step 2\\n...",
  "verificationCriteria": ["..."]
}`;

// ── Response parsing ─────────────────────────────────────────────────

interface ParsedSpec {
  interpretation: string;
  verificationChecklist: string[];
  codeAssertions: CodeAssertion[];
  disambiguationNeeded: boolean;
  disambiguationQuestions: string[];
  semanticContext: string;
  constructionSpec: string;
  verificationCriteria: string[];
}

const EMPTY_SPEC: ParsedSpec = {
  interpretation: "",
  verificationChecklist: [],
  codeAssertions: [],
  disambiguationNeeded: false,
  disambiguationQuestions: [],
  semanticContext: "",
  constructionSpec: "",
  verificationCriteria: [],
};

function parseCodeAssertions(raw: unknown): CodeAssertion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .filter((a) => typeof a.parameter === "string" && typeof a.value === "number")
    .map((a) => ({
      parameter: a.parameter as string,
      aliases: Array.isArray(a.aliases) ? (a.aliases as unknown[]).filter((s): s is string => typeof s === "string") : [],
      operator: (["==", ">=", "<=", "approx"].includes(a.operator as string) ? a.operator : "==") as CodeAssertion["operator"],
      value: a.value as number,
      description: typeof a.description === "string" ? a.description : `${a.parameter} should be ${a.value}`,
    }));
}

function buildSpecFromParsed(raw: Partial<ParsedSpec>): ParsedSpec {
  const verificationCriteria = Array.isArray(raw.verificationCriteria)
    ? raw.verificationCriteria.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  const verificationChecklist = Array.isArray(raw.verificationChecklist)
    ? raw.verificationChecklist.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  return {
    interpretation: typeof raw.interpretation === "string" ? raw.interpretation : "",
    verificationChecklist: verificationChecklist.length > 0 ? verificationChecklist : verificationCriteria,
    codeAssertions: parseCodeAssertions((raw as Record<string, unknown>).codeAssertions),
    disambiguationNeeded: raw.disambiguationNeeded === true,
    disambiguationQuestions: Array.isArray(raw.disambiguationQuestions)
      ? raw.disambiguationQuestions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [],
    semanticContext: typeof raw.semanticContext === "string" ? raw.semanticContext : "",
    constructionSpec: typeof raw.constructionSpec === "string" ? raw.constructionSpec : "",
    verificationCriteria: verificationCriteria.length > 0 ? verificationCriteria : verificationChecklist,
  };
}

export function parseSpecResponse(content: string): ParsedSpec {
  if (!content || typeof content !== "string") {
    return EMPTY_SPEC; // fail-open
  }

  // Level 1: Extract JSON from code fence
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Level 2: Direct JSON.parse
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ParsedSpec>;
    return buildSpecFromParsed(parsed);
  } catch {
    // fall through
  }

  // Level 3: Regex extraction
  const interpretationMatch = content.match(/["']?interpretation["']?\s*[:=]\s*"([^"]+)"/i);
  const disambiguationMatch = content.match(/["']?disambiguationNeeded["']?\s*[:=]\s*(true|false)/i);

  if (interpretationMatch || disambiguationMatch) {
    return {
      interpretation: interpretationMatch?.[1] ?? "",
      verificationChecklist: [],
      codeAssertions: [],
      disambiguationNeeded: disambiguationMatch?.[1]?.toLowerCase() === "true",
      disambiguationQuestions: [],
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
    };
  }

  return EMPTY_SPEC; // fail-open
}

// ── Model resolution ────────────────────────────────────────────────

async function resolveSpecModel(): Promise<{ model: ReturnType<typeof createProviderModelFromConfig>; label: string; config: LlmModelConfig }> {
  let config: LlmModelConfig;
  try {
    config = await getModelForPurpose("spec_generation");
  } catch {
    // Fall back to conversation model if spec_generation not configured
    logger.info("spec_generation purpose not configured, falling back to conversation model");
    config = await getModelForPurpose("conversation");
  }
  return {
    model: createProviderModelFromConfig(config),
    label: config.label,
    config,
  };
}

// ── Complexity derivation ────────────────────────────────────────────

/** Patterns that indicate the model has multiple distinct parts requiring assembly. */
const MULTI_PART_PATTERN = /\b(two[- ]parts?|multi[- ]parts?|separate\s+parts?|top\s+and\s+bottom|base\s+and\s+(cover|lid|top)|lid\s+and\s+base|snap[- ]fit|hinge[ds]?\s+(lid|cover)|mating\s+parts?|interlocking|dovetail\s+joint|assembly|two[- ]piece|two[- ]halves?|upper\s+and\s+lower|clamshell)\b/i;

export function deriveComplexity(promptText: string, interpretation?: string): SpecComplexity {
  const combined = interpretation ? `${promptText} ${interpretation}` : promptText;
  const ops = detectPromptOperations(promptText, interpretation);
  // 3d_ops and 2d_sketch are always added by detectPromptOperations,
  // so subtract those to count only detected specific operations
  const specificOps = ops.size - 2; // subtract always-included 3d_ops and 2d_sketch

  // Multi-part models are always complex — they need decomposition + assembly
  if (MULTI_PART_PATTERN.test(combined)) return "complex";

  if (specificOps <= 2) return "simple";
  if (specificOps <= 5) return "medium";
  return "complex";
}

// ── Main function ────────────────────────────────────────────────────

export async function generateSpec(promptText: string): Promise<SpecResult> {
  let modelConfig: LlmModelConfig | null = null;

  try {
    const { model, label, config } = await resolveSpecModel();
    modelConfig = config;

    logger.debug({ prompt: promptText, model: label }, "generating spec");

    const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
    const result = await semaphore.run(async () =>
      trackedGenerateText({
        model,
        system: SPEC_SYSTEM_PROMPT,
        messages: [{ role: "user", content: promptText }],
        maxOutputTokens: 1536,
      }, {
        purpose: "spec_generation",
        providerName: config.provider,
        modelId: config.id,
        modelName: config.modelName,
        modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
      }),
    );

    const parsed = parseSpecResponse(result.text);
    const promptTokens = result.usage?.inputTokens ?? 0;
    const completionTokens = result.usage?.outputTokens ?? 0;
    const complexity = deriveComplexity(promptText, parsed.interpretation);

    logger.info(
      {
        disambiguationNeeded: parsed.disambiguationNeeded,
        checklistCount: parsed.verificationChecklist.length,
        assertionCount: parsed.codeAssertions.length,
        questionCount: parsed.disambiguationQuestions.length,
        criteriaCount: parsed.verificationCriteria.length,
        hasConstructionSpec: parsed.constructionSpec.length > 0,
        hasSemanticContext: parsed.semanticContext.length > 0,
        interpretation: parsed.interpretation,
        complexity,
      },
      "spec generated",
    );
    if (parsed.codeAssertions.length > 0) {
      logger.debug(
        { assertions: parsed.codeAssertions.map((a) => `${a.parameter}${a.operator}${a.value}`) },
        "extracted code assertions",
      );
    }

    return {
      ...parsed,
      complexity,
      promptTokens,
      completionTokens,
    };
  } catch (error) {
    // Quota exhaustion is NOT transient — abort the pipeline
    if (isProviderQuotaError(error)) {
      logger.error({ err: error }, "provider quota exhausted during spec generation");
      throw error;
    }

    // Fail-open: transient spec generation errors should never block the pipeline
    logger.warn({ err: error }, "spec generation failed, proceeding without spec");
    return {
      ...EMPTY_SPEC,
      complexity: deriveComplexity(promptText),
      promptTokens: 0,
      completionTokens: 0,
      semanticContext: "",
      constructionSpec: "",
      verificationCriteria: [],
    };
  }
}

// ── Chat disambiguation response formatter ──────────────────────────

export function formatDisambiguationResponse(_conversationText: string, spec: SpecResult): string {
  const questions = spec.disambiguationQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  return `I'd like to create this 3D model for you, but I have a few questions first to make sure I get it right:\n\n${questions}\n\nPlease answer these questions and I'll generate the model.`;
}
