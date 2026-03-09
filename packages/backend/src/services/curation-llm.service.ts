/**
 * Curation LLM Service
 *
 * LLM-powered prompt distillation and tag suggestion for curation candidates.
 * Uses the same generateText pattern as other LLM services (semaphore + retry).
 */

import { trackedGenerateText } from "./tracked-llm.service.js";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import {
  getModelForPurpose,
  createProviderModel as createProviderModelFromConfig,
  buildGenerateOptions,
} from "./llm-config.service.js";
import { getCandidateDetail } from "./curation.service.js";

const logger = createLogger("curation-llm");

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract text from a messages JSONB array (same structure as chat items). */
function extractTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const segment of messages) {
    if (!segment || typeof segment !== "object") continue;
    const rec = segment as Record<string, unknown>;
    if (typeof rec.text === "string" && rec.text.trim().length > 0) {
      parts.push(rec.text.trim());
    }
  }
  return parts.join("\n");
}

/** Count the number of user messages in a conversation. */
function countUserMessages(
  items: Array<{ role: string }>,
): number {
  return items.filter((i) => i.role === "user").length;
}

/** Get the first user message text from conversation items. */
function extractFirstUserMessage(
  items: Array<{ role: string; messages: unknown }>,
): string {
  for (const item of items) {
    if (item.role === "user") {
      const text = extractTextFromMessages(item.messages);
      if (text) return text;
    }
  }
  return "";
}

/** Build a conversation transcript for the LLM, omitting code/file data. */
function buildConversationTranscript(
  items: Array<{ role: string; messages: unknown }>,
): string {
  const lines: string[] = [];
  for (const item of items) {
    const text = extractTextFromMessages(item.messages);
    if (!text) continue;
    const role = item.role === "user" ? "User" : "Assistant";
    lines.push(`${role}: ${text}`);
  }
  return lines.join("\n\n");
}

// ── Prompt Distillation ─────────────────────────────────────────────

const DISTILL_SYSTEM_PROMPT = `You are a prompt editor. Given a multi-turn 3D modeling conversation, produce a single clear prompt that describes the final 3D model. Focus on what the model IS, not the conversation history. Include all relevant dimensions, shapes, features, and spatial relationships mentioned across the conversation. Output only the prompt text, nothing else.`;

export interface DistillResult {
  distilledPrompt: string;
  originalPrompt: string;
  skippedLlm: boolean;
}

export async function distillPrompt(candidateId: string): Promise<DistillResult> {
  const detail = await getCandidateDetail(candidateId);
  const originalPrompt = extractFirstUserMessage(detail.conversationItems);

  if (!originalPrompt) {
    throw new Error("No user message found in conversation");
  }

  // Single-turn optimization: skip LLM call if only one user message
  const userMsgCount = countUserMessages(detail.conversationItems);
  if (userMsgCount <= 1) {
    logger.info({ candidateId }, "single-turn conversation, using original prompt directly");

    await prisma.curationCandidate.update({
      where: { id: candidateId },
      data: {
        distilledPrompt: originalPrompt,
        originalPrompt,
        updatedAt: new Date(),
      },
    });

    return { distilledPrompt: originalPrompt, originalPrompt, skippedLlm: true };
  }

  // Multi-turn: use LLM to distill
  const transcript = buildConversationTranscript(detail.conversationItems);

  const cfg = await getModelForPurpose("prompt_distill");
  const model = createProviderModelFromConfig(cfg);
  const generateOptions = buildGenerateOptions(cfg);

  logger.info(
    { candidateId, model: cfg.label, turns: detail.conversationItems.length },
    "distilling prompt from multi-turn conversation",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);

  const result = await semaphore.run(async () => {
    return withLlmRetry(
      async () =>
        trackedGenerateText({
          model,
          system: DISTILL_SYSTEM_PROMPT,
          prompt: transcript,
          ...generateOptions,
        }, {
          purpose: "curation_distill",
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          modelConfig: { costPer1mInput: cfg.costPer1mInput, costPer1mOutput: cfg.costPer1mOutput },
        }),
      { provider: cfg.provider },
    );
  });

  const distilledPrompt = result.text.trim();

  logger.info(
    { candidateId, model: cfg.label, distilledLength: distilledPrompt.length },
    "prompt distillation complete",
  );

  await prisma.curationCandidate.update({
    where: { id: candidateId },
    data: {
      distilledPrompt,
      originalPrompt,
      updatedAt: new Date(),
    },
  });

  return { distilledPrompt, originalPrompt, skippedLlm: false };
}

