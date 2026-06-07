import { describe, expect, it, vi } from "vitest";
import { runChecklistEval, parseChecklistVerdictText } from "../services/checklist-eval.service.js";
import type { ComponentChecklistItem } from "../utils/component-checklist.js";
import type { RenderedFile } from "../services/rendering.service.js";

const FAKE_IMG: RenderedFile = {
  filename: "front.png",
  contentBase64: "abc",
};

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

  it("returns UNCERTAIN and embeds the error message when a callback throws", async () => {
    const visualVerify = vi.fn().mockRejectedValue(new Error("timeout"));
    const r = await runChecklistEval({
      checklist: [{ item: "x", visibility: "visual" }],
      code: "",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify: vi.fn(),
    });
    expect(r.results[0].verdict).toBe("UNCERTAIN");
    expect(r.results[0].reasoning).toContain("timeout");
    expect(r.uncertainCount).toBe(1);
  });

  it("filters images by evalPlan.inspectionPlan.angles for visual items", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const codeVerify = vi.fn();

    const front: RenderedFile = { filename: "front.png", contentBase64: "f" };
    const back: RenderedFile = { filename: "back.png", contentBase64: "b" };
    const top: RenderedFile = { filename: "top.png", contentBase64: "t" };

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
    const fileNames = calledWith.images.map((i: RenderedFile) => i.filename);
    expect(fileNames).toEqual(["front.png", "top.png"]);
  });

  it("preserves originalIndices in results when provided", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const r = await runChecklistEval({
      checklist: [
        { item: "a", visibility: "visual" },
        { item: "b", visibility: "visual" },
      ],
      originalIndices: [3, 7],
      code: "",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify: vi.fn(),
    });
    expect(r.results.map((x) => x.index)).toEqual([3, 7]);
  });

  it("defaults to 0..N-1 indices when originalIndices is omitted", async () => {
    const visualVerify = vi.fn().mockResolvedValue({ verdict: "PASS", reasoning: "ok" });
    const r = await runChecklistEval({
      checklist: [
        { item: "a", visibility: "visual" },
        { item: "b", visibility: "visual" },
      ],
      code: "",
      renderedFiles: [FAKE_IMG],
      evalPlan: null,
      visualVerify,
      codeVerify: vi.fn(),
    });
    expect(r.results.map((x) => x.index)).toEqual([0, 1]);
  });
});

describe("evaluate_checklist tool integration", () => {
  it("returns 'no checklist configured' when deps.componentChecklist is empty", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [], getFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [{ filename: "front.png", contentBase64: "f" }],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [],
    } as any, { disableRender: true });
    const result = await tools.evaluate_checklist.execute({ itemIndices: undefined } as any, {} as any);
    expect(String(result)).toMatch(/no verification checklist/i);
  });

  it("returns 'no rendered files' when render cache empty", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [], getFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [{ item: "x", visibility: "visual" }],
    } as any, { disableRender: true });
    const result = await tools.evaluate_checklist.execute({} as any, {} as any);
    expect(String(result)).toMatch(/no rendered files/i);
  });

  it("includes a warning line when all indices are out of range", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [], getFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [{ filename: "front.png", contentBase64: "f" }],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [{ item: "a", visibility: "code" }],
    } as any, { disableRender: true });

    // Indices 5 and 10 are both out of range for a 1-item checklist
    const result = await tools.evaluate_checklist.execute(
      { itemIndices: [5, 10] } as any,
      {} as any,
    );
    expect(String(result)).toMatch(/out of range/i);
  });

  it("returns an explicit message when itemIndices is empty array", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools({
      fs: { getMainCode: () => "", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [], getFiles: () => [] } as any,
      wrapProjectFiles: () => [],
      baseFileName: "x",
      onRenderSuccess: () => {},
      onSubmit: () => {},
      getLastRenderedFiles: () => [{ filename: "front.png", contentBase64: "f" }],
      userPrompt: "p",
      evalThreshold: 5,
      componentChecklist: [{ item: "a", visibility: "code" }],
    } as any, { disableRender: true });
    const result = await tools.evaluate_checklist.execute(
      { itemIndices: [] } as any,
      {} as any,
    );
    expect(String(result)).toMatch(/empty itemindices/i);
  });
});

describe("parseChecklistVerdictText", () => {
  it("parses PASS + reasoning from a typical LLM response", () => {
    const parsed = parseChecklistVerdictText("PASS\nFront view shows 4 holes at the corners.");
    expect(parsed.verdict).toBe("PASS");
    expect(parsed.reasoning).toContain("Front view");
  });

  it("parses FAIL + reasoning", () => {
    const parsed = parseChecklistVerdictText("FAIL — body not hollow");
    expect(parsed.verdict).toBe("FAIL");
    expect(parsed.reasoning).toContain("body not hollow");
  });

  it("defaults to UNCERTAIN when verdict not detected", () => {
    const parsed = parseChecklistVerdictText("hmm I am not sure");
    expect(parsed.verdict).toBe("UNCERTAIN");
  });
});
