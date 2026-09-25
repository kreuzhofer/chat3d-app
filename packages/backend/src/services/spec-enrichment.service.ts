/**
 * Spec Enrichment Service
 *
 * Second-pass spec generation: takes the rough constructionSpec from pass 1
 * plus research results (knowledge about specific components like RPi 4 port
 * layouts) and produces a precise geometric blueprint with exact dimensions.
 *
 * Design: fail-open — if the model call fails, the original rough spec is used.
 * The criteria, though, are a contract (ADR 0002, issue #104): atoms in
 * `{ text, visibility }`, one requirement per entry; a reply of bare strings
 * or bundled atoms is retried once and then surfaced on the result, with the
 * rough spec's atoms kept — never normalised to `both`.
 */

import { trackedStreamText } from "./tracked-llm.service.js";
import { isProviderQuotaError } from "../utils/llm-errors.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
  maxOutputWithThinking,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { formatResearchSection } from "./research-format.service.js";
import type { ResearchPackage } from "./research-agent.service.js";
import type { SpecResult } from "./spec-generation.service.js";
import { createLogger } from "../utils/logger.js";
import type { AnnotatedCriterion } from "./spec-generation.service.js";
import { REQUIREMENT_ATOMS_RULES, parseRequirementAtoms, screenAtoms, type AtomsFailureReason } from "./requirement-atoms.js";

const logger = createLogger("spec-enrich");

// ── Types ────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  constructionSpec: string;
  /**
   * Annotated, matching what spec generation emits. This was `string[]`, and
   * the orchestrator spread it over the annotated array — after which every
   * consumer reading `.text` got `undefined` (issue #33).
   */
  verificationCriteria: AnnotatedCriterion[];
  /** The pass-1 atoms enrichment started from, kept beside the result so before/after is measurable. */
  roughCriteria: AnnotatedCriterion[];
  /**
   * Set when the model never met the atoms contract: `verificationCriteria`
   * is then `roughCriteria`, and the reasons name what each attempt returned.
   */
  criteriaFailure?: { attempts: number; reasons: AtomsFailureReason[] };
  promptTokens: number;
  /** Raw LLM response for training data. */
  rawResponse?: string;
  /** System prompt used for training data. */
  systemPrompt?: string;
  /** Full user message (includes research context) for training data. */
  userMessage?: string;
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
- Also produce 3-8 verification criteria: objective structural checks referencing ONLY geometry (not object identity), as REQUIREMENT ATOMS:
${REQUIREMENT_ATOMS_RULES}

