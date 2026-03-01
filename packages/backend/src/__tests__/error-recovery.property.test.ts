// Feature: ux-gaps-conversational-experience, Property 14: Error recovery feeds error context to LLM
// Updated: Tests the workbench-style iteration loop in executeQueryPipeline
import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 8.1, 8.2, 8.5
 *
 * Property 14: For any rendering failure during the codegen iteration loop,
 * the pipeline should retry with the error context included in the fix prompt.
 * The loop runs up to MAX_FIX_ITERATIONS (5) times.
 */

// --- Mocks for all external dependencies used by executeQueryPipeline ---

vi.mock("../db/prisma.js", () => ({
  prisma: {
    chatItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    chatContext: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../services/notification.service.js", () => ({
  notificationService: { publishToUser: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/sse.service.js", () => ({
  sseService: { publishStreamToken: vi.fn(), publish: vi.fn() },
}));

vi.mock("../services/chat.service.js", () => ({
  createChatItem: vi.fn().mockResolvedValue({ id: "ast-1" }),
  updateChatItem: vi.fn().mockResolvedValue({ id: "ast-1" }),
  updateChatContext: vi.fn().mockResolvedValue(undefined),
  ChatError: class extends Error {
    constructor(message: string, public readonly statusCode = 400) { super(message); }
  },
}));

vi.mock("../services/file-storage.service.js", () => ({
  writeStorageFile: vi.fn().mockResolvedValue(undefined),
  readStorageFile: vi.fn().mockResolvedValue(Buffer.from("")),
  FileStorageError: class extends Error {
    constructor(message: string, public readonly statusCode = 500) { super(message); }
  },
}));

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("../services/llm.service.js", () => ({
  generateConversationText: vi.fn().mockResolvedValue({
    text: "[CODEGEN_NEEDED]\nGenerating your model.",
    usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
  }),
  generateConversationTextStream: vi.fn(),
  parseConversationResponse: (raw: string) => {
    const t = raw.trim();
    if (t.startsWith("[CODEGEN_NEEDED]")) return { needsCodegen: true, text: t.slice("[CODEGEN_NEEDED]".length).trim() };
    return { needsCodegen: false, text: t };
  },
  extractExecutableCode: vi.fn().mockImplementation((t: string) => t),
  findMostRecentCode: () => undefined,
  formatConversationHistory: () => "",
  LlmServiceError: class extends Error {
    constructor(message: string, public readonly statusCode = 500) { super(message); }
  },
}));

vi.mock("../services/rendering.service.js", () => ({
  renderBuild123d: vi.fn(),
  RenderingServiceError: class extends Error {
    constructor(message: string, public readonly statusCode = 502) { super(message); }
  },
}));

const mockRenderWithInfraRetry = vi.fn();
vi.mock("../utils/render-errors.js", () => ({
  classifyRenderError: vi.fn(),
  buildEscalatedGuidance: vi.fn().mockReturnValue(""),
  renderWithInfraRetry: (...args: unknown[]) => mockRenderWithInfraRetry(...args),
}));

const mockBuildFixPrompt = vi.fn().mockReturnValue("fix prompt");
vi.mock("../services/workbench-codegen.service.js", () => ({
  buildInitialPrompt: vi.fn().mockReturnValue("initial prompt"),
  buildFixPrompt: (...args: unknown[]) => mockBuildFixPrompt(...args),
  buildModificationPrompt: vi.fn().mockReturnValue("mod prompt"),
  wrapInTemplate: vi.fn().mockImplementation((c: string) => c),
  stripTemplateBoilerplate: vi.fn().mockImplementation((c: string) => c),
  MAX_FIX_ITERATIONS: 5,
  AUTO_APPROVE_THRESHOLD: 7,
}));

vi.mock("../services/llm-config.service.js", () => ({
  getModelForPurpose: vi.fn().mockResolvedValue({
    label: "test", provider: "test", modelName: "test-v1", maxOutputTokens: 4000, maxConcurrent: 2,
  }),
  createProviderModel: vi.fn().mockReturnValue("mock-model"),
  buildGenerateOptions: vi.fn().mockReturnValue({}),
  calculateCostUsd: vi.fn().mockReturnValue(0.001),
}));

vi.mock("../services/workbench-seeder.service.js", () => ({
  getActiveSystemPrompt: vi.fn().mockResolvedValue({ content: "sys" }),
}));

vi.mock("../services/workbench-embeddings.service.js", () => ({
  findSimilarExamples: vi.fn().mockResolvedValue([]),
}));

vi.mock("../utils/resource-limits.js", () => ({
  getLlmSemaphore: vi.fn().mockReturnValue({
    run: vi.fn().mockImplementation((fn: () => unknown) => fn()),
  }),
}));

vi.mock("../utils/llm-retry.js", () => ({
  withLlmRetry: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

vi.mock("../services/stl-rendering-client.service.js", () => ({
  renderModelScreenshots: vi.fn().mockResolvedValue({
    images: [{ angle: "front", base64: "abc" }],
  }),
}));

vi.mock("../services/visual-eval.service.js", () => ({
  evaluateModel: vi.fn().mockResolvedValue({
    score: 9, issues: [], suggestions: [],
    vlmModel: "mock-vlm", promptTokens: 10, completionTokens: 10,
  }),
}));

vi.mock("../utils/llm-errors.js", () => ({
  ProviderQuotaExhaustedError: class extends Error {},
}));

// Import after mocks
import { executeQueryPipeline } from "../services/query.service.js";
import { prisma } from "../db/prisma.js";

const mockPrisma = vi.mocked(prisma);

function stubDb() {
  // buildConversationContext → prisma.chatItem.findMany
  vi.mocked(mockPrisma.chatItem.findMany).mockResolvedValue([]);
}

function makeRenderSuccess() {
  return { ok: true as const, result: { files: [{ filename: "m.stl", contentBase64: "bW9jaw==" }] } };
}

function makeRenderFailure(msg: string) {
  return { ok: false as const, error: { category: "code_error", rawMessage: msg, originalError: new Error(msg) } };
}

const pipelineInput = () => ({
  userId: "u-1",
  contextId: "ctx-1",
  prompt: "make a box",
  attachments: [] as never[],
  context: { id: "ctx-1", name: "Test" },
  userItemId: "ui-1",
  assistantItemId: "ai-1",
  stream: false,
  isFirstPrompt: false,
});

describe("Error recovery feeds error context to LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDb();
  });

  it("retries with error context when first render fails, then succeeds", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (errorMessage) => {
          vi.clearAllMocks();
          stubDb();

          mockGenerateText.mockResolvedValue({
            text: "some_code()", usage: { inputTokens: 10, outputTokens: 10 },
          });

          // First render fails, second succeeds
          mockRenderWithInfraRetry
            .mockResolvedValueOnce(makeRenderFailure(errorMessage))
            .mockResolvedValueOnce(makeRenderSuccess());

          await executeQueryPipeline(pipelineInput());

          // Two codegen iterations: initial + one retry after render failure
          expect(mockGenerateText).toHaveBeenCalledTimes(2);

          // buildFixPrompt called for the second iteration with error context
          expect(mockBuildFixPrompt).toHaveBeenCalledTimes(1);
          const fixArgs = mockBuildFixPrompt.mock.calls[0];
          // buildFixPrompt(systemPrompt, fewShots, prompt, currentCode, iterMinus1, renderError, issues, suggestions, renderErrorCtx)
          expect(fixArgs[5]).toBe(errorMessage); // renderError argument
        },
      ),
      { numRuns: 100 },
    );
  });

  it("stops after MAX_FIX_ITERATIONS when all renders fail — no further retries", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (errorMessage) => {
          vi.clearAllMocks();
          stubDb();

          mockGenerateText.mockResolvedValue({
            text: "code()", usage: { inputTokens: 10, outputTokens: 10 },
          });

          // All renders fail
          mockRenderWithInfraRetry.mockResolvedValue(makeRenderFailure(errorMessage));

          await executeQueryPipeline(pipelineInput());

          // Exactly MAX_FIX_ITERATIONS (5) codegen calls — no more
          expect(mockGenerateText).toHaveBeenCalledTimes(5);
          expect(mockRenderWithInfraRetry).toHaveBeenCalledTimes(5);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not retry codegen for non-rendering pipeline errors", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (errorMessage) => {
          vi.clearAllMocks();
          stubDb();

          // First codegen call throws (not a render error)
          mockGenerateText.mockRejectedValueOnce(new Error(errorMessage));

          await executeQueryPipeline(pipelineInput());

          // Only one codegen attempt — error propagates to outer catch
          expect(mockGenerateText).toHaveBeenCalledTimes(1);
          // renderWithInfraRetry never called since codegen itself failed
          expect(mockRenderWithInfraRetry).toHaveBeenCalledTimes(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
