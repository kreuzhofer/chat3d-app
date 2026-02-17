import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SseService } from "../services/sse.service.js";

class MockResponse {
  public readonly headers = new Map<string, string>();
  public readonly chunks: string[] = [];
  public statusCode = 200;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SseService", () => {
  it("delivers realtime events to connected clients", () => {
    const service = new SseService(1000);
    const req = new EventEmitter() as Request;
    const res = new MockResponse();

    service.connect({
      request: req,
      response: res as unknown as Response,
      userId: "live-user",
      replayEvents: [],
    });

    service.publishToUser({
      id: 42,
      userId: "live-user",
      eventType: "notification.created",
      payload: { mode: "realtime" },
      readAt: null,
      createdAt: new Date().toISOString(),
    });

    expect(res.chunks.join("")).toContain("id: 42");
    expect(res.chunks.join("")).toContain("event: notification.created");
    expect(res.chunks.join("")).toContain("\"mode\":\"realtime\"");

    req.emit("close");
  });

  it("sends replay events when a client reconnects", () => {
    const service = new SseService(1000);
    const req = new EventEmitter() as Request;
    const res = new MockResponse();

    service.connect({
      request: req,
      response: res as unknown as Response,
      userId: "replay-user",
      replayEvents: [
        {
          id: 100,
          userId: "replay-user",
          eventType: "notification.created",
          payload: { mode: "replay" },
          readAt: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const output = res.chunks.join("");
    expect(output).toContain("id: 100");
    expect(output).toContain("\"mode\":\"replay\"");

    req.emit("close");
  });

  it("sends heartbeat comments for connected clients", () => {
    vi.useFakeTimers();

    const service = new SseService(100);
    const req = new EventEmitter() as Request;
    const res = new MockResponse();

    service.connect({
      request: req,
      response: res as unknown as Response,
      userId: "heartbeat-user",
      replayEvents: [],
    });

    vi.advanceTimersByTime(100);

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.chunks.some((chunk: string) => chunk.includes(": heartbeat"))).toBe(true);

    req.emit("close");
  });
});
