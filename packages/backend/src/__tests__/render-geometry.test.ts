import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { renderBuild123d, renderBuild123dProject } from "../services/rendering.service.js";

/**
 * The Build123d service's geometry block (#137): the solid count of the
 * exported model and its bounding box, read by the backend client.
 */

const FILE = { filename: "x.step", content: "c3RlcA==" };

function stubServiceReply(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

describe("the render client reads the geometry block", () => {
  const savedMode = config.query.renderMode;
  beforeEach(() => { config.query.renderMode = "live"; });
  afterEach(() => {
    config.query.renderMode = savedMode;
    vi.unstubAllGlobals();
  });

  it("returns the measured solid count and bounding box", async () => {
    stubServiceReply({
      success: true, files: [FILE], message: "ok",
      geometry: { solid_count: 3, bbox: { min: [-5, -10, 0], max: [65, 10, 10] } },
    });
    const result = await renderBuild123d({ code: "x", baseFileName: "x" });
    expect(result.geometry).toEqual({ solidCount: 3, bbox: { min: [-5, -10, 0], max: [65, 10, 10] } });
  });

  it("returns it from a project render too", async () => {
    stubServiceReply({
      success: true, files: [FILE], message: "ok",
      geometry: { solid_count: 1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } },
    });
    const result = await renderBuild123dProject({ files: [{ path: "main.py", content: "x" }], baseFileName: "x" });
    expect(result.geometry?.solidCount).toBe(1);
  });

  it("is null when the service measured nothing (no root_part)", async () => {
    stubServiceReply({ success: true, files: [FILE], message: "ok", geometry: null });
    const result = await renderBuild123d({ code: "x", baseFileName: "x" });
    expect(result.geometry).toBeNull();
  });

  it("is null when the service predates the block", async () => {
    stubServiceReply({ success: true, files: [FILE], message: "ok" });
    const result = await renderBuild123d({ code: "x", baseFileName: "x" });
    expect(result.geometry).toBeNull();
  });

  it.each([
    ["a non-integer count", { solid_count: 1.5, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }],
    ["a count below zero", { solid_count: -1, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }],
    ["a missing bbox", { solid_count: 2 }],
    ["a short bbox corner", { solid_count: 2, bbox: { min: [0, 0], max: [1, 1, 1] } }],
  ])("is null for a malformed block (%s), never a guessed count", async (_label, geometry) => {
    stubServiceReply({ success: true, files: [FILE], message: "ok", geometry });
    const result = await renderBuild123d({ code: "x", baseFileName: "x" });
    expect(result.geometry).toBeNull();
  });

  it("is null in mock mode", async () => {
    config.query.renderMode = "mock";
    const result = await renderBuild123d({ code: "x", baseFileName: "x" });
    expect(result.geometry).toBeNull();
  });
});
