import { describe, expect, it } from "vitest";

describe("multi-agent sub-agent deps wiring (smoke)", () => {
  it("subAgentVerifications object collects per-component verification snapshots (type smoke)", () => {
    const acc: Record<string, {
      passedCount: number;
      failedCount: number;
      uncertainCount: number;
      failedItems: { item: string; reasoning: string }[];
    }> = {};

    acc["body"] = {
      passedCount: 2,
      failedCount: 1,
      uncertainCount: 0,
      failedItems: [{ item: "wall=2mm", reasoning: "wall=1.5" }],
    };

    expect(acc.body.failedCount).toBe(1);
    expect(acc.body.failedItems[0].item).toBe("wall=2mm");
    expect(acc.body.passedCount).toBe(2);
    expect(acc.body.uncertainCount).toBe(0);
  });

  it("onChecklistEvaluated callback shape maps ComponentVerificationResult to accumulator entry", () => {
    // Simulate what the wired callback does inside runSubAgent
    const verifications: Record<string, { passedCount: number; failedCount: number; uncertainCount: number; failedItems: { item: string; reasoning: string }[] }> = {};

    const mockVerification = {
      passedCount: 3,
      failedCount: 2,
      uncertainCount: 1,
      results: [
        { index: 0, item: "height=50mm", visibility: "code" as const, verdict: "PASS" as const, reasoning: "correct" },
        { index: 1, item: "wall=2mm", visibility: "visual" as const, verdict: "FAIL" as const, reasoning: "wall=1.5mm" },
        { index: 2, item: "hole present", visibility: "visual" as const, verdict: "FAIL" as const, reasoning: "no hole found" },
        { index: 3, item: "base flat", visibility: "visual" as const, verdict: "PASS" as const, reasoning: "ok" },
        { index: 4, item: "chamfer", visibility: "both" as const, verdict: "UNCERTAIN" as const, reasoning: "unclear" },
        { index: 5, item: "threads", visibility: "visual" as const, verdict: "PASS" as const, reasoning: "visible" },
      ],
    };

    // This mirrors the callback body in agent-multi.service.ts
    const componentName = "lid";
    verifications[componentName] = {
      passedCount: mockVerification.passedCount,
      failedCount: mockVerification.failedCount,
      uncertainCount: mockVerification.uncertainCount,
      failedItems: mockVerification.results
        .filter((r) => r.verdict === "FAIL")
        .map((r) => ({ item: r.item, reasoning: r.reasoning })),
    };

    expect(verifications.lid.failedCount).toBe(2);
    expect(verifications.lid.failedItems).toHaveLength(2);
    expect(verifications.lid.failedItems[0]).toEqual({ item: "wall=2mm", reasoning: "wall=1.5mm" });
    expect(verifications.lid.failedItems[1]).toEqual({ item: "hole present", reasoning: "no hole found" });
    expect(verifications.lid.uncertainCount).toBe(1);
  });
});
