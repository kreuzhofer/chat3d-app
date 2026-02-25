/**
 * Workbench Prompt Validation Service
 *
 * Lightweight LLM pre-check that catches contradictory, impossible, or
 * fundamentally ambiguous prompts before the expensive codegen → render
 * → VLM evaluation pipeline runs.
 *
 * Design: fail-open (LLM errors → valid: true) so transient failures
 * never block the pipeline.
 */

import { generateText } from "ai";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { resolveCodegenModel } from "./workbench-codegen.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("prompt-validation");

// ── Types ────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason: string | null;
  promptTokens: number;
  completionTokens: number;
}

// ── Prompt ───────────────────────────────────────────────────────────

const VALIDATION_SYSTEM_PROMPT = `You are a CAD prompt validator for Build123d 3D model generation.

Analyze the user prompt and determine if it describes a valid, buildable 3D model.

Check for:
1. CONTRADICTORY CONSTRAINTS: conflicting spatial relationships or dimensions
   (e.g. "two cubes touching, placed 20mm apart" — touching and 20mm apart are mutually exclusive)
2. PHYSICALLY IMPOSSIBLE GEOMETRY: shapes that cannot exist in 3D space
3. CRITICALLY AMBIGUOUS: the core geometry is so undefined that no reasonable interpretation exists

IMPORTANT: Be LENIENT. Most prompts should pass validation.
- Minor ambiguity is fine — the code generator infers reasonable defaults.
- Vague prompts that could be interpreted multiple ways should PASS.
- Only reject prompts with clear, unresolvable contradictions or impossibilities.

Return JSON only:
{
  "valid": true | false,
  "reason": "explanation if invalid, or null if valid"
}`;

// ── Response parsing ─────────────────────────────────────────────────

function parseValidationResponse(content: string): { valid: boolean; reason: string | null } {
  if (!content || typeof content !== "string") {
    return { valid: true, reason: null }; // fail-open
  }

  // Try to extract JSON from code fence
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr) as { valid?: boolean; reason?: string | null };
    const valid = parsed.valid !== false; // default to true
    return {
      valid,
      reason: valid ? null : (typeof parsed.reason === "string" ? parsed.reason : "Prompt validation failed"),
    };
  } catch {
    // Regex fallback
    const validMatch = content.match(/["']?valid["']?\s*[:=]\s*(true|false)/i);
    if (validMatch && validMatch[1].toLowerCase() === "false") {
      const reasonMatch = content.match(/["']?reason["']?\s*[:=]\s*"([^"]+)"/i);
      return {
        valid: false,
        reason: reasonMatch?.[1] ?? "Prompt validation failed",
      };
    }
    return { valid: true, reason: null }; // fail-open
  }
}

// ── Main validation function ─────────────────────────────────────────

export async function validatePrompt(promptText: string): Promise<ValidationResult> {
  const { model, label } = await resolveCodegenModel();

  // Mock provider — skip validation
  if (!model) {
    return { valid: true, reason: null, promptTokens: 0, completionTokens: 0 };
  }

  logger.info({ prompt: promptText.slice(0, 80), model: label }, "validating prompt");

  try {
    const result = await generateText({
      model,
      system: VALIDATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptText }],
      maxOutputTokens: 256,
    });

    const parsed = parseValidationResponse(result.text);
    logger.info({ valid: parsed.valid, reason: parsed.reason }, "validation result");

    return {
      ...parsed,
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
    };
  } catch (error) {
    // Quota exhaustion is NOT transient — abort the pipeline
    if (isProviderQuotaError(error)) {
      logger.error({ err: error }, "provider quota exhausted during validation");
      throw error;
    }

    // Fail-open: transient validation errors should never block the pipeline
    logger.warn(
      { err: error },
      "LLM call failed, passing prompt through",
    );
    return { valid: true, reason: null, promptTokens: 0, completionTokens: 0 };
  }
}
