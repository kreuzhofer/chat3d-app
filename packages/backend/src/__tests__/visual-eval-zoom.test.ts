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
import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";

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
let nextThrow: unknown = null;
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedGenerateText: vi.fn(async (options: Record<string, unknown>, tracking: Record<string, unknown>) => {
    generateCalls.push({ options, tracking });
    if (nextThrow) { const e = nextThrow; nextThrow = null; throw e; }
    return { text: nextAnswer, usage: { inputTokens: 11, outputTokens: 3 } };
  }),
}));

const getModelForPurpose = vi.fn();
const createProviderModel = vi.fn((cfg: { id: string }) => ({ modelId: cfg.id }));
vi.mock("../services/llm-config.service.js", () => ({
  getModelForPurpose: (purpose: string) => getModelForPurpose(purpose),
  createProviderModel: (cfg: { id: string }) => createProviderModel(cfg),
  sdkType: (cfg: { providerType: string | null; provider: string }) => cfg.providerType ?? cfg.provider,
}));

const settings = { enabled: true, resolution: 1536, maxFollowUps: 3 };
vi.mock("../services/generation-settings.service.js", () => ({
  getZoomSettings: vi.fn(async () => ({
    enabled: settings.enabled, resolutionPx: settings.resolution, maxFollowUps: settings.maxFollowUps,
  })),
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
  nextThrow = null;
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
    // Never attempted: no follow-up outcome on the item (issue #61).
    expect(result.resolvedChecklist[3].zoomFollowUp).toBeUndefined();
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

// ── The follow-up under the main call's guards (issue #56) ───────────

describe("follow-up call guards", () => {
  it("asks at temperature 0 with the pass/detail schema as the reply's shape on vLLM and on Anthropic alike (issue #64)", async () => {
    const followUpShape = {
      type: "json",
      name: "follow_up",
      schema: {
        type: "object",
        properties: { pass: { type: "boolean" }, detail: { type: "string" } },
        required: ["pass", "detail"],
        additionalProperties: false,
      },
    };
    await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(generateCalls).toHaveLength(2);
    for (const { options } of generateCalls) {
      expect(options.temperature).toBe(0);
      expect(options.maxOutputTokens).toBe(512);
      const output = options.output as { responseFormat: Promise<Record<string, unknown>> } | undefined;
      expect(output).toBeDefined();
      expect(await output!.responseFormat).toEqual(followUpShape);
    }

    // Sonnet's free-text follow-up wrote prose and hit the cap 11 times in 53 on the 125 (#61);
    // the Anthropic path now gets the same shape, as native structured output or the SDK's JSON tool.
    generateCalls.length = 0;
    await resolveUncertainItems(checklist, highRes, 3, undefined, productionJudge);
    expect(generateCalls).toHaveLength(2);
    for (const { options } of generateCalls) {
      expect(options.temperature).toBe(0);
      const output = options.output as { responseFormat: Promise<Record<string, unknown>> } | undefined;
      expect(output).toBeDefined();
      expect(await output!.responseFormat).toEqual(followUpShape);
    }
  });

  it("records a reply that is prose around a JSON fragment as unreadable and keeps the item uncertain", async () => {
    // glm's reply on example 086dc6b0, item 3 (#50): the keyword fallback stored it as pass.
    nextAnswer = 'Looking closely, there are no mounting holes on the base plate.\n{ "pass": false, "detail": "no mounting holes visible';
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    // The item keeps its first-pass answer and detail, and the row says the follow-up could not be read (#61).
    expect(result.resolvedChecklist[1]).toEqual({ ...checklist[1], zoomFollowUp: "unreadable" });
    expect(result.resolvedChecklist[3]).toEqual({ ...checklist[3], zoomFollowUp: "unreadable" });
    expect(result.followUpCount).toBe(2);
    expect(result.followUpDetails).toHaveLength(2);
    expect(result.followUpDetails[0]).toMatchObject({ question: checklist[1].question, angle: "top", pass: null });
    expect(result.followUpDetails[0].detail).toMatch(/could not be read/);
    expect(result.promptTokens).toBe(22);
  });

  it("marks an item whose follow-up call threw as failed and keeps it uncertain", async () => {
    nextThrow = new Error("connection reset");
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(result.resolvedChecklist[1]).toEqual({ ...checklist[1], zoomFollowUp: "failed" });
    expect(result.resolvedChecklist[0]).toEqual(checklist[0]);
    // The mock throws once; the next uncertain item is answered as usual.
    expect(result.resolvedChecklist[3].pass).toBe(true);
    expect(result.followUpCount).toBe(1);
  });

  it("does not read a non-boolean pass as fail: the item stays uncertain", async () => {
    nextAnswer = '{"pass": "false", "detail": "the hole is closed"}';
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(result.resolvedChecklist[1].pass).toBeNull();
    expect(result.followUpDetails[0].pass).toBeNull();
  });

  it("records the SDK's own rejection of a guided reply as unreadable, with the reply, and keeps the item uncertain", async () => {
    // Seen once on qwen (#56 run): the guided reply reached the SDK's output parser and was rejected there.
    nextThrow = new NoObjectGeneratedError({
      message: "No object generated: could not parse the response.",
      cause: new Error("Unexpected token"),
      text: "bare-word-reply",
      response: { id: "r", timestamp: new Date(), modelId: "m" },
      usage: { inputTokens: 11, outputTokens: 1, totalTokens: 12 } as unknown as LanguageModelUsage,
      finishReason: "stop",
    });
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(result.resolvedChecklist[1]).toEqual({ ...checklist[1], zoomFollowUp: "unreadable" });
    expect(result.followUpDetails[0]).toMatchObject({ pass: null, angle: "top" });
    expect(result.followUpDetails[0].detail).toMatch(/could not be read/);
    expect(result.followUpDetails[0].detail).toContain("bare-word-reply");
    expect(result.followUpCount).toBe(2);
    expect(result.promptTokens).toBe(22);
    expect(result.resolvedChecklist[3].pass).toBe(true);
  });

  it('stores {"pass": false} as a fail, fenced or bare', async () => {
    nextAnswer = '```json\n{"pass": false, "detail": "no mounting holes on the base"}\n```';
    const result = await resolveUncertainItems(checklist, highRes, 3, undefined, cfg());
    expect(result.resolvedChecklist[1]).toEqual({
      question: "Is the top hole open?", pass: false, detail: "[2x zoom] no mounting holes on the base",
    });
    expect(result.followUpDetails[0]).toMatchObject({ pass: false, angle: "top" });
  });
});
