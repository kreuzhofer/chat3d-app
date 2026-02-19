import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChatContext,
  createChatItem,
  deleteChatContext,
  listChatContexts,
  listChatItems,
  updateChatContext,
  updateChatItem,
} from "../api/chat.api";

describe("chat api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("lists contexts and items", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ contexts: [{ id: "ctx1", name: "A" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: "item1", role: "user" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const contexts = await listChatContexts("token-1");
    const items = await listChatItems("token-1", "ctx1");

    expect(contexts[0].id).toBe("ctx1");
    expect(items[0].id).toBe("item1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/chat/contexts",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/chat/contexts/ctx1/items",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("creates, updates and deletes resources using expected methods", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ctx2", name: "B" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "item2", role: "user", rating: 0 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ctx2", name: "Renamed Context" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "item2", role: "user", rating: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await createChatContext("token-2", "B");
    await createChatItem({
      token: "token-2",
      contextId: "ctx2",
      role: "user",
      messages: [{ text: "hi" }],
    });
    await updateChatContext("token-2", "ctx2", {
      name: "Renamed Context",
      conversationModelId: "conversation-openai",
      chat3dModelId: "codegen-openai",
    });
    await updateChatItem({
      token: "token-2",
      contextId: "ctx2",
      itemId: "item2",
      rating: 1,
    });
    await deleteChatContext("token-2", "ctx2");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/chat/contexts",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/chat/contexts/ctx2",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/chat/contexts/ctx2/items/item2",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/chat/contexts/ctx2",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