// ── Tag Suggestion ──────────────────────────────────────────────────

const TAG_SUGGEST_SYSTEM_PROMPT = `Given a 3D model description and a list of existing tags, suggest 1-5 tags that categorize this model. Prefer existing tags when they fit. Only suggest new tags when no existing tag is appropriate. Return a JSON array of tag name strings, nothing else. Example: ["mechanical", "gear", "industrial"]`;

export interface TagSuggestion {
  id: string;
  name: string;
  suggestedBy: "llm" | "admin";
}

export async function suggestTags(candidateId: string): Promise<TagSuggestion[]> {
  const candidate = await prisma.curationCandidate.findUnique({
    where: { id: candidateId },
    select: { distilledPrompt: true },
  });

  if (!candidate?.distilledPrompt) {
    throw new Error("Distilled prompt must be set before suggesting tags. Run prompt distillation first.");
  }

  const existingTags = await prisma.tag.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const existingTagNames = existingTags.map((t) => t.name);

  const cfg = await getModelForPurpose("tag_suggest");
  const model = createProviderModelFromConfig(cfg);
  const generateOptions = buildGenerateOptions(cfg);

  const userMessage = JSON.stringify({
    prompt: candidate.distilledPrompt,
    existingTags: existingTagNames,
  });

  logger.info(
    { candidateId, model: cfg.label, existingTagCount: existingTagNames.length },
    "suggesting tags for curation candidate",
  );

  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);

  const result = await semaphore.run(async () => {
    return withLlmRetry(
      async () =>
        trackedGenerateText({
          model,
          system: TAG_SUGGEST_SYSTEM_PROMPT,
          prompt: userMessage,
          ...generateOptions,
        }, {
          purpose: "curation_tags",
          providerName: cfg.provider,
          modelId: cfg.id,
          modelName: cfg.modelName,
          modelConfig: { costPer1mInput: cfg.costPer1mInput, costPer1mOutput: cfg.costPer1mOutput },
        }),
      { provider: cfg.provider },
    );
  });

  const tagNames = parseTagResponse(result.text);

  logger.info(
    { candidateId, model: cfg.label, tagCount: tagNames.length },
    "tag suggestion complete",
  );

  // Find-or-create tags and create candidate associations
  const tags: TagSuggestion[] = [];
  for (const name of tagNames) {
    const normalizedName = name.toLowerCase().trim();
    if (!normalizedName) continue;

    const tag = await prisma.tag.upsert({
      where: { name: normalizedName },
      update: {},
      create: { name: normalizedName },
    });

    // Upsert the candidate-tag association
    await prisma.curationCandidateTag.upsert({
      where: {
        candidateId_tagId: { candidateId, tagId: tag.id },
      },
      update: {},
      create: {
        candidateId,
        tagId: tag.id,
        suggestedBy: "llm",
      },
    });

    tags.push({ id: tag.id, name: tag.name, suggestedBy: "llm" });
  }

  return tags;
}

/** Parse the LLM tag suggestion response as a JSON string array. */
function parseTagResponse(text: string): string[] {
  const trimmed = text.trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .slice(0, 5);
    }
  } catch {
    // Fall through
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .slice(0, 5);
      }
    } catch {
      // Fall through
    }
  }

  logger.warn({ responseText: trimmed.slice(0, 200) }, "failed to parse tag suggestion response");
  return [];
}
