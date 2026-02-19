import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLlmModels, regenerateQuery, submitQuery } from "../api/query.api";

describe("query api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("lists llm models", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ id: "conversation-mock-v1", provider: "mock", stage: "conversation", modelName: "mock" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const models = await listLlmModels("token-1");
    expect(models[0].id).toBe("conversation-mock-v1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/llm/models",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("submits query payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          contextId: "ctx1",
          userItemId: "item-user",
          assistantItem: { id: "item-assistant", chatContextId: "ctx1", role: "assistant", messages: [] },
          generatedFiles: [{ path: "modelcreator/item-assistant.step", filename: "cube.step" }],
          llm: { conversationModel: "conversation-mock-v1", codegenModel: "codegen-mock-v1" },
          renderer: "mock",
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await submitQuery({
      token: "token-1",
      contextId: "ctx1",
      prompt: "build cube",
    });

    expect(result.contextId).toBe("ctx1");
    expect(result.generatedFiles.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/submit",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("submits regenerate payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          contextId: "ctx1",
          userItemId: "item-user-2",
          assistantItem: { id: "item-assistant-2", chatContextId: "ctx1", role: "assistant", messages: [] },
          generatedFiles: [{ path: "modelcreator/item-assistant-2.step", filename: "cube.step" }],
          llm: { conversationModel: "conversation-mock-v1", codegenModel: "codegen-mock-v1" },
          renderer: "mock",
        }),
        {
          status: 202,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await regenerateQuery({
      token: "token-1",
      contextId: "ctx1",
      assistantItemId: "item-assistant",
    });

    expect(result.contextId).toBe("ctx1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/regenerate",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
