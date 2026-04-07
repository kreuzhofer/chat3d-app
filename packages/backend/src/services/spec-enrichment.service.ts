/**
 * Spec Enrichment Service
 *
 * Second-pass spec generation: takes the rough constructionSpec from pass 1
 * plus research results (knowledge about specific components like RPi 4 port
 * layouts) and produces a precise geometric blueprint with exact dimensions.
 *
 * Design: fail-open — if enrichment fails, the original rough spec is used.
 */

import { trackedGenerateText } from "./tracked-llm.service.js";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { formatResearchSection } from "./research-format.service.js";
import type { ResearchPackage } from "./research-agent.service.js";
import type { SpecResult } from "./spec-generation.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("spec-enrich");

// ── Types ────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  constructionSpec: string;
  verificationCriteria: string[];
  promptTokens: number;
  completionTokens: number;
}

// ── System prompt ───────────────────────────────────────────────────

const ENRICHMENT_SYSTEM_PROMPT = `You are a CAD specification enricher for Build123d 3D model generation.

You receive a rough construction specification and reference material (knowledge base entries with dimensions, port layouts, technical drawings, etc.).

Your job is to produce a PRECISE geometric blueprint by incorporating exact dimensions from the reference material into the rough spec. If the reference material contains specific measurements (port sizes, mounting hole positions, board dimensions), use them to replace any rough or estimated values.

Rules:
- Output a bulleted construction spec with ALL dimensions resolved to exact values where reference data is available
- Keep the same structure as the input spec, just make it more precise
- If reference data contradicts the rough spec, prefer the reference data
- If no reference data is relevant to a particular line, keep the original value
- Also produce 3-6 verification criteria: objective structural checks referencing ONLY geometry (not object identity)

Return JSON only:
{
  "constructionSpec": "- step 1 with exact dims\\n- step 2 with exact dims\\n...",
  "verificationCriteria": ["structural check 1", "structural check 2", ...]
}`;

// ── Main function ────────────────────────────────────────────────────

export async function enrichSpec(
  roughSpec: SpecResult,
  researchPackage: ResearchPackage,
): Promise<EnrichmentResult> {
  let config: LlmModelConfig;
  for (const purpose of ["spec_enrichment", "spec_generation", "conversation"] as const) {
    try {
      config = await getModelForPurpose(purpose);
      break;
    } catch { continue; }
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!config!) throw new Error("No LLM model configured for spec enrichment");

  const model = createProviderModelFromConfig(config);

  // Format research results for context
  const researchContext = formatResearchSection(researchPackage);
  if (!researchContext) {
    logger.debug("no research context available for enrichment, skipping");
    return {
      constructionSpec: roughSpec.constructionSpec,
      verificationCriteria: roughSpec.verificationCriteria,
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  const userMessage = [
    "## Rough Construction Specification",
    "",
    roughSpec.constructionSpec,
    "",
    "## Original Request",
    "",
    roughSpec.semanticContext || roughSpec.interpretation,
    "",
    "## Reference Material",
    "",
    researchContext,
  ].join("\n");

  try {
    const semaphore = getLlmSemaphore(config.provider, config.maxConcurrent);
    const result = await semaphore.run(async () =>
      trackedGenerateText({
        model,
        system: ENRICHMENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        maxOutputTokens: 1024,
        temperature: 0.5,
      }, {
        purpose: "spec_generation",
        providerName: config.provider,
        modelId: config.id,
        modelName: config.modelName,
        modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
      }),
    );

    const promptTokens = result.usage?.inputTokens ?? 0;
    const completionTokens = result.usage?.outputTokens ?? 0;

    // Parse response — strip thinking content and code fences
    let jsonStr = result.text;
    // Strip Gemma 4 thinking prefix (appears when reasoning leaks into content)
    jsonStr = jsonStr.replace(/^thought\n[\s\S]*?\n(?=```|\{)/i, "");
    // Strip code fences
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    // Last resort: find first { to last }
    if (!jsonStr.startsWith("{")) {
      const firstBrace = jsonStr.indexOf("{");
      const lastBrace = jsonStr.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
    }

    const parsed = JSON.parse(jsonStr) as {
      constructionSpec?: string;
      verificationCriteria?: string[];
    };

    const enrichedSpec = typeof parsed.constructionSpec === "string" && parsed.constructionSpec.trim()
      ? parsed.constructionSpec
      : roughSpec.constructionSpec;

    const enrichedCriteria = Array.isArray(parsed.verificationCriteria)
      ? parsed.verificationCriteria.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : roughSpec.verificationCriteria;

    logger.info(
      { specLength: enrichedSpec.length, criteriaCount: enrichedCriteria.length, promptTokens, completionTokens },
      "spec enriched with research data",
    );

    return { constructionSpec: enrichedSpec, verificationCriteria: enrichedCriteria, promptTokens, completionTokens };
  } catch (error) {
    if (isProviderQuotaError(error)) throw error;

    // Fail-open: return original spec
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "spec enrichment failed, using rough spec");
    return {
      constructionSpec: roughSpec.constructionSpec,
      verificationCriteria: roughSpec.verificationCriteria,
      promptTokens: 0,
      completionTokens: 0,
    };
  }
}
