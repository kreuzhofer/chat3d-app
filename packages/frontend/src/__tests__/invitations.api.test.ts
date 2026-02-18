import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvitations, listInvitations, revokeInvitation } from "../api/invitations.api";

describe("invitations api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("lists invitations with auth header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ invitations: [{ id: "i1", inviteeEmail: "a@example.test", status: "pending" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const invitations = await listInvitations("token-1");
    expect(invitations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/invitations/",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
      }),
    );
  });

  it("creates and revokes invitations", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            invitations: [{ id: "i1", inviteeEmail: "a@example.test", status: "registration_sent" }],
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "i1", inviteeEmail: "a@example.test", status: "revoked" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const created = await createInvitations("token-2", ["a@example.test"]);
    expect(created[0]?.status).toBe("registration_sent");

    const revoked = await revokeInvitation("token-2", "i1");
    expect(revoked.status).toBe("revoked");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/invitations/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ emails: ["a@example.test"] }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/invitations/i1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
