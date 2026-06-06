/**
 * Tests for the forced component-checklist verification gate in submit_result.
 *
 * The gate fires only when:
 *   - options.disableRender is true (sub-agent path), AND
 *   - deps.componentChecklist is populated (multi-agent sub-agents only), AND
 *   - deps.getLastRenderedFiles() returns at least one file
 *
 * FAIL verdict blocks submission; UNCERTAIN does not; empty checklist skips the gate.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock checklist-eval.service BEFORE any module imports it ──────────────────
// vi.mock is hoisted by vitest to the top of the file, so this mock is in
// effect when agent-tools.service.ts is first loaded.
const { mockRunChecklistEval } = vi.hoisted(() => ({
  mockRunChecklistEval: vi.fn(),
}));

vi.mock("../services/checklist-eval.service.js", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return {
    ...actual,
    runChecklistEval: mockRunChecklistEval,
  };
});

import { buildAgentTools } from "../services/agent-tools.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mkFs = (code = "x = 1") => ({
  getMainCode: () => code,
  getAllFiles: () => [],
  writeFile: () => {},
  listFiles: () => [],
  getFiles: () => [],
});

const mkDeps = (overrides: Record<string, unknown> = {}) => ({
  fs: mkFs(),
  wrapProjectFiles: () => [],
  baseFileName: "x",
  onRenderSuccess: () => {},
  onSubmit: vi.fn(),
  getLastRenderedFiles: () => [{ filename: "front.png", contentBase64: "f" }],
  userPrompt: "p",
  evalThreshold: 5,
  componentChecklist: [{ item: "x", visibility: "visual" }],
  ...overrides,
});

beforeEach(() => {
  mockRunChecklistEval.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("submit_result forced checklist gate", () => {
  it("rejects submission when any component item FAILs", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "FAIL", reasoning: "not visible" }],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });

    const onSubmit = vi.fn();
    const tools = buildAgentTools(mkDeps({ onSubmit }) as any, { disableRender: true });
    const result = await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(String(result)).toMatch(/SUBMISSION REJECTED/);
    expect(String(result)).toMatch(/component checklist/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("includes failed item details in the rejection message", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "has 4 holes", visibility: "visual", verdict: "FAIL", reasoning: "no holes visible" }],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });

    const tools = buildAgentTools(mkDeps() as any, { disableRender: true });
    const result = await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(String(result)).toMatch(/has 4 holes/);
    expect(String(result)).toMatch(/no holes visible/);
  });

  it("does NOT reject when only UNCERTAIN items present", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "UNCERTAIN", reasoning: "occluded" }],
      passedCount: 0,
      failedCount: 0,
      uncertainCount: 1,
    });

    const onSubmit = vi.fn();
    const tools = buildAgentTools(mkDeps({ onSubmit }) as any, { disableRender: true });
    const result = await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(String(result)).not.toMatch(/SUBMISSION REJECTED/);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does NOT reject when all items PASS", async () => {
    mockRunChecklistEval.mockResolvedValue({
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "PASS", reasoning: "clearly visible" }],
      passedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
    });

    const onSubmit = vi.fn();
    const tools = buildAgentTools(mkDeps({ onSubmit }) as any, { disableRender: true });
    const result = await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(String(result)).not.toMatch(/SUBMISSION REJECTED/);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does NOT fire the gate when componentChecklist is undefined (single-agent path)", async () => {
    const onSubmit = vi.fn();
    const tools = buildAgentTools(
      mkDeps({ onSubmit, componentChecklist: undefined }) as any,
      { disableRender: true },
    );
    await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(mockRunChecklistEval).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does NOT fire the gate when componentChecklist is empty (single-agent path)", async () => {
    const onSubmit = vi.fn();
    const tools = buildAgentTools(
      mkDeps({ onSubmit, componentChecklist: [] }) as any,
      { disableRender: true },
    );
    await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(mockRunChecklistEval).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("falls through (no gate) when no rendered files are cached", async () => {
    const onSubmit = vi.fn();
    const tools = buildAgentTools(
      mkDeps({ onSubmit, getLastRenderedFiles: () => [] }) as any,
      { disableRender: true },
    );
    await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(mockRunChecklistEval).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("invokes onChecklistEvaluated callback after running the gate", async () => {
    const verification = {
      results: [{ index: 0, item: "x", visibility: "visual", verdict: "PASS", reasoning: "ok" }],
      passedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
    };
    mockRunChecklistEval.mockResolvedValue(verification);

    const onChecklistEvaluated = vi.fn();
    const tools = buildAgentTools(
      mkDeps({ onChecklistEvaluated }) as any,
      { disableRender: true },
    );
    await tools.submit_result.execute({ summary: "test" } as any, {} as any);

    expect(onChecklistEvaluated).toHaveBeenCalledWith(verification);
  });
});
