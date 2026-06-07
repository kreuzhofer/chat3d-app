import { describe, expect, it } from "vitest";
import { aggregateChecklistForAssembler } from "../services/agent-multi.service.js";
import { mergeAssemblyChecklist } from "../utils/checklist-merge.js";
import type { ComponentVerificationResult, ChecklistItemResult } from "../utils/component-checklist.js";

describe("aggregateChecklistForAssembler", () => {
  it("flattens per-component checklists and tags items with componentName", () => {
    const result = aggregateChecklistForAssembler([
      {
        name: "body",
        description: "the box",
        componentChecklist: [
          { item: "Body is hollow", visibility: "visual" },
          { item: "Wall thickness is 2mm", visibility: "code" },
        ],
      },
      {
        name: "pin",
        description: "the pin",
        componentChecklist: [{ item: "Pin diameter is 3mm", visibility: "code" }],
      },
    ]);

    expect(result).toEqual([
      { item: "Body is hollow", visibility: "visual", componentName: "body" },
      { item: "Wall thickness is 2mm", visibility: "code", componentName: "body" },
      { item: "Pin diameter is 3mm", visibility: "code", componentName: "pin" },
    ]);
  });

  it("returns empty array when no components have checklists", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      { name: "pin", description: "y" },
    ]);
    expect(result).toEqual([]);
  });

  it("skips components with undefined componentChecklist", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      {
        name: "pin",
        description: "y",
        componentChecklist: [{ item: "x", visibility: "code" }],
      },
    ]);
    expect(result).toEqual([
      { item: "x", visibility: "code", componentName: "pin" },
    ]);
  });
});

/**
 * Reproduces the callback logic from runMultiAgentCodegen for unit testing.
 * If we change the production callback, we update this twin and the tests.
 */
function buildAssemblerCallback(
  assemblerChecklist: ReturnType<typeof aggregateChecklistForAssembler>,
  accumulator: Record<string, {
    passedCount: number; failedCount: number; uncertainCount: number;
    failedItems: { item: string; reasoning: string }[];
  }>,
) {
  return (verification: ComponentVerificationResult) => {
    for (const key of Object.keys(accumulator)) delete accumulator[key];
    const grouped: Record<string, ChecklistItemResult[]> = {};
    for (const r of verification.results) {
      const sourceItem = assemblerChecklist[r.index];
      const componentName = sourceItem?.componentName ?? "unknown";
      (grouped[componentName] ??= []).push(r);
    }
    for (const [componentName, results] of Object.entries(grouped)) {
      accumulator[componentName] = {
        passedCount: results.filter((x) => x.verdict === "PASS").length,
        failedCount: results.filter((x) => x.verdict === "FAIL").length,
        uncertainCount: results.filter((x) => x.verdict === "UNCERTAIN").length,
        failedItems: results
          .filter((x) => x.verdict === "FAIL")
          .map((x) => ({ item: x.item, reasoning: x.reasoning })),
      };
    }
  };
}

describe("assemblerOnChecklistEvaluated callback (twin)", () => {
  const checklist = aggregateChecklistForAssembler([
    {
      name: "body",
      description: "",
      componentChecklist: [
        { item: "Body is hollow", visibility: "visual" },
        { item: "Wall thickness 2mm", visibility: "code" },
      ],
    },
    {
      name: "pin",
      description: "",
      componentChecklist: [{ item: "Pin diameter 3mm", visibility: "code" }],
    },
  ]);

  it("groups multi-component results by componentName", () => {
    const acc: Parameters<typeof buildAssemblerCallback>[1] = {};
    const cb = buildAssemblerCallback(checklist, acc);
    cb({
      results: [
        { index: 0, item: "Body is hollow", visibility: "visual", verdict: "PASS", reasoning: "ok" },
        { index: 1, item: "Wall thickness 2mm", visibility: "code", verdict: "FAIL", reasoning: "bad" },
        { index: 2, item: "Pin diameter 3mm", visibility: "code", verdict: "PASS", reasoning: "ok" },
      ],
      passedCount: 2,
      failedCount: 1,
      uncertainCount: 0,
    });

    expect(acc.body).toEqual({
      passedCount: 1,
      failedCount: 1,
      uncertainCount: 0,
      failedItems: [{ item: "Wall thickness 2mm", reasoning: "bad" }],
    });
    expect(acc.pin).toEqual({
      passedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
      failedItems: [],
    });
  });

  it("resets the accumulator on each call (last write wins)", () => {
    const acc: Parameters<typeof buildAssemblerCallback>[1] = {
      stale: { passedCount: 99, failedCount: 99, uncertainCount: 99, failedItems: [] },
    };
    const cb = buildAssemblerCallback(checklist, acc);
    cb({
      results: [
        { index: 0, item: "Body is hollow", visibility: "visual", verdict: "PASS", reasoning: "ok" },
      ],
      passedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
    });
    expect(acc.stale).toBeUndefined();
    expect(Object.keys(acc)).toEqual(["body"]);
  });

  it("buckets out-of-range indices under 'unknown'", () => {
    const acc: Parameters<typeof buildAssemblerCallback>[1] = {};
    const cb = buildAssemblerCallback(checklist, acc);
    cb({
      results: [
        { index: 99, item: "ghost item", visibility: "visual", verdict: "FAIL", reasoning: "no source" },
      ],
      passedCount: 0,
      failedCount: 1,
      uncertainCount: 0,
    });
    expect(acc.unknown).toBeDefined();
    expect(acc.unknown.failedCount).toBe(1);
  });
});

describe("assembler input — merged top-level + assemblyChecklist (Phase 2)", () => {
  it("uses mergeAssemblyChecklist for assembler's componentChecklist", () => {
    // Smoke: the merged checklist combines top-level + assembly items
    const merged = mergeAssemblyChecklist(
      [{ item: "Outer dim 50mm", visibility: "code" }],
      [{ item: "Knuckles interlock", visibility: "visual" }],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map(i => i.item)).toContain("Outer dim 50mm");
    expect(merged.map(i => i.item)).toContain("Knuckles interlock");
  });
});
