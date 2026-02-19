import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateAdminUser,
  deactivateAdminUser,
  listAdminUsers,
  updateAdminSettings,
} from "../api/admin.api";

describe("admin api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("lists users and forwards search query", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ users: [{ id: "u1", email: "user@example.test" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const users = await listAdminUsers("token-1", "example");

    expect(users).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users?search=example",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
      }),
    );
  });

  it("uses PATCH for activate/deactivate routes", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "u1",
          email: "user@example.test",
          displayName: null,
          role: "user",
          status: "active",
          deactivatedUntil: null,
          createdAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await activateAdminUser("token-2", "u1");
    await deactivateAdminUser("token-2", "u1", "manual moderation");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/users/u1/activate",
      expect.objectContaining({
        method: "PATCH",
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/users/u1/deactivate",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("throws response error message when settings update fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      updateAdminSettings("token-3", {
        invitationsEnabled: false,
      }),
    ).rejects.toThrow("forbidden");
  });
});
