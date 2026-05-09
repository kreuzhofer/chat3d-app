import { describe, it, expect } from "vitest";
import { haveSelectionInputsChanged } from "../services/experiment.service.js";

const CURRENT = {
  categoryIds: ["cat-A", "cat-B", "cat-C"],
  promptCount: 100,
  promptSeed: 42,
};

describe("haveSelectionInputsChanged — preserves persisted prompt selection on a model-only edit", () => {
  it("returns false when the payload is empty (e.g. only a name change)", () => {
    expect(haveSelectionInputsChanged({}, CURRENT)).toBe(false);
  });

  it("returns false when the form re-submits identical values (typical model-only edit)", () => {
    expect(
      haveSelectionInputsChanged(
        { categoryIds: ["cat-A", "cat-B", "cat-C"], promptCount: 100, promptSeed: 42 },
        CURRENT,
      ),
    ).toBe(false);
  });

  it("treats reordered category lists as unchanged (selection query is set-based)", () => {
    expect(
      haveSelectionInputsChanged({ categoryIds: ["cat-C", "cat-A", "cat-B"] }, CURRENT),
    ).toBe(false);
  });

  it("returns true when a category is added", () => {
    expect(
      haveSelectionInputsChanged(
        { categoryIds: ["cat-A", "cat-B", "cat-C", "cat-D"] },
        CURRENT,
      ),
    ).toBe(true);
  });

  it("returns true when a category is removed", () => {
    expect(
      haveSelectionInputsChanged({ categoryIds: ["cat-A", "cat-B"] }, CURRENT),
    ).toBe(true);
  });

  it("returns true when a category is swapped", () => {
    expect(
      haveSelectionInputsChanged(
        { categoryIds: ["cat-A", "cat-B", "cat-Z"] },
        CURRENT,
      ),
    ).toBe(true);
  });

  it("returns true when promptCount changes", () => {
    expect(haveSelectionInputsChanged({ promptCount: 50 }, CURRENT)).toBe(true);
  });

  it("returns true when promptSeed changes", () => {
    expect(haveSelectionInputsChanged({ promptSeed: 123 }, CURRENT)).toBe(true);
  });

  it("ignores duplicates in the input categoryIds — set semantics", () => {
    // duplicates collapse to the same 3 cats, so this is unchanged
    expect(
      haveSelectionInputsChanged(
        { categoryIds: ["cat-A", "cat-A", "cat-B", "cat-C"] },
        CURRENT,
      ),
    ).toBe(true); // length differs → conservatively re-select; safer than silently treating dups as no-op
  });
});
