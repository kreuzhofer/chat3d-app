import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRunChecklistEval = vi.hoisted(() => vi.fn());
const mockRenderModelScreenshots = vi.hoisted(() => vi.fn());
const mockRunFullEvaluation = vi.hoisted(() => vi.fn());

vi.mock("../services/checklist-eval.service.js", async (orig) => {
  const mod = (await orig()) as any;
  return {
    ...mod,
    runChecklistEval: mockRunChecklistEval,
    verifyChecklistItemVisual: vi.fn(),
    verifyChecklistItemCode: vi.fn(),
  };
});

vi.mock("../services/stl-rendering-client.service.js", async (orig) => {
  const mod = (await orig()) as any;
  return {
    ...mod,
    renderModelScreenshots: mockRenderModelScreenshots,
  };
});

vi.mock("../services/eval-orchestrator.service.js", async (orig) => {
  const mod = (await orig()) as any;
  return {
    ...mod,
    runFullEvaluation: mockRunFullEvaluation,
  };
});

const mkDeps = (overrides: any = {}) => ({
  fs: { getMainCode: () => "x = 1", getAllFiles: () => [], writeFile: () => {}, listFiles: () => [], getFiles: () => [] },
  wrapProjectFiles: () => [],
  baseFileName: "x",
  onRenderSuccess: () => {},
  onSubmit: vi.fn(),
  getLastRenderedFiles: () => [{ filename: "model.stl", contentBase64: "f" }],
  getLastScreenshots: () => [{ angle: "front", base64: "imgdata" }],
  userPrompt: "p",
  evalThreshold: 5,
  componentChecklist: [
    { item: "Body is hollow", visibility: "visual" as const, componentName: "body" },
  ],
  evalPlan: null,
  ...overrides,
});

const mkPassingFullEval = () => ({
  compositeScore: 8,
  codeScore: 8,
  visualScore: 8,
  assertionPassRate: 1,
  assertionsFailed: false,
  vlmModel: "test-vlm",
  codeReviewModel: "test-code",
  codeIssues: [],
  vlmIssues: [],
  vlmSuggestions: [],
  vlmRawResponse: "",
  vlmReasoning: "",
  vlmSystemPrompt: "",
  codeReviewRawResponse: "",
  codeReviewReasoning: "",
  codeReviewSystemPrompt: "",
});

describe("submit_result forced checklist gate — assembler path (non-disableRender)", () => {
  beforeEach(() => {
    mockRunChecklistEval.mockReset();
    mockRenderModelScreenshots.mockReset();
    mockRunFullEvaluation.mockReset();
    // Default: screenshots succeed, full eval passes
    mockRenderModelScreenshots.mockResolvedValue({
      images: [{ angle: "front", base64: "imgdata" }],
    });
    mockRunFullEvaluation.mockResolvedValue(mkPassingFullEval());
  });

  it("rejects submission when any item FAILs and uses component-grouped output", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        {
          index: 0,
          item: "Body is hollow",
          visibility: "visual",
          verdict: "FAIL",
          reasoning: "top view shows solid block",
        },
      ],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const onSubmit = vi.fn();
    // Note: { disableRender: undefined } — the assembler path, NOT sub-agent
    const tools = buildAgentTools(mkDeps({ onSubmit }) as any, {});
    const result = String(await tools.submit_result.execute({} as any, {} as any));

    expect(result).toMatch(/SUBMISSION REJECTED/);
    expect(result).toMatch(/Component "body"/);
    expect(result).toMatch(/Body is hollow/);
    expect(result).toMatch(/top view shows solid block/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("groups multiple failed components separately", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        { index: 0, item: "a", visibility: "visual", verdict: "FAIL", reasoning: "bad a" },
        { index: 1, item: "b", visibility: "code", verdict: "FAIL", reasoning: "bad b" },
      ],
      passedCount: 0,
      failedCount: 2,
      uncertainCount: 0,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(
      mkDeps({
        componentChecklist: [
          { item: "a", visibility: "visual" as const, componentName: "body" },
          { item: "b", visibility: "code" as const, componentName: "pin" },
        ],
      }) as any,
      {},
    );
    const result = String(await tools.submit_result.execute({} as any, {} as any));
    expect(result).toMatch(/Component "body"/);
    expect(result).toMatch(/Component "pin"/);
    expect(result).toMatch(/2 of 2/);
  });

  it("does NOT reject when only UNCERTAIN items present", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [
        {
          index: 0,
          item: "x",
          visibility: "visual",
          verdict: "UNCERTAIN",
          reasoning: "occluded",
        },
      ],
      passedCount: 0,
      failedCount: 0,
      uncertainCount: 1,
    });
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps() as any, {});
    const result = String(await tools.submit_result.execute({} as any, {} as any));
    expect(result).not.toMatch(/SUBMISSION REJECTED/);
  });

  it("does NOT fire the gate when componentChecklist is empty (single-agent)", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(
      mkDeps({ componentChecklist: undefined }) as any,
      {},
    );
    await tools.submit_result.execute({} as any, {} as any);
    expect(mockRunChecklistEval).not.toHaveBeenCalled();
  });

  it("does NOT fire the gate on the sub-agent path (disableRender:true)", async () => {
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps() as any, { disableRender: true });
    await tools.submit_result.execute({} as any, {} as any);
    expect(mockRunChecklistEval).not.toHaveBeenCalled();
  });

  it("fires onChecklistEvaluated even when verdict is FAIL", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "FAIL", reasoning: "bad" }],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });
    const onChecklistEvaluated = vi.fn();
    const { buildAgentTools } = await import("../services/agent-tools.service.js");
    const tools = buildAgentTools(mkDeps({ onChecklistEvaluated }) as any, {});
    await tools.submit_result.execute({} as any, {} as any);
    expect(onChecklistEvaluated).toHaveBeenCalledTimes(1);
  });
});
