import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFile, downloadFileText, uploadFileBase64 } from "../api/files.api";

describe("files api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("uploads and downloads text files", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ path: "upload/demo.txt", sizeBytes: 4 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("demo", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const uploaded = await uploadFileBase64({
      token: "token-1",
      path: "upload/demo.txt",
      contentBase64: "ZGVtbw==",
    });
    expect(uploaded.path).toBe("upload/demo.txt");

    const downloaded = await downloadFileText({
      token: "token-1",
      path: "upload/demo.txt",
    });
    expect(downloaded).toBe("demo");

    await deleteFile({
      token: "token-1",
      path: "upload/demo.txt",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/files/upload",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/files/download?path=upload%2Fdemo.txt",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/files/delete?path=upload%2Fdemo.txt",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("throws backend error messages", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "File not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      downloadFileText({
        token: "token-1",
        path: "upload/missing.txt",
      }),
    ).rejects.toThrow("File not found");
  });
});
