import { describe, expect, it } from "vitest";
import { aggregateChecklistForAssembler } from "../services/agent-multi.service.js";
import { mergeAssemblyChecklist } from "../utils/checklist-merge.js";
import type { ComponentVerificationResult, SubAgentVerificationSnapshot } from "../utils/component-checklist.js";

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
 * Reproduces the Phase-2 assembler callback logic for unit testing.
 * Production callback writes ALL verification results to a single "assembly" key
 * in subAgentVerifications (not grouped per componentName, because merged
 * top-level + assemblyChecklist items have no componentName).
 *
 * If the production callback changes, update this twin AND the tests.
 */
function buildAssemblerCallbackPhase2(
  accumulator: Record<string, SubAgentVerificationSnapshot>,
) {
  return (verification: ComponentVerificationResult) => {
    // Reset all keys (assembler is canonical source for the assembly summary).
    for (const key of Object.keys(accumulator)) delete accumulator[key];

    accumulator["assembly"] = {
      passedCount: verification.passedCount,
      failedCount: verification.failedCount,
      uncertainCount: verification.uncertainCount,
      failedItems: verification.results
        .filter(r => r.verdict === "FAIL")
        .map(r => ({ item: r.item, reasoning: r.reasoning })),
    };
  };
}

describe("assemblerOnChecklistEvaluated callback (Phase 2 twin)", () => {
  it("stores all results under a single 'assembly' key", () => {
    const acc: Record<string, SubAgentVerificationSnapshot> = {};
    buildAssemblerCallbackPhase2(acc)({
      results: [
        { index: 0, item: "outer dim 50mm", visibility: "code", verdict: "PASS", reasoning: "ok" },
        { index: 1, item: "knuckles interlock", visibility: "visual", verdict: "FAIL", reasoning: "overlap" },
      ],
      passedCount: 1,
      failedCount: 1,
      uncertainCount: 0,
    });
    expect(Object.keys(acc)).toEqual(["assembly"]);
    expect(acc.assembly.passedCount).toBe(1);
    expect(acc.assembly.failedCount).toBe(1);
    expect(acc.assembly.failedItems).toEqual([
      { item: "knuckles interlock", reasoning: "overlap" },
    ]);
  });

  it("resets the accumulator before writing (canonical assembly source)", () => {
    const acc: Record<string, SubAgentVerificationSnapshot> = {
      // Pre-existing per-sub-agent entries from Task 6's sub-agent callbacks.
      body: { passedCount: 3, failedCount: 0, uncertainCount: 0, failedItems: [] },
      pin: { passedCount: 2, failedCount: 0, uncertainCount: 0, failedItems: [] },
    };
    buildAssemblerCallbackPhase2(acc)({
      results: [{ index: 0, item: "outer dim 50mm", visibility: "code", verdict: "PASS", reasoning: "ok" }],
      passedCount: 1,
      failedCount: 0,
      uncertainCount: 0,
    });
    // Sub-agent entries are cleared by the assembler's reset semantics.
    expect(Object.keys(acc)).toEqual(["assembly"]);
  });

  it("handles empty verification results", () => {
    const acc: Record<string, SubAgentVerificationSnapshot> = {};
    buildAssemblerCallbackPhase2(acc)({
      results: [],
      passedCount: 0,
      failedCount: 0,
      uncertainCount: 0,
    });
    expect(acc.assembly).toEqual({
      passedCount: 0,
      failedCount: 0,
      uncertainCount: 0,
      failedItems: [],
    });
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
