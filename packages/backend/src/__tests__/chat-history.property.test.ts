// Feature: ux-gaps-conversational-experience, Property 18: Immutable chat history — new generations preserve previous items
// Updated: Tests initiateQuery + executeQueryPipeline (the two-step async pattern)
import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 11.2, 23.1, 23.6
 *
 * Property 18: For any follow-up prompt, initiateQuery creates exactly one new
 * user item and one new assistant item. executeQueryPipeline only updates the
 * new assistant item. All previously existing assistant items remain unchanged.
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

// Track all createChatItem and updateChatItem calls with their arguments
const createChatItemCalls: Array<{ args: unknown; returnValue: unknown }> = [];
const updateChatItemCalls: Array<{ args: unknown; returnValue: unknown }> = [];

let createCallCounter = 0;

vi.mock("../services/chat.service.js", () => ({
  createChatItem: vi.fn().mockImplementation((args: unknown) => {
    const id = `item-${++createCallCounter}`;
    const result = { id, messages: (args as { messages: unknown }).messages };
    createChatItemCalls.push({ args, returnValue: result });
    return Promise.resolve(result);
  }),
  updateChatItem: vi.fn().mockImplementation((args: unknown) => {
    const typedArgs = args as { itemId: string; messages: unknown };
    const result = { id: typedArgs.itemId, messages: typedArgs.messages };
    updateChatItemCalls.push({ args, returnValue: result });
    return Promise.resolve(result);
  }),
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

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    text: "Box(1,1,1)", usage: { inputTokens: 10, outputTokens: 10 },
  }),
}));

vi.mock("../services/llm.service.js", () => ({
  generateConversationText: vi.fn().mockResolvedValue({
    text: "[CODEGEN_NEEDED]\nHere is your model.",
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

vi.mock("../utils/render-errors.js", () => ({
  classifyRenderError: vi.fn(),
  buildEscalatedGuidance: vi.fn().mockReturnValue(""),
  renderWithInfraRetry: vi.fn().mockResolvedValue({
    ok: true,
    result: { files: [{ filename: "m.stl", contentBase64: "bW9jaw==" }] },
  }),
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

vi.mock("../prompts/system-prompts.js", () => ({
  CODEGEN_SYSTEM_PROMPT: "sys",
  CONVERSATION_SYSTEM_PROMPT: "conversation-sys",
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
import { initiateQuery, executeQueryPipeline } from "../services/query.service.js";
import { prisma } from "../db/prisma.js";

const mockPrisma = vi.mocked(prisma);

// --- Helpers ---

function stubDb(existingItems: Array<{ id: string; role: string; messages: unknown }>) {
  // ensureOwnedContext → prisma.chatContext.findFirst
  vi.mocked(mockPrisma.chatContext.findFirst).mockResolvedValue(
    { id: "ctx-1", name: "Test" } as never,
  );

  // initiateQuery item count → prisma.chatItem.count
  vi.mocked(mockPrisma.chatItem.count).mockResolvedValue(existingItems.length);

  // buildConversationContext → prisma.chatItem.findMany
  // Prisma returns rows ordered by createdAt DESC; the service then reverses them.
  // Return items in reverse order (DESC) with createdAt as Date objects.
  vi.mocked(mockPrisma.chatItem.findMany).mockResolvedValue(
    [...existingItems].reverse().map((item) => ({
      ...item,
      createdAt: new Date(),
    })) as never,
  );
}

function resetMocks() {
  vi.clearAllMocks();
  createChatItemCalls.length = 0;
  updateChatItemCalls.length = 0;
  createCallCounter = 0;
}

// Arbitrary for generating previous assistant items
const existingAssistantItemArb = fc.record({
  id: fc.uuid(),
  messages: fc.array(
    fc.record({
      itemType: fc.constantFrom("message", "3dmodel", "meta"),
      text: fc.string({ minLength: 1, maxLength: 100 }),
      state: fc.constant("completed"),
      stateMessage: fc.constant(""),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

// Generate a list of 1–5 previous assistant items in the context
const existingItemsArb = fc.array(existingAssistantItemArb, { minLength: 1, maxLength: 5 }).map((items) =>
  items.map((item) => ({
    ...item,
    role: "assistant" as const,
  })),
);

describe("Immutable chat history — new generations preserve previous items", () => {
  it("initiateQuery creates exactly one user and one assistant item", () => {
    return fc.assert(
      fc.asyncProperty(
        existingItemsArb,
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (existingItems, prompt) => {
          resetMocks();
          stubDb(existingItems);

          const result = await initiateQuery({
            userId: "u-1",
            contextId: "ctx-1",
            prompt,
          });

          // Exactly two items created: user + assistant
          expect(createChatItemCalls.length).toBe(2);
          expect((createChatItemCalls[0].args as { role: string }).role).toBe("user");
          expect((createChatItemCalls[1].args as { role: string }).role).toBe("assistant");

          // No updates during initiation
          expect(updateChatItemCalls.length).toBe(0);

          // Returned IDs are from the new items
          expect(result.userItem.id).toBeDefined();
          expect(result.assistantItem.id).toBeDefined();
          expect(result.userItem.id).not.toBe(result.assistantItem.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("executeQueryPipeline only updates the specified assistant item, never previous items", () => {
    return fc.assert(
      fc.asyncProperty(
        existingItemsArb,
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (existingItems, prompt) => {
          resetMocks();
          stubDb(existingItems);

          const previousItemIds = new Set(existingItems.map((i) => i.id));
          const newAssistantId = "new-assistant-id";

          await executeQueryPipeline({
            userId: "u-1",
            contextId: "ctx-1",
            prompt,
            attachments: [],
            context: { id: "ctx-1", name: "Test" },
            userItemId: "new-user-id",
            assistantItemId: newAssistantId,
            stream: false,
            isFirstPrompt: false,
          });

          // All updateChatItem calls target only the new assistant item
          for (const call of updateChatItemCalls) {
            const updatedId = (call.args as { itemId: string }).itemId;
            expect(previousItemIds.has(updatedId)).toBe(false);
            expect(updatedId).toBe(newAssistantId);
          }

          // Should have at least one update (the final result)
          expect(updateChatItemCalls.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("new assistant item has distinct ID from all previous items", () => {
    return fc.assert(
      fc.asyncProperty(
        existingItemsArb,
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (existingItems, prompt) => {
          resetMocks();
          stubDb(existingItems);

          const previousItemIds = new Set(existingItems.map((i) => i.id));

          const result = await initiateQuery({
            userId: "u-1",
            contextId: "ctx-1",
            prompt,
          });

          // The new item IDs must not collide with any previous items
          expect(previousItemIds.has(result.assistantItem.id)).toBe(false);
          expect(previousItemIds.has(result.userItem.id)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
