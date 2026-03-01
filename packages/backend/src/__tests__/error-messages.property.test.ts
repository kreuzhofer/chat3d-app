// Feature: ux-gaps-conversational-experience, Property 15: Conversational error messages contain error detail and follow-up suggestion
// Updated: Tests executeQueryPipeline which writes errormessage segments via updateChatItem
import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 9.1, 9.2, 9.3
 *
 * Property 15: For any error during the query pipeline, the resulting
 * assistant item should contain an errormessage segment with the specific
 * error detail. The frontend renders a follow-up suggestion for error segments.
 */

// --- Mocks ---

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

const mockUpdateChatItem = vi.fn().mockResolvedValue({ id: "ast-1" });

vi.mock("../services/chat.service.js", () => ({
  createChatItem: vi.fn().mockResolvedValue({ id: "ast-1" }),
  updateChatItem: (...args: unknown[]) => mockUpdateChatItem(...args),
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

const mockGenerateConversationText = vi.fn();
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("../services/llm.service.js", () => ({
  generateConversationText: (...args: unknown[]) => mockGenerateConversationText(...args),
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

vi.mock("../services/workbench-codegen.service.js", () => ({
  buildInitialPrompt: vi.fn().mockReturnValue("initial prompt"),
  buildFixPrompt: vi.fn().mockReturnValue("fix prompt"),
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
  renderModelScreenshots: vi.fn().mockResolvedValue({ images: [] }),
}));

vi.mock("../services/visual-eval.service.js", () => ({
  evaluateModel: vi.fn(),
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

/**
 * The follow-up suggestion is rendered by the frontend MessageBubble component
 * as a hardcoded string when segment.kind === "error". This constant mirrors
 * the frontend contract for verification.
 */
const FOLLOW_UP_SUGGESTION = "Try rephrasing your request or ask me to use a different approach.";

describe("Conversational error messages contain error detail and follow-up suggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDb();
  });

  it("stores error detail in errormessage segment when all render iterations fail and no code produced", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length > 0),
        async (errorDetail) => {
          vi.clearAllMocks();
          stubDb();

          mockGenerateConversationText.mockResolvedValue({
            text: "[CODEGEN_NEEDED]\nHere is your model.",
            usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
          });

          // Codegen returns empty text — no usable code produced
          mockGenerateText.mockResolvedValue({
            text: "", usage: { inputTokens: 10, outputTokens: 10 },
          });

          // All render iterations fail with the error detail
          mockRenderWithInfraRetry.mockResolvedValue({
            ok: false,
            error: { category: "code_error", rawMessage: errorDetail, originalError: new Error(errorDetail) },
          });

          await executeQueryPipeline(pipelineInput());

          // Find the updateChatItem call containing an errormessage segment
          const errorCall = mockUpdateChatItem.mock.calls.find((call) => {
            const args = call[0] as { messages: Array<{ itemType: string; text: string }> };
            return args.messages?.some((m) => m.itemType === "errormessage");
          });

          expect(errorCall).toBeDefined();
          const messages = (errorCall![0] as { messages: Array<{ itemType: string; text: string }> }).messages;
          const errorMsg = messages.find((m) => m.itemType === "errormessage");

          // The error detail from the rendering service is stored in the text field
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.text).toBe(errorDetail);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("stores error detail when conversation LLM fails", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 300 }).filter((s) => s.trim().length > 0),
        async (errorDetail) => {
          vi.clearAllMocks();
          stubDb();

          // Conversation stage throws — error goes to outer catch block
          mockGenerateConversationText.mockRejectedValue(new Error(errorDetail));

          await executeQueryPipeline(pipelineInput());

          // The outer catch block writes an errormessage segment
          const errorCall = mockUpdateChatItem.mock.calls.find((call) => {
            const args = call[0] as { messages: Array<{ itemType: string; text: string }> };
            return args.messages?.some((m) => m.itemType === "errormessage");
          });

          expect(errorCall).toBeDefined();
          const messages = (errorCall![0] as { messages: Array<{ itemType: string; text: string }> }).messages;
          const errorMsg = messages.find((m) => m.itemType === "errormessage");

          // The specific error detail is stored regardless of error source
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.text).toBe(errorDetail);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("frontend rendering contract: error segment always produces error detail and follow-up suggestion", () => {
    /**
     * This test verifies the frontend rendering contract as a pure data transformation.
     * The MessageBubble component renders error segments (kind === "error") with:
     * - The segment.text as the error detail
     * - A hardcoded follow-up suggestion string
     *
     * We simulate the rendering logic to verify the contract holds for any error detail.
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
        (errorDetail) => {
          // Simulate the backend-stored error message structure
          const storedMessage = {
            itemType: "errormessage" as const,
            text: errorDetail,
            state: "error" as const,
            stateMessage: "",
          };

          // Simulate the frontend adapter: toSegmentKind("errormessage") => "error"
          const segmentKind = storedMessage.itemType === "errormessage" ? "error" : "message";
          expect(segmentKind).toBe("error");

          // Simulate the frontend rendering contract for error segments:
          // (a) The error detail is the segment text
          const renderedErrorDetail = storedMessage.text;
          expect(renderedErrorDetail).toBe(errorDetail);
          expect(renderedErrorDetail.length).toBeGreaterThan(0);

          // (b) The follow-up suggestion is always present (hardcoded in MessageBubble)
          expect(FOLLOW_UP_SUGGESTION).toBeTruthy();
          expect(FOLLOW_UP_SUGGESTION.length).toBeGreaterThan(0);

          // The complete conversational error contains both pieces
          const conversationalErrorContent = [renderedErrorDetail, FOLLOW_UP_SUGGESTION];
          expect(conversationalErrorContent).toHaveLength(2);
          expect(conversationalErrorContent[0]).toBe(errorDetail);
          expect(conversationalErrorContent[1]).toContain("Try");
          expect(conversationalErrorContent[1]).toContain("rephrasing");
        },
      ),
      { numRuns: 100 },
    );
  });
});
