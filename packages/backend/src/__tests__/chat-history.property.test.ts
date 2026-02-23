// Feature: ux-gaps-conversational-experience, Property 18: Immutable chat history — new generations preserve previous items
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 11.2, 23.1, 23.6
 *
 * Property 18: For any follow-up prompt or regeneration in a chat context,
 * the operation should create exactly one new assistant item, and all
 * previously existing assistant items should remain unchanged (same id,
 * same messages, same files).
 */

// --- Mocks for all external dependencies used by submitQuery ---

vi.mock("../db/connection.js", () => ({
  query: vi.fn(),
}));

vi.mock("../services/notification.service.js", () => ({
  notificationService: { publishToUser: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/sse.service.js", () => ({
  sseService: {
    publishStreamToken: vi.fn(),
    publish: vi.fn(),
  },
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
  ChatError: class ChatError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
      super(message);
    }
  },
}));

vi.mock("../services/file-storage.service.js", () => ({
  writeUserFile: vi.fn().mockResolvedValue(undefined),
  readUserFile: vi.fn(),
  FileStorageError: class FileStorageError extends Error {
    constructor(message: string, public readonly statusCode = 500) {
      super(message);
    }
  },
}));

const mockGenerateConversationText = vi.fn();
const mockGenerateBuild123dCode = vi.fn();

vi.mock("../services/llm.service.js", () => ({
  generateConversationText: (...args: unknown[]) => mockGenerateConversationText(...args),
  generateConversationTextStream: vi.fn(),
  generateBuild123dCode: (...args: unknown[]) => mockGenerateBuild123dCode(...args),
  parseConversationResponse: (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[CODEGEN_NEEDED]")) {
      return { needsCodegen: true, text: trimmed.slice("[CODEGEN_NEEDED]".length).trim() };
    }
    if (trimmed.startsWith("[CHAT_ONLY]")) {
      return { needsCodegen: false, text: trimmed.slice("[CHAT_ONLY]".length).trim() };
    }
    return { needsCodegen: false, text: trimmed };
  },
  LlmServiceError: class LlmServiceError extends Error {
    constructor(message: string, public readonly statusCode = 500) {
      super(message);
    }
  },
}));

const mockRenderBuild123d = vi.fn();

vi.mock("../services/rendering.service.js", () => {
  class RenderingServiceError extends Error {
    constructor(message: string, public readonly statusCode = 502) {
      super(message);
    }
  }
  return {
    renderBuild123d: (...args: unknown[]) => mockRenderBuild123d(...args),
    RenderingServiceError,
  };
});

// Import after mocks are set up
import { submitQuery } from "../services/query.service.js";
import { query as dbQuery } from "../db/connection.js";

// --- Helpers ---

function mockConversationResult() {
  return {
    text: "[CODEGEN_NEEDED]\nHere is your model.",
    model: { id: "mock-conv", provider: "mock", stage: "conversation", modelName: "mock" },
    usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
  };
}

function mockCodegenResult(code: string) {
  return {
    code,
    baseFileName: "model",
    model: { id: "mock-codegen", provider: "mock", stage: "codegen", modelName: "mock" },
    usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
  };
}

function mockRenderResult() {
  return {
    files: [{ filename: "model.step", contentBase64: "bW9jaw==" }],
    renderer: "mock" as const,
  };
}

/**
 * Stub the DB queries:
 * - ensureOwnedContext: returns a valid context row
 * - buildConversationContext: returns existing items as history rows
 */
function stubDb(existingItems: Array<{ id: string; role: string; messages: unknown }>) {
  vi.mocked(dbQuery).mockImplementation((_sql: string, _params?: unknown[]) => {
    const sql = _sql as string;

    // ensureOwnedContext query
    if (sql.includes("FROM chat_contexts")) {
      return Promise.resolve({
        rows: [{ id: "ctx-1", name: "Test Context", owner_id: "user-1" }],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      }) as ReturnType<typeof dbQuery>;
    }

    // buildConversationContext query — return existing items
    if (sql.includes("FROM chat_items") && sql.includes("ORDER BY created_at DESC")) {
      return Promise.resolve({
        rows: [...existingItems].reverse().map((item) => ({
          id: item.id,
          role: item.role,
          messages: item.messages,
          created_at: new Date().toISOString(),
        })),
        command: "SELECT",
        rowCount: existingItems.length,
        oid: 0,
        fields: [],
      }) as ReturnType<typeof dbQuery>;
    }

    // Default fallback
    return Promise.resolve({
      rows: [],
      command: "SELECT",
      rowCount: 0,
      oid: 0,
      fields: [],
    }) as ReturnType<typeof dbQuery>;
  });
}

function resetMocks() {
  mockGenerateConversationText.mockReset();
  mockGenerateBuild123dCode.mockReset();
  mockRenderBuild123d.mockReset();
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
  it("creates exactly one new assistant item and never updates previous items", () => {
    return fc.assert(
      fc.asyncProperty(
        existingItemsArb,
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (existingItems, prompt) => {
          resetMocks();
          stubDb(existingItems);

          mockGenerateConversationText.mockResolvedValue(mockConversationResult());
          mockGenerateBuild123dCode.mockResolvedValue(mockCodegenResult("Box(1,1,1)"));
          mockRenderBuild123d.mockResolvedValue(mockRenderResult());

          const previousItemIds = new Set(existingItems.map((item) => item.id));

          await submitQuery({
            userId: "user-1",
            contextId: "ctx-1",
            prompt,
          });

          // createChatItem should be called exactly twice: once for user item, once for assistant item
          expect(createChatItemCalls.length).toBe(2);

          const userCreate = createChatItemCalls[0];
          const assistantCreate = createChatItemCalls[1];

          expect((userCreate.args as { role: string }).role).toBe("user");
          expect((assistantCreate.args as { role: string }).role).toBe("assistant");

          // The new assistant item ID should NOT be in the set of previous items
          const newAssistantId = (assistantCreate.returnValue as { id: string }).id;
          expect(previousItemIds.has(newAssistantId)).toBe(false);

          // updateChatItem should only be called for the NEW assistant item, never for previous items
          for (const call of updateChatItemCalls) {
            const updatedId = (call.args as { itemId: string }).itemId;
            expect(previousItemIds.has(updatedId)).toBe(false);
            expect(updatedId).toBe(newAssistantId);
          }

          // updateChatItem should be called exactly once (to finalize the new assistant item)
          expect(updateChatItemCalls.length).toBe(1);
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

          mockGenerateConversationText.mockResolvedValue(mockConversationResult());
          mockGenerateBuild123dCode.mockResolvedValue(mockCodegenResult("Cylinder(5,10)"));
          mockRenderBuild123d.mockResolvedValue(mockRenderResult());

          const previousItemIds = new Set(existingItems.map((item) => item.id));

          const result = await submitQuery({
            userId: "user-1",
            contextId: "ctx-1",
            prompt,
          });

          // The returned assistant item ID must not collide with any previous item
          expect(previousItemIds.has(result.assistantItem.id)).toBe(false);

          // All previous items remain untouched — no updateChatItem call targets them
          for (const call of updateChatItemCalls) {
            const updatedId = (call.args as { itemId: string }).itemId;
            expect(previousItemIds.has(updatedId)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
