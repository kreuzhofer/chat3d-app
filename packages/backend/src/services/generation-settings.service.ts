/**
 * Generation Settings Service
 *
 * Manages admin-configurable generation pipeline settings with a
 * default/override pattern. Hard-coded values serve as compile-time defaults;
 * DB overrides (in generation_settings_overrides) take precedence when set.
 *
 * Settings are scoped to "workbench" or "chat" pipelines so each can be
 * tuned independently.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("gen-settings");

// ── Types ────────────────────────────────────────────────────────────

export type Pipeline = "workbench" | "chat";

interface SettingMeta {
  default: number;
  label: string;
  description: string;
  pipeline: Pipeline | "chat-only" | "global";
  min: number;
  max: number;
  step: number;
}

export interface GenerationSettingDescriptor {
  key: string;
  label: string;
  description: string;
  pipeline: string;
  defaultValue: number;
  effectiveValue: number;
  isOverridden: boolean;
  min: number;
  max: number;
  step: number;
  updatedAt: string | null;
}

// ── Registry ─────────────────────────────────────────────────────────

const SETTINGS_REGISTRY = new Map<string, SettingMeta>([
  ["workbench.auto_approve_threshold", { default: 7.5, label: "Auto-approve threshold", description: "Minimum composite eval score to auto-approve", pipeline: "workbench", min: 1, max: 10, step: 0.1 }],
  ["chat.auto_approve_threshold", { default: 7.5, label: "Auto-approve threshold", description: "Minimum composite eval score to auto-approve", pipeline: "chat", min: 1, max: 10, step: 0.1 }],
  ["chat.conversation_history_max_pairs", { default: 5, label: "Conversation history max pairs", description: "Max user/assistant exchange pairs for context", pipeline: "chat-only", min: 1, max: 50, step: 1 }],
  ["workbench.spec_generation_enabled", { default: 1, label: "Spec generation enabled", description: "Enable specification step before codegen (1=on, 0=off)", pipeline: "workbench", min: 0, max: 1, step: 1 }],
  ["chat.spec_generation_enabled", { default: 1, label: "Spec generation enabled", description: "Enable specification step before codegen (1=on, 0=off)", pipeline: "chat", min: 0, max: 1, step: 1 }],
  ["chat.agent_max_steps", { default: 10, label: "Agent max tool-use steps", description: "Maximum number of tool-use steps in the agent codegen loop. Chat is user-facing, so the budget is tighter than workbench.", pipeline: "chat", min: 3, max: 50, step: 1 }],
  ["workbench.agent_max_steps", { default: 25, label: "Agent max tool-use steps", description: "Maximum number of tool-use steps in the agent codegen loop. Workbench needs more iterations to converge on hard prompts.", pipeline: "workbench", min: 3, max: 50, step: 1 }],
  ["workbench.sub_agent_max_steps", { default: 10, label: "Sub-agent max steps", description: "Maximum tool-use steps per sub-agent in multi-agent mode", pipeline: "workbench", min: 3, max: 30, step: 1 }],
  ["chat.sub_agent_max_steps", { default: 10, label: "Sub-agent max steps", description: "Maximum tool-use steps per sub-agent in multi-agent mode", pipeline: "chat", min: 3, max: 30, step: 1 }],
  ["workbench.code_eval_weight", { default: 0.4, label: "Code eval weight", description: "Weight of code evaluation in composite score (0=visual only, 1=code only)", pipeline: "workbench", min: 0, max: 1, step: 0.1 }],
  ["chat.code_eval_weight", { default: 0.4, label: "Code eval weight", description: "Weight of code evaluation in composite score (0=visual only, 1=code only)", pipeline: "chat", min: 0, max: 1, step: 0.1 }],
  ["workbench.pipeline_timeout_minutes", { default: 30, label: "Pipeline timeout (minutes)", description: "Maximum time before the pipeline is aborted. Workbench needs longer than chat for agentic codegen + fix loops.", pipeline: "workbench", min: 1, max: 120, step: 1 }],
  ["chat.pipeline_timeout_minutes", { default: 8, label: "Pipeline timeout (minutes)", description: "Maximum time before the pipeline is aborted. Chat is user-facing — fails fast rather than letting users wait on stuck loops.", pipeline: "chat", min: 1, max: 60, step: 1 }],
  ["workbench.multi_agent_pipeline_timeout_minutes", { default: 45, label: "Multi-agent pipeline timeout (minutes)", description: "Pipeline timeout when complex prompts trigger multi-agent decomposition. Multi-agent runs sub-agents in parallel + assembly, so it needs more wall-clock time than the single-agent path.", pipeline: "workbench", min: 1, max: 180, step: 1 }],
  ["chat.multi_agent_pipeline_timeout_minutes", { default: 15, label: "Multi-agent pipeline timeout (minutes)", description: "Pipeline timeout when complex prompts trigger multi-agent decomposition. Multi-agent runs sub-agents in parallel + assembly, so it needs more wall-clock time than the single-agent path.", pipeline: "chat", min: 1, max: 60, step: 1 }],
  // Global settings (apply to both workbench and chat pipelines)
  ["global.agent_search_tools", { default: 1, label: "Agent search tools", description: "Enable search_examples, search_knowledge, and lookup_api tools for agents (1=on, 0=off). When off, agents rely on pre-loaded research results only.", pipeline: "global", min: 0, max: 1, step: 1 }],
  ["global.rag_similarity_threshold", { default: 0.60, label: "RAG similarity threshold", description: "Minimum cosine similarity for examples/knowledge to be included in the pipeline", pipeline: "global", min: 0.1, max: 1.0, step: 0.05 }],
  ["global.rag_gap_threshold", { default: 0.60, label: "RAG gap detection threshold", description: "If best match is below this, flag as a gap and warn the agent. Should be ≤ rag_similarity_threshold so matches usable for retrieval don't also count as gaps.", pipeline: "global", min: 0.1, max: 1.0, step: 0.05 }],
  ["global.rag_gap_threshold_reference", { default: 0.70, label: "RAG reference gap threshold", description: "Gap threshold for subject-level reference queries (e.g., 'Raspberry Pi 4'). Slightly higher than general gap threshold to demand more specific building blocks.", pipeline: "global", min: 0.1, max: 1.0, step: 0.05 }],
  ["global.rag_max_examples", { default: 3, label: "Max workbench examples", description: "Number of workbench examples to retrieve per search", pipeline: "global", min: 1, max: 10, step: 1 }],
  ["global.rag_max_knowledge", { default: 3, label: "Max knowledge entries", description: "Number of knowledge base entries to retrieve per search", pipeline: "global", min: 1, max: 10, step: 1 }],
  ["global.llm_max_retries", { default: 3, label: "LLM max retries", description: "Maximum number of retries with exponential backoff for transient LLM failures (timeouts, rate limits, connection errors)", pipeline: "global", min: 0, max: 10, step: 1 }],
  ["workbench.spec_enrichment_enabled", { default: 1, label: "Spec enrichment enabled", description: "Enable second-pass spec enrichment using research results (1=on, 0=off). Adds ~$0.003/prompt but produces precise construction specs.", pipeline: "workbench", min: 0, max: 1, step: 1 }],
  ["global.zoom_followup_enabled", { default: 1, label: "Zoom follow-up enabled", description: "Enable targeted 2x zoom for uncertain VLM checklist items (1=on, 0=off)", pipeline: "global", min: 0, max: 1, step: 1 }],
  ["global.zoom_resolution_px", { default: 1536, label: "Zoom resolution (px)", description: "Resolution for high-res follow-up screenshots", pipeline: "global", min: 1024, max: 2048, step: 256 }],
  ["global.zoom_max_followups", { default: 3, label: "Max zoom follow-ups", description: "Maximum number of uncertain items to resolve via 2x zoom per evaluation", pipeline: "global", min: 1, max: 5, step: 1 }],
  ["global.adaptive_weight_enabled", { default: 1, label: "Adaptive eval weight", description: "Shift code/visual eval weight based on feature visibility (1=on, 0=off)", pipeline: "global", min: 0, max: 1, step: 1 }],
  ["global.adaptive_weight_range", { default: 0.2, label: "Adaptive weight range", description: "How far the code eval weight can shift from the base (±range)", pipeline: "global", min: 0.05, max: 0.4, step: 0.05 }],
  // Spec embedding
  ["global.spec_embedding_enabled", { default: 1, label: "Spec embedding enabled", description: "Embed construction specs after generation for similarity search (1=on, 0=off)", pipeline: "global", min: 0, max: 1, step: 1 }],
  // Gap decomposition
  ["global.gap_max_subskills", { default: 4, label: "Gap max sub-skills", description: "Max atomic sub-skills when decomposing a technique gap (2-6). The LLM decides whether to decompose or not.", pipeline: "global", min: 2, max: 6, step: 1 }],
]);

// ── In-memory cache ──────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
let cache: Map<string, number> | null = null;
let cacheLoadedAt = 0;

async function loadCache(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cache;
  }

  const rows = await prisma.generationSettingsOverride.findMany();
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.key, Number(row.value));
  }

  cache = map;
  cacheLoadedAt = now;
  logger.debug({ overrideCount: map.size }, "settings cache loaded");
  return map;
}

function invalidateCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

async function getEffective(key: string): Promise<number> {
  const meta = SETTINGS_REGISTRY.get(key);
  if (!meta) throw new Error(`Unknown setting key: ${key}`);

  const overrides = await loadCache();
  return overrides.get(key) ?? meta.default;
}

// ── Consumer API (pipeline-scoped) ───────────────────────────────────

export async function getAutoApproveThreshold(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.auto_approve_threshold`);
}

export async function getConversationHistoryMaxPairs(): Promise<number> {
  return getEffective("chat.conversation_history_max_pairs");
}

export async function isSpecGenerationEnabled(pipeline: Pipeline): Promise<boolean> {
  return (await getEffective(`${pipeline}.spec_generation_enabled`)) === 1;
}

export async function getAgentMaxSteps(pipeline: "chat" | "workbench"): Promise<number> {
  return getEffective(`${pipeline}.agent_max_steps`);
}

export async function getSubAgentMaxSteps(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.sub_agent_max_steps`);
}

export async function getCodeEvalWeight(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.code_eval_weight`);
}

export async function getPipelineTimeoutMs(pipeline: Pipeline): Promise<number> {
  const minutes = await getEffective(`${pipeline}.pipeline_timeout_minutes`);
  return minutes * 60 * 1000;
}

export async function getMultiAgentPipelineTimeoutMs(pipeline: Pipeline): Promise<number> {
  const minutes = await getEffective(`${pipeline}.multi_agent_pipeline_timeout_minutes`);
  return minutes * 60 * 1000;
}

// ── Global settings ──────────────────────────────────────────────────

export async function isAgentSearchToolsEnabled(): Promise<boolean> {
  return (await getEffective("global.agent_search_tools")) === 1;
}

export async function getRagSimilarityThreshold(): Promise<number> {
  return getEffective("global.rag_similarity_threshold");
}

export async function getRagGapThreshold(): Promise<number> {
  return getEffective("global.rag_gap_threshold");
}

export async function getRagGapThresholdReference(): Promise<number> {
  return getEffective("global.rag_gap_threshold_reference");
}

export async function getRagMaxExamples(): Promise<number> {
  return getEffective("global.rag_max_examples");
}

export async function getRagMaxKnowledge(): Promise<number> {
  return getEffective("global.rag_max_knowledge");
}

export async function getLlmMaxRetries(): Promise<number> {
  return getEffective("global.llm_max_retries");
}

export async function isSpecEnrichmentEnabled(): Promise<boolean> {
  return (await getEffective("workbench.spec_enrichment_enabled")) === 1;
}

export async function isZoomFollowUpEnabled(): Promise<boolean> {
  return (await getEffective("global.zoom_followup_enabled")) === 1;
}

export async function getZoomResolution(): Promise<number> {
  return getEffective("global.zoom_resolution_px");
}

export async function getZoomMaxFollowUps(): Promise<number> {
  return getEffective("global.zoom_max_followups");
}

export async function isAdaptiveWeightEnabled(): Promise<boolean> {
  return (await getEffective("global.adaptive_weight_enabled")) === 1;
}

export async function getAdaptiveWeightRange(): Promise<number> {
  return getEffective("global.adaptive_weight_range");
}

export async function isSpecEmbeddingEnabled(): Promise<boolean> {
  return (await getEffective("global.spec_embedding_enabled")) === 1;
}

export async function getGapMaxSubskills(): Promise<number> {
  return getEffective("global.gap_max_subskills");
}

// ── Admin API ────────────────────────────────────────────────────────

export async function listGenerationSettings(): Promise<GenerationSettingDescriptor[]> {
  const overrides = await loadCache();
  const result: GenerationSettingDescriptor[] = [];

  for (const [key, meta] of SETTINGS_REGISTRY) {
    const override = overrides.get(key);
    const isOverridden = override !== undefined;
    result.push({
      key,
      label: meta.label,
      description: meta.description,
      pipeline: meta.pipeline,
      defaultValue: meta.default,
      effectiveValue: isOverridden ? override : meta.default,
      isOverridden,
      min: meta.min,
      max: meta.max,
      step: meta.step,
      updatedAt: null, // populated below if overridden
    });
  }

  // Fetch updatedAt timestamps for overridden settings
  if (result.some((s) => s.isOverridden)) {
    const rows = await prisma.generationSettingsOverride.findMany({
      where: { key: { in: result.filter((s) => s.isOverridden).map((s) => s.key) } },
      select: { key: true, updatedAt: true },
    });
    const timestamps = new Map(rows.map((r) => [r.key, r.updatedAt.toISOString()]));
    for (const setting of result) {
      if (setting.isOverridden) {
        setting.updatedAt = timestamps.get(setting.key) ?? null;
      }
    }
  }

  return result;
}

export async function updateGenerationSetting(key: string, value: number): Promise<GenerationSettingDescriptor> {
  const meta = SETTINGS_REGISTRY.get(key);
  if (!meta) throw new GenerationSettingsError(`Unknown setting key: ${key}`, 400);
  if (value < meta.min || value > meta.max) {
    throw new GenerationSettingsError(`Value must be between ${meta.min} and ${meta.max}`, 400);
  }

  const row = await prisma.generationSettingsOverride.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });

  invalidateCache();
  logger.info({ key, value }, "generation setting updated");

  return {
    key,
    label: meta.label,
    description: meta.description,
    pipeline: meta.pipeline,
    defaultValue: meta.default,
    effectiveValue: Number(row.value),
    isOverridden: true,
    min: meta.min,
    max: meta.max,
    step: meta.step,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function deleteGenerationSetting(key: string): Promise<GenerationSettingDescriptor> {
  const meta = SETTINGS_REGISTRY.get(key);
  if (!meta) throw new GenerationSettingsError(`Unknown setting key: ${key}`, 400);

  await prisma.generationSettingsOverride.deleteMany({ where: { key } });
  invalidateCache();
  logger.info({ key }, "generation setting reverted to default");

  return {
    key,
    label: meta.label,
    description: meta.description,
    pipeline: meta.pipeline,
    defaultValue: meta.default,
    effectiveValue: meta.default,
    isOverridden: false,
    min: meta.min,
    max: meta.max,
    step: meta.step,
    updatedAt: null,
  };
}

// ── Error class ──────────────────────────────────────────────────────

export class GenerationSettingsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
  }
}
