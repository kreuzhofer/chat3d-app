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
  pipeline: Pipeline | "chat-only";
  min: number;
  max: number;
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
  updatedAt: string | null;
}

// ── Registry ─────────────────────────────────────────────────────────

const SETTINGS_REGISTRY = new Map<string, SettingMeta>([
  ["workbench.max_fix_iterations", { default: 5, label: "Max fix iterations", description: "Maximum code-fix-render loop iterations", pipeline: "workbench", min: 1, max: 20 }],
  ["chat.max_fix_iterations", { default: 5, label: "Max fix iterations", description: "Maximum code-fix-render loop iterations", pipeline: "chat", min: 1, max: 20 }],
  ["workbench.auto_approve_threshold", { default: 8, label: "Auto-approve threshold", description: "Minimum VLM eval score to auto-approve", pipeline: "workbench", min: 1, max: 10 }],
  ["chat.auto_approve_threshold", { default: 8, label: "Auto-approve threshold", description: "Minimum VLM eval score to auto-approve", pipeline: "chat", min: 1, max: 10 }],
  ["workbench.looks_correct_threshold", { default: 7, label: "Looks-correct threshold", description: "Minimum VLM score to mark as 'looks correct'", pipeline: "workbench", min: 1, max: 10 }],
  ["chat.looks_correct_threshold", { default: 7, label: "Looks-correct threshold", description: "Minimum VLM score to mark as 'looks correct'", pipeline: "chat", min: 1, max: 10 }],
  ["chat.conversation_history_max_pairs", { default: 5, label: "Conversation history max pairs", description: "Max user/assistant exchange pairs for context", pipeline: "chat-only", min: 1, max: 50 }],
  ["workbench.few_shot_example_limit", { default: 6, label: "Few-shot example limit", description: "Number of few-shot examples to include in prompt", pipeline: "workbench", min: 0, max: 20 }],
  ["chat.few_shot_example_limit", { default: 6, label: "Few-shot example limit", description: "Number of few-shot examples to include in prompt", pipeline: "chat", min: 0, max: 20 }],
  ["chat.codegen_base_temperature", { default: 0.3, label: "Codegen base temperature", description: "Base temperature for code generation (increases per fix iteration)", pipeline: "chat", min: 0, max: 1 }],
  ["chat.codegen_temperature_step", { default: 0.1, label: "Codegen temperature step", description: "Temperature increase per fix iteration", pipeline: "chat", min: 0, max: 0.3 }],
  ["workbench.spec_generation_enabled", { default: 1, label: "Spec generation enabled", description: "Enable specification step before codegen (1=on, 0=off)", pipeline: "workbench", min: 0, max: 1 }],
  ["chat.spec_generation_enabled", { default: 1, label: "Spec generation enabled", description: "Enable specification step before codegen (1=on, 0=off)", pipeline: "chat", min: 0, max: 1 }],
  ["workbench.tiered_prompt_enabled", { default: 1, label: "Tiered prompt enabled", description: "Use operation-aware tiered system prompt instead of full prompt (1=on, 0=off)", pipeline: "workbench", min: 0, max: 1 }],
  ["chat.tiered_prompt_enabled", { default: 1, label: "Tiered prompt enabled", description: "Use operation-aware tiered system prompt instead of full prompt (1=on, 0=off)", pipeline: "chat", min: 0, max: 1 }],
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

export async function getMaxFixIterations(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.max_fix_iterations`);
}

export async function getAutoApproveThreshold(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.auto_approve_threshold`);
}

export async function getLooksCorrectThreshold(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.looks_correct_threshold`);
}

export async function getConversationHistoryMaxPairs(): Promise<number> {
  return getEffective("chat.conversation_history_max_pairs");
}

export async function getFewShotExampleLimit(pipeline: Pipeline): Promise<number> {
  return getEffective(`${pipeline}.few_shot_example_limit`);
}

export async function getCodegenBaseTemperature(): Promise<number> {
  return getEffective("chat.codegen_base_temperature");
}

export async function getCodegenTemperatureStep(): Promise<number> {
  return getEffective("chat.codegen_temperature_step");
}

export async function isSpecGenerationEnabled(pipeline: Pipeline): Promise<boolean> {
  return (await getEffective(`${pipeline}.spec_generation_enabled`)) === 1;
}

export async function isTieredPromptEnabled(pipeline: Pipeline): Promise<boolean> {
  return (await getEffective(`${pipeline}.tiered_prompt_enabled`)) === 1;
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
