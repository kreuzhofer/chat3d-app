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

import { trackedStreamText } from "./tracked-llm.service.js";
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

/** Verification criterion with visibility annotation for eval routing. */
export interface AnnotatedCriterion {
  text: string;
  /** "visual" = clearly visible at standard resolution, "code" = too small/internal, "both" = borderline */
  visibility: "visual" | "code" | "both";
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
  /** Objective structural checks with visibility annotations for eval routing. */
  verificationCriteria: AnnotatedCriterion[];
  rawResponse?: string;
  reasoning?: string;
  systemPrompt?: string;
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
   IMPORTANT: NEVER create assertions for default values you inferred — only for values the prompt EXPLICITLY states. In particular, do NOT create thickness/extrusion assertions for flat profiles or sketches unless the prompt explicitly specifies a thickness value.

6. **semanticContext**: 1-2 sentences identifying the object and its domain. No dimensions or construction details. This is used as a search query to find reference material and similar examples.
   Example: "Raspberry Pi 4 Model B enclosure with removable lid"

7. **constructionSpec**: A bulleted list describing the final geometry — dimensions, shapes, positions, and spatial relationships. Focus on WHAT the geometry IS, not HOW to construct it in CAD. Do not reference specific CAD operations (extrude, revolve, sweep, loft, boolean subtract, fillet, chamfer as verbs) — instead describe the resulting geometric features. Each bullet should describe one geometric feature or region with its dimensions.
   CRITICAL: NEVER override or recompute a dimension the prompt explicitly states. If the prompt says "65mm height", the spec MUST say 65mm — do not substitute your own calculation. Only fill in defaults for values the prompt truly omits. Do not invent features (sills, offsets, clearances) the prompt does not mention.
   CRITICAL: This is a 3D CAD pipeline — every model MUST be a 3D solid with nonzero thickness. NEVER specify "no extrusion", "zero thickness", "2D only", or "sketch geometry only". If the prompt describes a flat 2D shape, profile, or sketch without mentioning thickness, specify that it should be extruded to a small thickness (e.g., 1-5mm) to create a valid 3D solid. A "flat" or "sketch" shape is a thin 3D solid, not a 2D wireframe. The exact thickness is unimportant — any small nonzero value is acceptable.
   Include ALL dimensions from the prompt verbatim. For truly unspecified values only, derive reasonable defaults and mark them as "(default)". Example:
   - Rectangular box: 90×62×30mm, wall thickness 2mm, open top
   - Port openings (short side): USB-C 9×3.5mm at offset 7mm from corner
   - 4× cylindrical standoff posts at corner insets, 3mm tall

8. **verificationCriteria**: 3-6 objective structural checks, each annotated with a visibility category. Each item has:
   - "text": the check itself, referencing ONLY geometry (not the object's name/identity)
   - "visibility": one of "visual", "code", or "both"

   Visibility rules:
   - "visual" — overall shape, major openings (>10% of model size), proportions — clearly visible in a 768px screenshot
   - "code" — small features (<3mm relative to model), internal geometry, precise dimensions, chamfers/fillets on thin edges — impossible to verify visually
   - "both" — borderline features that both evaluators should check (e.g., standoffs inside an open box, medium-size cutouts)

   Example:
   [
     {"text": "Rectangular box shape with correct proportions", "visibility": "visual"},
     {"text": "1mm chamfer on all top edges", "visibility": "code"},
     {"text": "4 cylindrical standoff posts inside the box", "visibility": "both"}
   ]

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
  "verificationCriteria": [{"text": "...", "visibility": "visual|code|both"}]
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
  verificationCriteria: AnnotatedCriterion[];
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

/** Parse verificationCriteria — handles both annotated objects and plain strings. */
function parseVerificationCriteria(raw: unknown): AnnotatedCriterion[] {
  if (!Array.isArray(raw)) return [];
  const validVisibility = new Set(["visual", "code", "both"]);
  return raw
    .map((item: unknown) => {
      if (typeof item === "string" && item.trim()) {
        return { text: item.trim(), visibility: "both" as const };
      }
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const text = typeof obj.text === "string" ? obj.text.trim() : "";
        const vis = typeof obj.visibility === "string" && validVisibility.has(obj.visibility)
          ? obj.visibility as AnnotatedCriterion["visibility"]
          : "both";
        if (text) return { text, visibility: vis };
      }
      return null;
    })
    .filter((c): c is AnnotatedCriterion => c !== null);
}

function buildSpecFromParsed(raw: Partial<ParsedSpec>): ParsedSpec {
  const verificationCriteria = parseVerificationCriteria((raw as Record<string, unknown>).verificationCriteria);
  const verificationChecklist = Array.isArray(raw.verificationChecklist)
    ? raw.verificationChecklist.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  // Derive checklist from criteria text if no explicit checklist
  const criteriaTexts = verificationCriteria.map(c => c.text);
  const effectiveChecklist = verificationChecklist.length > 0 ? verificationChecklist : criteriaTexts;
  // Derive criteria from checklist if no explicit criteria
  const effectiveCriteria = verificationCriteria.length > 0
    ? verificationCriteria
    : verificationChecklist.map(text => ({ text, visibility: "both" as const }));

  return {
    interpretation: typeof raw.interpretation === "string" ? raw.interpretation : "",
    verificationChecklist: effectiveChecklist,
    codeAssertions: parseCodeAssertions((raw as Record<string, unknown>).codeAssertions),
    disambiguationNeeded: raw.disambiguationNeeded === true,
    disambiguationQuestions: Array.isArray(raw.disambiguationQuestions)
      ? raw.disambiguationQuestions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [],
    semanticContext: typeof raw.semanticContext === "string" ? raw.semanticContext : "",
    constructionSpec: typeof raw.constructionSpec === "string" ? raw.constructionSpec : "",
    verificationCriteria: effectiveCriteria,
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
    const { responseText, reasoning, resolved } = await semaphore.run(async () => {
      const stream = trackedStreamText({
        model,
        system: SPEC_SYSTEM_PROMPT,
        messages: [{ role: "user", content: promptText }],
        maxOutputTokens: 1536,
        temperature: 1.0,
      }, {
        purpose: "spec_generation",
        providerName: config.provider,
        modelId: config.id,
        modelName: config.modelName,
        modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
      });

      let text = "";
      let reasoningText = "";
      for await (const part of stream.fullStream) {
        if (part.type === "text-delta") text += part.text;
        else if (part.type === "reasoning" || part.type === "reasoning-delta") {
          reasoningText += (part as { text?: string }).text ?? "";
        }
      }
      const res = await stream;
      return { responseText: text, reasoning: reasoningText, resolved: res };
    });

    const parsed = parseSpecResponse(responseText);
    const promptTokens = resolved.usage?.inputTokens ?? 0;
    const completionTokens = resolved.usage?.outputTokens ?? 0;
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

    const specResult: SpecResult = {
      ...parsed,
      complexity,
      promptTokens,
      completionTokens,
    };
    specResult.rawResponse = responseText;
    specResult.reasoning = reasoning || undefined;
    specResult.systemPrompt = SPEC_SYSTEM_PROMPT;

    return specResult;
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
