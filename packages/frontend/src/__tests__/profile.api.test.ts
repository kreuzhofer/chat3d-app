import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmProfileAction,
  requestAccountDelete,
  requestAccountReactivation,
  requestDataExport,
  requestEmailChange,
  requestPasswordReset,
} from "../api/profile.api";

describe("profile api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends authenticated lifecycle requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_confirmation" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await requestPasswordReset("token-1", "N3wPassword!123");
    await requestEmailChange("token-1", "new@example.test");
    await requestDataExport("token-1");
    await requestAccountDelete("token-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/profile/reset-password/request",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/profile/change-email/request",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/profile/export-data/request",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/profile/delete-account/request",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("requests reactivation without auth header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_confirmation" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await requestAccountReactivation("user@example.test");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile/reactivate/request",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.test" }),
      }),
    );
  });

  it("confirms action token and exposes backend error", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "completed", actionType: "account_reactivate" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid confirmation token" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const confirmed = await confirmProfileAction("abc-token");
    expect(confirmed.actionType).toBe("account_reactivate");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/profile/actions/confirm?token=abc-token",
      expect.objectContaining({
        method: "GET",
      }),
    );

    await expect(confirmProfileAction("broken")).rejects.toThrow("Invalid confirmation token");
  });
});
