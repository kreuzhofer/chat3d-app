import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import { config } from "../config.js";
import { NotificationBusService } from "../services/notification-bus.service.js";

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

interface FakeRedisClient {
  connect: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function createFakeRedisClient(onSubscribe?: (handler: (payload: string) => void) => void): FakeRedisClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockImplementation(async (_channel: string, handler: (payload: string) => void) => {
      onSubscribe?.(handler);
      return;
    }),
    on: vi.fn(),
  };
}

const mockedCreateClient = vi.mocked(createClient);
const originalMode = config.eventBus.mode;

afterEach(() => {
  config.eventBus.mode = originalMode;
  mockedCreateClient.mockReset();
});

describe("notification bus service", () => {
  it("does not use redis clients when mode is local", async () => {
    config.eventBus.mode = "local";
    const service = new NotificationBusService();

    service.registerHandler(vi.fn());

    const published = await service.publish({
      id: 1,
      userId: "user-1",
      eventType: "notification.created",
      payload: { ok: true },
      createdAt: new Date().toISOString(),
      readAt: null,
    });

    expect(published).toBe(false);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("fans out redis messages to registered handlers", async () => {
    config.eventBus.mode = "redis";

    let subscriberHandler: ((payload: string) => void) | undefined;
    const publisher = createFakeRedisClient();
    const subscriber = createFakeRedisClient((handler) => {
      subscriberHandler = handler;
    });

    mockedCreateClient
      .mockReturnValueOnce(publisher as unknown as ReturnType<typeof createClient>)
      .mockReturnValueOnce(subscriber as unknown as ReturnType<typeof createClient>);

    const service = new NotificationBusService();
    const handler = vi.fn();
    service.registerHandler(handler);

    const event = {
      id: 9,
      userId: "user-9",
      eventType: "chat.query.state",
      payload: { state: "completed" },
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    const published = await service.publish(event);
    expect(published).toBe(true);
    expect(mockedCreateClient).toHaveBeenCalledTimes(2);
    expect(publisher.publish).toHaveBeenCalledWith(config.eventBus.channel, JSON.stringify(event));
    expect(subscriber.subscribe).toHaveBeenCalledWith(config.eventBus.channel, expect.any(Function));

    subscriberHandler?.(JSON.stringify(event));
    expect(handler).toHaveBeenCalledWith(event);
  });
});
