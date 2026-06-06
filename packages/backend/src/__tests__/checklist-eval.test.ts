import { describe, expect, it, vi } from "vitest";
import { runChecklistEval } from "../services/checklist-eval.service.js";
import type { ComponentChecklistItem } from "../utils/component-checklist.js";
import type { RenderedFile } from "../services/rendering.service.js";

const FAKE_IMG: RenderedFile = {
  fileName: "front.png",
  contentBase64: "abc",
  mimeType: "image/png",
} as RenderedFile;

describe("runChecklistEval", () => {
  it("dispatches visual-only items to the VLM and skips code path", async () => {
    const visualVerify = vi.fn().mockResolvedValue({
      verdict: "PASS",
      reasoning: "looks fine",
    });
    const codeVerify = vi.fn();

    const items: ComponentChecklistItem[] = [
      { item: "Has 4 holes", visibility: "visual" },
    ];

    const result = await runChecklistEval({
      checklist: items,
      code: "x = 1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).toHaveBeenCalledTimes(1);
    expect(codeVerify).not.toHaveBeenCalled();
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.results[0].verdict).toBe("PASS");
  });

  it("dispatches code-only items to the code-eval and skips visual path", async () => {
    const visualVerify = vi.fn();
    const codeVerify = vi.fn().mockResolvedValue({
      verdict: "FAIL",
      reasoning: "wall=1.5 not 2",
    });

    const result = await runChecklistEval({
      checklist: [{ item: "Wall is 2mm", visibility: "code" }],
      code: "wall = 1.5",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(visualVerify).not.toHaveBeenCalled();
    expect(codeVerify).toHaveBeenCalledTimes(1);
    expect(result.failedCount).toBe(1);
    expect(result.results[0].verdict).toBe("FAIL");
  });

  it("runs BOTH paths for 'both' items and combines: any FAIL → FAIL", async () => {
    const visualVerify = vi.fn().mockResolvedValue({
      verdict: "PASS",
      reasoning: "v ok",
    });
    const codeVerify = vi.fn().mockResolvedValue({
      verdict: "FAIL",
      reasoning: "c bad",
    });

    const result = await runChecklistEval({
      checklist: [{ item: "Lid inverted", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(result.results[0].verdict).toBe("FAIL");
    expect(result.results[0].reasoning).toContain("v ok");
    expect(result.results[0].reasoning).toContain("c bad");
  });

  it("'both': PASS+UNCERTAIN → UNCERTAIN (no FAIL anywhere)", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "v" });
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "UNCERTAIN", reasoning: "c" });

    const r = await runChecklistEval({
      checklist: [{ item: "x", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].verdict).toBe("UNCERTAIN");
    expect(r.uncertainCount).toBe(1);
  });

  it("'both': PASS+PASS → PASS", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "v" });
    const codeVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "c" });

    const r = await runChecklistEval({
      checklist: [{ item: "x", visibility: "both" }],
      code: "x=1",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify,
    });

    expect(r.results[0].verdict).toBe("PASS");
  });

  it("returns empty counts for empty checklist", async () => {
    const r = await runChecklistEval({
      checklist: [],
      code: "",
      renderedFiles: [],
      evalPlan: null,
      visualVerify: vi.fn(),
      codeVerify: vi.fn(),
    });
    expect(r.passedCount).toBe(0);
    expect(r.failedCount).toBe(0);
    expect(r.uncertainCount).toBe(0);
    expect(r.results).toEqual([]);
  });

  it("filters images by evalPlan.inspectionPlan.angles for visual items", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const codeVerify = vi.fn();

    const front: RenderedFile = { fileName: "front.png", contentBase64: "f", mimeType: "image/png" } as RenderedFile;
    const back: RenderedFile = { fileName: "back.png", contentBase64: "b", mimeType: "image/png" } as RenderedFile;
    const top: RenderedFile = { fileName: "top.png", contentBase64: "t", mimeType: "image/png" } as RenderedFile;

    await runChecklistEval({
      checklist: [{ item: "x", visibility: "visual" }],
      code: "",
      renderedFiles: [front, back, top],
      evalPlan: {
        systemPrompt: "x",
        inspectionPlan: { angles: ["front", "top"] },
        suggestedCodeWeight: 0.4,
      },
      visualVerify,
      codeVerify,
    });

    const calledWith = visualVerify.mock.calls[0][0];
    const fileNames = calledWith.images.map((i: RenderedFile) => i.fileName);
    expect(fileNames).toEqual(["front.png", "top.png"]);
  });
});
