import { describe, expect, it } from "vitest";
import { adaptChatItem } from "../features/chat/chat-adapters";
import type { ChatItem } from "../api/chat.api";

describe("chat adapters", () => {
  it("maps backend item payloads to stable timeline view models", () => {
    const item: ChatItem = {
      id: "item-1",
      chatContextId: "ctx-1",
      role: "assistant",
      ownerId: "user-1",
      rating: 0,
      createdAt: "2026-02-18T00:00:00.000Z",
      updatedAt: "2026-02-18T00:00:00.000Z",
      messages: [
        {
          id: "msg-1",
          itemType: "message",
          text: "Hello",
          state: "completed",
          stateMessage: "",
        },
        {
          id: "msg-2",
          itemType: "meta",
          text: "Generated files",
          state: "completed",
          files: [{ path: "modelcreator/a.step", filename: "a.step" }],
        },
      ],
    };

    const adapted = adaptChatItem(item);

    expect(adapted.id).toBe("item-1");
    expect(adapted.segments).toHaveLength(2);
    expect(adapted.segments[0].kind).toBe("message");
    expect(adapted.segments[1].kind).toBe("meta");
    expect(adapted.segments[1].files[0]?.filename).toBe("a.step");
  });
});
