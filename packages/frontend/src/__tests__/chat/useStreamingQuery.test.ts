// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamingQuery } from "../../hooks/useStreamingQuery";

/* ── EventSource mock ─────────────────────────────────────────────────────── */

type EventHandler = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  listeners = new Map<string, EventHandler[]>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: EventHandler) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  close() {
    this.closed = true;
  }

  // Test helpers
  emit(type: string, data: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const handler of handlers) {
      handler(event);
    }
  }

  triggerError() {
    this.onerror?.();
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!source) throw new Error("No MockEventSource created");
  return source;
}

/* ── Setup / Teardown ─────────────────────────────────────────────────────── */

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function streamTokenPayload(assistantItemId: string, token: string, done = false) {
  return {
    eventType: "stream-token",
    payload: { contextId: "ctx-1", assistantItemId, token, done },
  };
}

function queryStatePayload(assistantItemId: string, state: string, detail?: string) {
  return {
    eventType: "chat.query.state",
    payload: { contextId: "ctx-1", assistantItemId, state, detail: detail ?? null },
  };
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
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("returns idle state when assistantItemId is null", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: null }),
    );

    expect(result.current.isStreaming).toBe(false);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("creates EventSource with token when both token and assistantItemId provided", () => {
    renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    expect(MockEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toContain("token=jwt-token");
  });

  it("sets isStreaming to true when connection is active", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    expect(result.current.isStreaming).toBe(true);
  });

  it("accumulates streaming text from stream-token events", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("stream-token", streamTokenPayload("item-1", "Hello"));
    });
    expect(result.current.streamingText).toBe("Hello");

    act(() => {
      source.emit("stream-token", streamTokenPayload("item-1", " world"));
    });
    expect(result.current.streamingText).toBe("Hello world");
  });

  it("ignores stream-token events for different assistantItemId", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("stream-token", streamTokenPayload("item-OTHER", "ignored"));
    });
    expect(result.current.streamingText).toBe("");
  });

  it("tracks query state from chat.query.state events", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-1", "conversation"));
    });
    expect(result.current.queryState).toBe("conversation");

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-1", "codegen"));
    });
    expect(result.current.queryState).toBe("codegen");
  });

  it("ignores query-state events for different assistantItemId", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-OTHER", "codegen"));
    });
    expect(result.current.queryState).toBeNull();
  });

  it("sets isStreaming to false and closes connection on completed state", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-1", "completed"));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(source.closed).toBe(true);
  });

  it("sets error and stops streaming on failed state", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-1", "failed", "LLM timeout"));
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("LLM timeout");
    expect(result.current.queryState).toBe("failed");
    expect(source.closed).toBe(true);
  });

  it("uses default error message when failed state has no detail", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("chat.query.state", queryStatePayload("item-1", "failed"));
    });

    expect(result.current.error).toBe("Query failed");
  });

  it("handles connection interruption with partial response display", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    // Accumulate some text first
    act(() => {
      source.emit("stream-token", streamTokenPayload("item-1", "Partial response"));
    });

    // Simulate connection error
    act(() => {
      source.triggerError();
    });

    expect(result.current.streamingText).toBe("Partial response");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("Stream interrupted. Your partial response is shown above.");
  });

  it("resets state when assistantItemId changes", () => {
    const { result, rerender } = renderHook(
      ({ assistantItemId }) =>
        useStreamingQuery({ token: "jwt-token", assistantItemId }),
      { initialProps: { assistantItemId: "item-1" as string | null } },
    );

    const source1 = latestSource();

    act(() => {
      source1.emit("stream-token", streamTokenPayload("item-1", "First response"));
    });
    expect(result.current.streamingText).toBe("First response");

    // Change assistantItemId
    rerender({ assistantItemId: "item-2" });

    expect(result.current.streamingText).toBe("");
    expect(result.current.queryState).toBeNull();
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
    expect(source1.closed).toBe(true);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();
    expect(source.closed).toBe(false);

    unmount();
    expect(source.closed).toBe(true);
  });

  it("handles malformed SSE data gracefully", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    // Emit malformed data — should not throw or change state
    act(() => {
      const handlers = source.listeners.get("stream-token") ?? [];
      const event = new MessageEvent("stream-token", { data: "not-json" });
      for (const handler of handlers) {
        handler(event);
      }
    });

    expect(result.current.streamingText).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("preserves accumulated text through multiple token events including done", () => {
    const { result } = renderHook(() =>
      useStreamingQuery({ token: "jwt-token", assistantItemId: "item-1" }),
    );

    const source = latestSource();

    act(() => {
      source.emit("stream-token", streamTokenPayload("item-1", "Hello"));
      source.emit("stream-token", streamTokenPayload("item-1", " "));
      source.emit("stream-token", streamTokenPayload("item-1", "world", true));
    });

    expect(result.current.streamingText).toBe("Hello world");
    // isStreaming stays true until query-state says completed
    expect(result.current.isStreaming).toBe(true);
  });
});
