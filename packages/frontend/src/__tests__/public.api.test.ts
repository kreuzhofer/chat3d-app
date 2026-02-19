import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicConfig } from "../api/public.api";

describe("public api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("reads waitlist mode", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ waitlistEnabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const config = await getPublicConfig();
    expect(config.waitlistEnabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/public/config", expect.objectContaining({ method: "GET" }));
  });
});
