// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const updateChatItemMock = vi.fn();
const deleteChatContextMock = vi.fn();
const listLlmModelsMock = vi.fn();
const submitQueryMock = vi.fn();
const regenerateQueryMock = vi.fn();
const uploadFileBase64Mock = vi.fn();
const downloadFileBinaryMock = vi.fn();

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
  updateChatItem: (...args: unknown[]) => updateChatItemMock(...args),
  deleteChatContext: (...args: unknown[]) => deleteChatContextMock(...args),
}));

vi.mock("../api/query.api", () => ({
  listLlmModels: (...args: unknown[]) => listLlmModelsMock(...args),
  submitQuery: (...args: unknown[]) => submitQueryMock(...args),
  regenerateQuery: (...args: unknown[]) => regenerateQueryMock(...args),
}));

vi.mock("../api/files.api", () => ({
  uploadFileBase64: (...args: unknown[]) => uploadFileBase64Mock(...args),
  downloadFileBinary: (...args: unknown[]) => downloadFileBinaryMock(...args),
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
    cleanup();
  });

  beforeEach(() => {
    notificationsState.notifications = [];
    notificationsState.refreshReplay.mockClear();

    listChatContextsMock.mockReset();
    listChatItemsMock.mockReset();
    createChatContextMock.mockReset();
    updateChatContextMock.mockReset();
    updateChatItemMock.mockReset();
    deleteChatContextMock.mockReset();
    listLlmModelsMock.mockReset();
    submitQueryMock.mockReset();
    regenerateQueryMock.mockReset();
    uploadFileBase64Mock.mockReset();
    downloadFileBinaryMock.mockReset();

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
          messages: [
            { id: "m1", itemType: "message", text: "Context one message", state: "completed" },
            {
              id: "m1-model",
              itemType: "3dmodel",
              text: "Preview unavailable in-browser. Download STEP or regenerate with STL/3MF output.",
              attachment: "",
              state: "completed",
              files: [{ path: "modelcreator/test.step", filename: "test.step" }],
              artifact: {
                previewStatus: "downgraded",
                detail: "Renderer produced STEP only",
              },
            },
            {
              id: "m1-meta",
              itemType: "meta",
              text: "Diagnostics",
              state: "completed",
              usage: {
                inputTokens: 120,
                outputTokens: 40,
                totalTokens: 160,
                estimatedCostUsd: 0.0024,
              },
            },
          ],
          rating: 0,
          ownerId: "user-1",
          createdAt: "2026-02-18T00:00:00.000Z",
          updatedAt: "2026-02-18T00:00:00.000Z",
        },
      ];
    });

    listLlmModelsMock.mockResolvedValue([]);
    updateChatItemMock.mockResolvedValue({
      id: "item-ctx-1",
      chatContextId: "ctx-1",
      role: "assistant",
      messages: [{ id: "m1", itemType: "message", text: "Context one message", state: "completed" }],
      rating: 1,
      ownerId: "user-1",
      createdAt: "2026-02-18T00:00:00.000Z",
      updatedAt: "2026-02-18T00:00:00.000Z",
    });
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
    regenerateQueryMock.mockResolvedValue({
      contextId: "ctx-1",
      userItemId: "user-item-r2",
      assistantItem: {
        id: "assistant-item-r2",
        chatContextId: "ctx-1",
        role: "assistant",
        messages: [],
      },
      generatedFiles: [],
      llm: { conversationModel: "model-a", codegenModel: "model-b" },
      renderer: "build123d",
    });
    uploadFileBase64Mock.mockResolvedValue({
      path: "uploads/upload-1.png",
      sizeBytes: 32,
    });
    downloadFileBinaryMock.mockResolvedValue({
      blob: new Blob(["data"]),
      filename: "download.bin",
      contentType: "application/octet-stream",
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

    fireEvent.change(screen.getByTestId("chat-prompt-input"), {
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

  it("supports rating and regenerate actions on assistant responses", async () => {
    renderChatPage("/chat/ctx-1");

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledWith("test-token", "ctx-1");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Thumbs up" })[0]);

    await waitFor(() => {
      expect(updateChatItemMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Regenerate" })[0]);

    await waitFor(() => {
      expect(regenerateQueryMock).toHaveBeenCalled();
    });
  });

  it("uploads attachments and includes them in query submission", async () => {
    const view = renderChatPage("/chat/ctx-1");
    const scoped = within(view.container);

    await waitFor(() => {
      expect(listChatItemsMock).toHaveBeenCalledWith("test-token", "ctx-1");
    });

    const file = new File(["fake-image"], "reference.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: vi.fn(async () => new TextEncoder().encode("fake-image").buffer),
      configurable: true,
    });
    const fileInput = scoped.getByTestId("chat-attachments-input") as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);
    const uploadButton = scoped
      .getAllByRole("button", { name: "Upload Selected" })
      .find((button) => !button.hasAttribute("disabled"));
    if (!uploadButton) {
      throw new Error("Missing enabled upload button");
    }
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(uploadFileBase64Mock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(scoped.getByTestId("chat-prompt-input"), {
      target: { value: "build a test cube with reference" },
    });
    const sendButton = scoped
      .getAllByRole("button", { name: "Send" })
      .find((button) => !button.hasAttribute("disabled"));
    if (!sendButton) {
      throw new Error("Missing enabled send button");
    }
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(submitQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "test-token",
          contextId: "ctx-1",
          prompt: "build a test cube with reference",
          attachments: [
            expect.objectContaining({
              path: "uploads/upload-1.png",
              filename: "reference.png",
              kind: "image",
            }),
          ],
        }),
      );
    });
  });
});
