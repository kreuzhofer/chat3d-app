/**
 * Zoom follow-up parity (issue #54).
 *
 * Production resolves uncertain checklist items with a targeted 2x follow-up
 * behind the `global.zoom_*` settings. The experiment executor must run the
 * same follow-up — answered by the judge under test, not by the production
 * `vlm_eval` judge — or every judge comparison penalises exactly the judges
 * that say "uncertain" most. These tests pin the engine both callers share.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture the render and the follow-up LLM calls instead of making them ──

const renderCalls: Array<Record<string, unknown>> = [];
vi.mock("../services/stl-rendering-client.service.js", () => ({
  renderModelScreenshots: vi.fn(async (opts: Record<string, unknown>) => {
    renderCalls.push(opts);
    const angles = opts.angles as string[];
    return { images: angles.map((angle) => ({ angle, base64: `IMG-${angle}` })) };
  }),
}));

const generateCalls: Array<{ options: Record<string, unknown>; tracking: Record<string, unknown> }> = [];
let nextAnswer = '{"pass": true, "detail": "resolved at 2x"}';
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedGenerateText: vi.fn(async (options: Record<string, unknown>, tracking: Record<string, unknown>) => {
    generateCalls.push({ options, tracking });
    return { text: nextAnswer, usage: { inputTokens: 11, outputTokens: 3 } };
  }),
}));

const getModelForPurpose = vi.fn();
const createProviderModel = vi.fn((cfg: { id: string }) => ({ modelId: cfg.id }));
vi.mock("../services/llm-config.service.js", () => ({
  getModelForPurpose: (purpose: string) => getModelForPurpose(purpose),
  createProviderModel: (cfg: { id: string }) => createProviderModel(cfg),
}));

const settings = { enabled: true, resolution: 1536, maxFollowUps: 3 };
vi.mock("../services/generation-settings.service.js", () => ({
  isZoomFollowUpEnabled: vi.fn(async () => settings.enabled),
  getZoomResolution: vi.fn(async () => settings.resolution),
  getZoomMaxFollowUps: vi.fn(async () => settings.maxFollowUps),
}));

vi.mock("../utils/resource-limits.js", () => ({
  getLlmSemaphore: () => ({ run: <T>(fn: () => Promise<T>) => fn() }),
}));

import {
  resolveUncertainItems,
  runZoomFollowUp,
  type HighResRenderResult,
} from "../services/visual-eval-zoom.service.js";
import type { LlmModelConfig } from "../services/llm-config.service.js";
import type { ChecklistResult } from "../services/visual-eval-parser.service.js";

function cfg(overrides: Partial<LlmModelConfig> = {}): LlmModelConfig {
  return {
    id: "judge-under-test", provider: "vllm-dgx-14", providerType: "openai-compatible",
    modelName: "glm-5.3-flash", displayName: "glm", label: "vllm-dgx-14/glm-5.3-flash",
    costPer1mInput: 0, costPer1mOutput: 0, maxOutputTokens: null, maxContextTokens: null,
    supportsThinking: true, thinkingEffort: "off", supportsVision: true, supportsEmbeddings: false,
    streamingEnabled: true, vlmEvalPreamble: null, endpointUrl: "http://vllm.local/v1", apiKey: null,
    maxConcurrent: null,
    ...overrides,
  };
}
const productionJudge = cfg({
  id: "production-judge", provider: "anthropic", providerType: null,
  modelName: "claude-sonnet-4-6", label: "anthropic/claude-sonnet-4-6",
});

const checklist: ChecklistResult[] = [
  { question: "Does it have two arms?", pass: true, detail: "yes" },
  { question: "Is the top hole open?", pass: null, detail: "cannot resolve" },
  { question: "Is the pin centred?", pass: false, detail: "off-centre" },
  { question: "Is the bottom flat?", pass: null, detail: "cannot resolve" },
];

// Only the by-angle lookup is read by the follow-up; the raw image list is not.
const highRes: HighResRenderResult = {
  images: [],
  byAngle: new Map([["top", "IMG-top"], ["bottom", "IMG-bottom"], ["ortho_45", "IMG-ortho_45"]]),
};

beforeEach(() => {
  renderCalls.length = 0;
  generateCalls.length = 0;
  getModelForPurpose.mockReset();
  getModelForPurpose.mockResolvedValue(productionJudge);
  createProviderModel.mockClear();
  settings.enabled = true;
  settings.resolution = 1536;
  settings.maxFollowUps = 3;
  nextAnswer = '{"pass": true, "detail": "resolved at 2x"}';
});

// ── resolveUncertainItems ────────────────────────────────────────────

describe("resolveUncertainItems", () => {
  it("answers follow-ups with the judge it is given, never the production vlm_eval judge", async () => {
    const judge = cfg();
    await resolveUncertainItems(checklist, highRes, 3, undefined, judge);
    expect(getModelForPurpose).not.toHaveBeenCalled();
    expect(createProviderModel).toHaveBeenCalledWith(judge);
    expect(generateCalls).toHaveLength(2);
    for (const { tracking } of generateCalls) {
      expect(tracking.modelId).toBe("judge-under-test");
      expect(tracking.providerName).toBe("vllm-dgx-14");
    }
  });

  it("falls back to the production vlm_eval judge when no judge is given", async () => {
    await resolveUncertainItems(checklist, highRes, 3);
    expect(getModelForPurpose).toHaveBeenCalledWith("vlm_eval");
    expect(createProviderModel).toHaveBeenCalledWith(productionJudge);
    expect(generateCalls[0].tracking.modelId).toBe("production-judge");
  });

  it("replaces only the uncertain items and marks them as zoom-resolved", async () => {
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(result.followUpCount).toBe(2);
    expect(result.resolvedChecklist[0]).toEqual(checklist[0]);
    expect(result.resolvedChecklist[2]).toEqual(checklist[2]);
    expect(result.resolvedChecklist[1]).toEqual({
      question: "Is the top hole open?", pass: true, detail: "[2x zoom] resolved at 2x",
    });
    expect(result.resolvedChecklist[3].pass).toBe(true);
    expect(result.promptTokens).toBe(22);
    expect(result.completionTokens).toBe(6);
  });

  it("stops at the follow-up cap and leaves the rest uncertain", async () => {
    const result = await resolveUncertainItems(checklist, highRes, 1, undefined, cfg());
    expect(result.followUpCount).toBe(1);
    expect(result.resolvedChecklist[1].pass).toBe(true);
    expect(result.resolvedChecklist[3].pass).toBeNull();
  });

  it("sends one high-res image per follow-up, picked by the question's wording", async () => {
    await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    const imagesSent = generateCalls.map(({ options }) => {
      const msgs = options.messages as Array<{ content: Array<{ type: string; image?: string }> }>;
      return msgs[0].content.filter((p) => p.type === "image").map((p) => p.image);
    });
    expect(imagesSent).toEqual([["IMG-top"], ["IMG-bottom"]]);
  });
});

// ── runZoomFollowUp: the production sequence behind the settings ─────

describe("runZoomFollowUp", () => {
  const args = {
    checklist, stlBase64: "U1RM", modelFormat: "stl" as const,
    constructionSpec: "spec", vlmConfig: cfg(),
  };

  it("returns null and renders nothing when the follow-up is disabled", async () => {
    settings.enabled = false;
    expect(await runZoomFollowUp(args)).toBeNull();
    expect(renderCalls).toHaveLength(0);
    expect(generateCalls).toHaveLength(0);
  });

  it("returns null and renders nothing when no item is uncertain", async () => {
    const certain = checklist.filter((c) => c.pass !== null);
    expect(await runZoomFollowUp({ ...args, checklist: certain })).toBeNull();
    expect(renderCalls).toHaveLength(0);
  });

  it("renders the high-res set at the configured resolution from the STL it is given", async () => {
    settings.resolution = 1280;
    await runZoomFollowUp(args);
    expect(renderCalls).toHaveLength(1);
    expect(renderCalls[0]).toMatchObject({ modelData: "U1RM", format: "stl", width: 1280, height: 1280 });
  });

  it("resolves up to the configured number of follow-ups with the given judge", async () => {
    settings.maxFollowUps = 1;
    const result = await runZoomFollowUp(args);
    expect(result?.followUpCount).toBe(1);
    expect(result?.resolvedChecklist[3].pass).toBeNull();
    expect(getModelForPurpose).not.toHaveBeenCalled();
    expect(generateCalls[0].tracking.modelId).toBe("judge-under-test");
  });
});
