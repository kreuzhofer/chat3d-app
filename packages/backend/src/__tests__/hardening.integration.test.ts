import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { pool, query } from "../db/connection.js";

describe("Milestone 10 hardening", () => {
  const app = createApp();

  beforeAll(async () => {
    await query(`DELETE FROM security_events;`);
  });

  afterAll(async () => {
    await query(`DELETE FROM security_events;`);
    await pool.end();
  });

  it("sets security headers on health endpoints", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(typeof response.headers["content-security-policy"]).toBe("string");
  });

  it("handles CORS preflight for allowed origins", async () => {
    const response = await request(app)
      .options("/api/auth/login")
      .set("Origin", "http://localhost")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost");
  });

  it("rate limits sensitive endpoints and writes security audit events", async () => {
    let sawRateLimit = false;

    for (let index = 0; index < 10; index += 1) {
      const response = await request(app).post("/api/profile/reactivate/request").send({
        email: "rate-limit@example.test",
      });

      if (response.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    expect(sawRateLimit).toBe(true);

    const events = await query<{ event_type: string }>(
      `
      SELECT event_type
      FROM security_events
      WHERE event_type = 'rate_limit.exceeded';
      `,
    );

    expect(events.rows.length).toBeGreaterThan(0);
  });

  it("allows query-token auth only for stream endpoint", async () => {
    const replayWithQueryToken = await request(app).get("/api/events/replay").query({ token: "invalid-token" });
    expect(replayWithQueryToken.status).toBe(401);
    expect(replayWithQueryToken.body.error).toMatch(/missing authorization header/i);

    const streamWithQueryToken = await request(app).get("/api/events/stream").query({ token: "invalid-token" });
    expect(streamWithQueryToken.status).toBe(401);
    expect(streamWithQueryToken.body.error).toMatch(/invalid authentication token/i);
  });
});
