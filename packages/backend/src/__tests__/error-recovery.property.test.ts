// Feature: ux-gaps-conversational-experience, Property 14: Error recovery feeds error context to LLM with at most one retry
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 8.1, 8.2, 8.5
 *
 * Property 14: For any rendering failure, the Query_Service should invoke
 * the codegen LLM exactly once more with the error message and failing code
 * included in the prompt. If the retry also fails, no further retries should
 * occur and the error should be returned to the user.
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

vi.mock("../services/chat.service.js", () => ({
  createChatItem: vi.fn().mockResolvedValue({ id: "assistant-item-1" }),
  updateChatItem: vi.fn().mockResolvedValue({ id: "assistant-item-1" }),
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

// Mock LLM service — we control generateConversationText and generateBuild123dCode
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

// Mock rendering service — we control renderBuild123d
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
import { RenderingServiceError } from "../services/rendering.service.js";
import { query as dbQuery } from "../db/connection.js";

// Helper: build a mock codegen result
function mockCodegenResult(code: string) {
  return {
    code,
    baseFileName: "model",
    model: { id: "mock-codegen", provider: "mock", stage: "codegen", modelName: "mock" },
    usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
  };
}

// Helper: build a mock conversation result
function mockConversationResult() {
  return {
    text: "[CODEGEN_NEEDED]\nHere is your model.",
    model: { id: "mock-conv", provider: "mock", stage: "conversation", modelName: "mock" },
    usage: { source: "estimated", inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCostUsd: 0 },
  };
}

// Helper: build a mock render result
function mockRenderResult() {
  return {
    files: [{ filename: "model.step", contentBase64: "bW9jaw==" }],
    renderer: "mock" as const,
  };
}

// Stub the DB query used by ensureOwnedContext
function stubDbContext() {
  vi.mocked(dbQuery).mockResolvedValue({
    rows: [{ id: "ctx-1", name: "Test Context", owner_id: "user-1" }],
    command: "SELECT",
    rowCount: 1,
    oid: 0,
    fields: [],
  });
}

// Reset all mock call counts and implementations between property iterations
function resetMocks() {
  mockGenerateConversationText.mockReset();
  mockGenerateBuild123dCode.mockReset();
  mockRenderBuild123d.mockReset();
}


describe("Error recovery feeds error context to LLM with at most one retry", () => {
  it("retries exactly once with error context when first render fails, then succeeds", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 500 }),
        async (errorMessage, failingCode) => {
          resetMocks();
          stubDbContext();

          mockGenerateConversationText.mockResolvedValue(mockConversationResult());

          // First codegen returns the failing code, second returns corrected code
          mockGenerateBuild123dCode
            .mockResolvedValueOnce(mockCodegenResult(failingCode))
            .mockResolvedValueOnce(mockCodegenResult("corrected_code()"));

          // First render fails with RenderingServiceError, second succeeds
          mockRenderBuild123d
            .mockRejectedValueOnce(new RenderingServiceError(errorMessage))
            .mockResolvedValueOnce(mockRenderResult());

          const result = await submitQuery({
            userId: "user-1",
            contextId: "ctx-1",
            prompt: "make a box",
          });

          // generateBuild123dCode called exactly twice (original + one retry)
          expect(mockGenerateBuild123dCode).toHaveBeenCalledTimes(2);

          // renderBuild123d called exactly twice (original + one retry)
          expect(mockRenderBuild123d).toHaveBeenCalledTimes(2);

          // The retry codegen call should include the error message and failing code
          const retryCallArgs = mockGenerateBuild123dCode.mock.calls[1][0] as {
            prompt: string;
            conversationText: string;
          };
          expect(retryCallArgs.conversationText).toContain(errorMessage);
          expect(retryCallArgs.conversationText).toContain(failingCode);
          expect(retryCallArgs.conversationText).toContain("Error Recovery");

          // Should complete successfully
          expect(result).toBeDefined();
          expect(result.contextId).toBe("ctx-1");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns error when both render attempts fail — no further retries", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (firstError, failingCode, secondError) => {
          resetMocks();
          stubDbContext();

          mockGenerateConversationText.mockResolvedValue(mockConversationResult());

          mockGenerateBuild123dCode
            .mockResolvedValueOnce(mockCodegenResult(failingCode))
            .mockResolvedValueOnce(mockCodegenResult("retry_code()"));

          // Both render attempts fail
          mockRenderBuild123d
            .mockRejectedValueOnce(new RenderingServiceError(firstError))
            .mockRejectedValueOnce(new RenderingServiceError(secondError));

          // submitQuery should throw (error propagates to outer catch)
          await expect(
            submitQuery({
              userId: "user-1",
              contextId: "ctx-1",
              prompt: "make a box",
            }),
          ).rejects.toThrow();

          // generateBuild123dCode called exactly twice (original + one retry)
          expect(mockGenerateBuild123dCode).toHaveBeenCalledTimes(2);

          // renderBuild123d called exactly twice — no third attempt
          expect(mockRenderBuild123d).toHaveBeenCalledTimes(2);

          // The retry codegen call should include the first error and failing code
          const retryCallArgs = mockGenerateBuild123dCode.mock.calls[1][0] as {
            prompt: string;
            conversationText: string;
          };
          expect(retryCallArgs.conversationText).toContain(firstError);
          expect(retryCallArgs.conversationText).toContain(failingCode);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not retry for non-RenderingServiceError failures", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (errorMessage) => {
          resetMocks();
          stubDbContext();

          mockGenerateConversationText.mockResolvedValue(mockConversationResult());
          mockGenerateBuild123dCode.mockResolvedValueOnce(mockCodegenResult("some_code()"));

          // Render throws a generic Error (not RenderingServiceError)
          mockRenderBuild123d.mockRejectedValueOnce(new Error(errorMessage));

          await expect(
            submitQuery({
              userId: "user-1",
              contextId: "ctx-1",
              prompt: "make a box",
            }),
          ).rejects.toThrow();

          // Only one codegen call — no retry for non-RenderingServiceError
          expect(mockGenerateBuild123dCode).toHaveBeenCalledTimes(1);

          // Only one render attempt — no retry
          expect(mockRenderBuild123d).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
