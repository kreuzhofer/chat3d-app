import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmWaitlistEmail, getWaitlistStatus, joinWaitlist } from "../api/waitlist.api";

describe("waitlist api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("joins waitlist with email and consent", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ entryId: "w1", status: "pending_email_confirmation" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await joinWaitlist("user@example.test", true);
    expect(result.entryId).toBe("w1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/waitlist/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.test", marketingConsent: true }),
      }),
    );
  });

  it("confirms email and checks status by token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entryId: "w1", email: "user@example.test", status: "pending_admin_approval" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entryId: "w1",
            email: "user@example.test",
            status: "pending_admin_approval",
            marketingConsent: true,
            emailConfirmedAt: "2026-02-18T00:00:00.000Z",
            approvedAt: null,
            createdAt: "2026-02-18T00:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const confirmed = await confirmWaitlistEmail("tok-1");
    expect(confirmed.status).toBe("pending_admin_approval");

    const status = await getWaitlistStatus({ token: "tok-1" });
    expect(status.email).toBe("user@example.test");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/waitlist/confirm-email?token=tok-1", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/waitlist/status?token=tok-1", expect.any(Object));
  });
});
