// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "../components/ChatPage";

const authState = {
  token: "test-token",
};

const notificationsState = {
  notifications: [] as Array<{
    id: number;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>,
  connectionState: "open" as const,
  refreshReplay: vi.fn().mockResolvedValue(undefined),
};

const listChatContextsMock = vi.fn();
const listChatItemsMock = vi.fn();
const createChatContextMock = vi.fn();
const updateChatContextMock = vi.fn();
const deleteChatContextMock = vi.fn();
const listLlmModelsMock = vi.fn();
const submitQueryMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../contexts/NotificationsContext", () => ({
  useNotifications: () => notificationsState,
}));

vi.mock("../api/chat.api", () => ({
  listChatContexts: (...args: unknown[]) => listChatContextsMock(...args),
  listChatItems: (...args: unknown[]) => listChatItemsMock(...args),
  createChatContext: (...args: unknown[]) => createChatContextMock(...args),
  updateChatContext: (...args: unknown[]) => updateChatContextMock(...args),
  deleteChatContext: (...args: unknown[]) => deleteChatContextMock(...args),
}));

vi.mock("../api/query.api", () => ({
  listLlmModels: (...args: unknown[]) => listLlmModelsMock(...args),
  submitQuery: (...args: unknown[]) => submitQueryMock(...args),
}));

function renderChatPage(initialPath = "/chat/ctx-1") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/new" element={<ChatPage />} />
        <Route path="/chat/:contextId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("chat page route flows", () => {
  beforeEach(() => {
    notificationsState.notifications = [];
    notificationsState.refreshReplay.mockClear();

    listChatContextsMock.mockReset();
    listChatItemsMock.mockReset();
    createChatContextMock.mockReset();
    updateChatContextMock.mockReset();
    deleteChatContextMock.mockReset();
    listLlmModelsMock.mockReset();
    submitQueryMock.mockReset();

    listChatContextsMock.mockResolvedValue([
      {
        id: "ctx-1",
        name: "Context One",
        conversationModelId: null,
        chat3dModelId: null,
        ownerId: "user-1",
        createdAt: "2026-02-18T00:00:00.000Z",
        updatedAt: "2026-02-18T00:00:00.000Z",
      },
      {
        id: "ctx-2",
        name: "Context Two",
        conversationModelId: null,
        chat3dModelId: null,
        ownerId: "user-1",
        createdAt: "2026-02-18T00:00:00.000Z",
        updatedAt: "2026-02-18T00:00:00.000Z",
      },
    ]);

    listChatItemsMock.mockImplementation(async (_token: string, contextId: string) => {
      if (contextId === "ctx-2") {
        return [
          {
            id: "item-ctx-2",
            chatContextId: "ctx-2",
            role: "assistant",
            messages: [{ id: "m2", itemType: "message", text: "Context two message", state: "completed" }],
            rating: 0,
            ownerId: "user-1",
            createdAt: "2026-02-18T00:00:00.000Z",
            updatedAt: "2026-02-18T00:00:00.000Z",
          },
        ];
      }

      return [
        {
          id: "item-ctx-1",
          chatContextId: "ctx-1",
          role: "assistant",
          messages: [{ id: "m1", itemType: "message", text: "Context one message", state: "completed" }],
          rating: 0,
          ownerId: "user-1",
          createdAt: "2026-02-18T00:00:00.000Z",
          updatedAt: "2026-02-18T00:00:00.000Z",
        },
      ];
    });

    listLlmModelsMock.mockResolvedValue([]);
    submitQueryMock.mockResolvedValue({
      contextId: "ctx-1",
      userItemId: "user-item",
      assistantItem: {
        id: "assistant-item",
        chatContextId: "ctx-1",
        role: "assistant",
        messages: [],
      },
      generatedFiles: [],
      llm: { conversationModel: "model-a", codegenModel: "model-b" },
      renderer: "build123d",
    });
  });

  it("supports route-level context switching", async () => {
    renderChatPage("/chat/ctx-1");

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledWith("test-token", "ctx-1");
    });

    fireEvent.click(await screen.findByTestId("open-context-ctx-2"));

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledWith("test-token", "ctx-2");
    });

    expect(await screen.findByText("Context two message")).toBeTruthy();
  });

  it("shows optimistic pending state while prompt submission is in-flight", async () => {
    const resolveSubmitRef: { current?: () => void } = {};
    submitQueryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmitRef.current = () =>
            resolve({
              contextId: "ctx-1",
              userItemId: "user-item",
              assistantItem: { id: "assistant-item", chatContextId: "ctx-1", role: "assistant", messages: [] },
              generatedFiles: [],
              llm: { conversationModel: "model-a", codegenModel: "model-b" },
              renderer: "build123d",
            });
        }),
    );

    renderChatPage("/chat/ctx-1");

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledWith("test-token", "ctx-1");
    });

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "build a test cube" },
    });
    const sendButton = screen
      .getAllByRole("button", { name: "Send" })
      .find((button) => !button.hasAttribute("disabled"));
    if (!sendButton) {
      throw new Error("Missing enabled send button");
    }
    fireEvent.click(sendButton);

    expect(await screen.findByTestId("optimistic-pending")).toBeTruthy();

    resolveSubmitRef.current?.();

    await waitFor(() => {
      expect(screen.queryByTestId("optimistic-pending")).toBeNull();
    });
  });

  it("applies SSE updates for active route context", async () => {
    const view = renderChatPage("/chat/ctx-1");

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledTimes(1);
    });

    notificationsState.notifications = [
      {
        id: 9,
        eventType: "chat.item.updated",
        payload: {
          contextId: "ctx-1",
          itemId: "item-ctx-1",
          action: "updated",
        },
        createdAt: "2026-02-18T01:00:00.000Z",
      },
    ];

    view.rerender(
      <MemoryRouter initialEntries={["/chat/ctx-1"]}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/new" element={<ChatPage />} />
          <Route path="/chat/:contextId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledTimes(2);
    });
  });
});
