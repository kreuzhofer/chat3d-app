// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { useStreamingQuery } from "../../hooks/useStreamingQuery";
import type { SseSubscriber } from "../../contexts/NotificationsContext";
import type { SseMessage } from "../../hooks/useSSE";

/* ── Mock NotificationsContext ────────────────────────────────────────────── */

let capturedSubscriber: SseSubscriber | null = null;
const mockSubscribe = vi.fn((fn: SseSubscriber) => {
  capturedSubscriber = fn;
  return () => {
    capturedSubscriber = null;
  };
});

vi.mock("../../contexts/NotificationsContext", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    connectionState: "open",
    refreshReplay: vi.fn(),
    markAllRead: vi.fn(),
    subscribe: mockSubscribe,
  }),
}));

/* ── Setup / Teardown ─────────────────────────────────────────────────────── */

beforeEach(() => {
  capturedSubscriber = null;
  mockSubscribe.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function emitMessage(eventType: string, payload: Record<string, unknown>) {
  if (!capturedSubscriber) throw new Error("No subscriber registered");
  capturedSubscriber({
    id: 0,
    eventType,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function streamTokenPayload(assistantItemId: string, token: string, done = false) {
  return { contextId: "ctx-1", assistantItemId, token, done };
}

function queryStatePayload(assistantItemId: string, state: string, detail?: string) {
  return { contextId: "ctx-1", assistantItemId, state, detail: detail ?? null };
}

/* ── Tests ─────────────────────────────────────────────────────────────────── */

describe("useStreamingQuery", () => {
  it("returns idle state when token is null", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: null, assistantItemId: "item-1" }),
    );

    expect(result.current.streamingText).toBe("");
    expect(result.current.queryState).toBeNull();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("returns idle state when assistantItemId is null", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: null }),
    );

    expect(result.current.isStreaming).toBe(false);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("subscribes to shared SSE when both token and assistantItemId provided", () => {
    renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(capturedSubscriber).not.toBeNull();
  });

  it("sets isStreaming to true when active", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    expect(result.current.isStreaming).toBe(true);
  });

  it("accumulates streaming text from stream-token events", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("stream-token", streamTokenPayload("item-1", "Hello"));
    });
    expect(result.current.streamingText).toBe("Hello");

    act(() => {
      emitMessage("stream-token", streamTokenPayload("item-1", " world"));
    });
    expect(result.current.streamingText).toBe("Hello world");
  });

  it("ignores stream-token events for different assistantItemId", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("stream-token", streamTokenPayload("item-OTHER", "ignored"));
    });
    expect(result.current.streamingText).toBe("");
  });

  it("tracks query state from chat.query.state events", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-1", "conversation"));
    });
    expect(result.current.queryState).toBe("conversation");

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-1", "codegen"));
    });
    expect(result.current.queryState).toBe("codegen");
  });

  it("ignores query-state events for different assistantItemId", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-OTHER", "codegen"));
    });
    expect(result.current.queryState).toBeNull();
  });

  it("sets isStreaming to false on completed state", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-1", "completed"));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error and stops streaming on failed state", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-1", "failed", "LLM timeout"));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("LLM timeout");
    expect(result.current.queryState).toBe("failed");
  });

  it("uses default error message when failed state has no detail", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("chat.query.state", queryStatePayload("item-1", "failed"));
    });

    expect(result.current.error).toBe("Query failed");
  });

  it("resets state when assistantItemId changes", () => {
    const { result, rerender } = renderHook(
      ({ assistantItemId }) =>
        useStreamingQuery({ token: "jwt-token", assistantItemId }),
      { initialProps: { assistantItemId: "item-1" as string | null } },
    );

    act(() => {
      emitMessage("stream-token", streamTokenPayload("item-1", "First response"));
    });
    expect(result.current.streamingText).toBe("First response");

    // Change assistantItemId
    rerender({ assistantItemId: "item-2" });

    expect(result.current.streamingText).toBe("");
    expect(result.current.queryState).toBeNull();
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    expect(capturedSubscriber).not.toBeNull();
    unmount();
    expect(capturedSubscriber).toBeNull();
  });

  it("preserves accumulated text through multiple token events including done", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    act(() => {
      emitMessage("stream-token", streamTokenPayload("item-1", "Hello"));
      emitMessage("stream-token", streamTokenPayload("item-1", " "));
      emitMessage("stream-token", streamTokenPayload("item-1", "world", true));
    });

    expect(result.current.streamingText).toBe("Hello world");
    // isStreaming stays true until query-state says completed
    expect(result.current.isStreaming).toBe(true);
  });
});