Return JSON only:
{
  "constructionSpec": "- step 1 with exact dims\\n- step 2 with exact dims\\n...",
  "verificationCriteria": [
    {"text": "Exactly four standoff posts inside the box", "visibility": "visual"},
    {"text": "Standoff posts sit near the corners", "visibility": "visual"},
    {"text": "Standoff post offset from each corner is 5mm", "visibility": "code"}
  ]
}`;

/** The JSON the model is asked for; both fields are validated after parsing. */
interface EnrichmentReply { constructionSpec?: unknown; verificationCriteria?: unknown }

/** How many times the model is asked before the criteria are declared failed. */
const CRITERIA_ATTEMPTS = 2;

/** The retry names the defect; the model is not asked to guess what was wrong. */
function retryMessage(reason: AtomsFailureReason, offending: unknown): string {
  const shown = typeof offending === "string" ? JSON.stringify(offending) : JSON.stringify(offending)?.slice(0, 300);
  const why: Record<AtomsFailureReason, string> = {
    "unparseable": "the reply was not valid JSON (truncated or malformed)",
    "not-an-array": "verificationCriteria was not a list",
    "empty": "verificationCriteria was empty",
    "bare-string": `an entry was a bare string (${shown}); every entry must be {"text", "visibility"}`,
    "missing-visibility": `an entry had no valid visibility (${shown}); use "visual", "code" or "both"`,
    "empty-text": `an entry had no text (${shown})`,
    "bundled": `a "visual"/"both" entry contained a measurement (${shown}); split it — the fact stays visual, the number becomes its own "code" entry`,
  };
  return `Your previous reply did not meet the criteria contract: ${why[reason]}. Return the same JSON again with verificationCriteria as requirement atoms only.`;
}

// ── Main function ────────────────────────────────────────────────────

export async function enrichSpec(
  roughSpec: SpecResult,
  researchPackage: ResearchPackage,
  /** The user's request, for #113's orientation screen; without it only colour and routing are screened. */
  requestText?: string,
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
      roughCriteria: roughSpec.verificationCriteria,
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
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: userMessage }];
    let promptTokens = 0;
    let completionTokens = 0;
    let enrichedSpec = roughSpec.constructionSpec;
    let rawResponse = "";
    let atoms: AnnotatedCriterion[] | null = null;
    const reasons: AtomsFailureReason[] = [];

    for (let attempt = 1; attempt <= CRITERIA_ATTEMPTS; attempt++) {
      const streamResult = await semaphore.run(() => callEnrichmentModel(model, config, messages));
      promptTokens += streamResult.usage?.inputTokens ?? 0;
      completionTokens += streamResult.usage?.outputTokens ?? 0;
      rawResponse = streamResult.text;

      let parsed: EnrichmentReply | null = null;
      try {
        parsed = JSON.parse(extractJson(streamResult.text)) as EnrichmentReply;
      } catch (err) {
        logger.warn({ attempt, err: err instanceof Error ? err.message : String(err) }, "enrichment reply was not JSON");
      }
      if (parsed && typeof parsed.constructionSpec === "string" && parsed.constructionSpec.trim()) {
        enrichedSpec = parsed.constructionSpec;
      }
      const result = parsed
        ? parseRequirementAtoms(parsed.verificationCriteria)
        : { ok: false as const, reason: "unparseable" as const, offending: streamResult.text.slice(-120) };
      if (result.ok) { atoms = result.atoms; break; }
      reasons.push(result.reason);
      logger.warn({ attempt, reason: result.reason, offending: result.offending }, "enrichment criteria refused: not requirement atoms");
      if (attempt < CRITERIA_ATTEMPTS) {
        messages.push({ role: "assistant", content: streamResult.text });
        messages.push({ role: "user", content: retryMessage(result.reason, result.offending) });
      }
    }

    if (atoms) {
      const screen = screenAtoms(atoms, requestText);
      if (screen.dropped.length > 0 || screen.routed.length > 0) {
        logger.info({ dropped: screen.dropped.map((d) => ({ reason: d.reason, word: d.word, text: d.atom.text.slice(0, 80) })), routed: screen.routed.length }, "enriched atoms screened");
      }
      atoms = screen.kept.length > 0 ? screen.kept : null;
      if (!atoms) reasons.push("empty");
    }
    const criteriaFailure = atoms ? undefined : { attempts: reasons.length, reasons };
    if (criteriaFailure) {
      logger.warn({ ...criteriaFailure, roughCriteria: roughSpec.verificationCriteria.length }, "enrichment criteria failed the atoms contract; rough atoms kept");
    }
    logger.info(
      { specLength: enrichedSpec.length, criteriaCount: (atoms ?? roughSpec.verificationCriteria).length, attempts: reasons.length + (atoms ? 1 : 0), promptTokens, completionTokens },
      "spec enriched with research data",
    );

    return {
      constructionSpec: enrichedSpec,
      verificationCriteria: atoms ?? roughSpec.verificationCriteria,
      roughCriteria: roughSpec.verificationCriteria,
      ...(criteriaFailure ? { criteriaFailure } : {}),
      promptTokens, completionTokens,
      rawResponse, systemPrompt: ENRICHMENT_SYSTEM_PROMPT, userMessage,
    };
  } catch (error) {
    if (isProviderQuotaError(error)) throw error;

    // Fail-open: return original spec
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "spec enrichment failed, using rough spec");
    return {
      constructionSpec: roughSpec.constructionSpec,
      verificationCriteria: roughSpec.verificationCriteria,
      roughCriteria: roughSpec.verificationCriteria,
      promptTokens: 0,
      completionTokens: 0,
    };
  }
}

/** One streamed call; reasoning goes to a separate channel, so only text deltas are the reply. */
async function callEnrichmentModel(
  model: ReturnType<typeof createProviderModelFromConfig>,
  config: LlmModelConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ text: string; usage: { inputTokens?: number; outputTokens?: number } | undefined }> {
  const stream = trackedStreamText({
    model,
    system: ENRICHMENT_SYSTEM_PROMPT,
    messages,
    // The model's thinking setting and a budget that holds it (as the
    // generator does): without them the recipe's default reasoning ate the
    // 4,096-token budget and replies came back cut off (#89 dry run).
    ...buildGenerateOptions(config),
    maxOutputTokens: maxOutputWithThinking(4096, config),
    temperature: 0.5,
  }, {
    purpose: "spec_generation",
    providerName: config.provider,
    modelId: config.id,
    modelName: config.modelName,
    modelConfig: { costPer1mInput: config.costPer1mInput, costPer1mOutput: config.costPer1mOutput },
  });
  let text = "";
  for await (const part of stream.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  const resolved = await stream;
  return { text, usage: await resolved.usage };
}

/** The JSON object in a reply that may carry fences, thinking or prose around it. */
function extractJson(reply: string): string {
  const fenceMatch = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = reply.indexOf("{");
  const lastBrace = reply.lastIndexOf("}");
  return firstBrace !== -1 && lastBrace > firstBrace ? reply.slice(firstBrace, lastBrace + 1) : reply;
}
