import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login, logout, register } from "../auth/auth.api";

describe("auth api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends login and register payloads", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "jwt",
          user: { id: "u1", email: "user@example.test", role: "user", status: "active", displayName: "User" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await login({ email: "user@example.test", password: "S3cret!234" });
    await register({
      email: "user@example.test",
      password: "S3cret!234",
      displayName: "User",
      registrationToken: "reg-token-1",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "user@example.test",
          password: "S3cret!234",
          displayName: "User",
          registrationToken: "reg-token-1",
        }),
      }),
    );
  });

  it("sends authenticated logout request", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await logout("token-logout");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-logout",
        }),
      }),
    );
  });
});
