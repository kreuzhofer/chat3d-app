import { describe, expect, it } from "vitest";
import { mergeAssemblyChecklist, componentStoragePrefix } from "../utils/checklist-merge.js";

describe("mergeAssemblyChecklist", () => {
  it("returns top-level when assemblyChecklist is undefined", () => {
    const r = mergeAssemblyChecklist(
      [{ item: "outer dim 50mm", visibility: "code" }],
      undefined,
    );
    expect(r).toHaveLength(1);
    expect(r[0].item).toBe("outer dim 50mm");
  });

  it("returns assemblyChecklist when top-level is empty", () => {
    const r = mergeAssemblyChecklist(
      [],
      [{ item: "knuckles interlock", visibility: "visual" }],
    );
    expect(r).toHaveLength(1);
    expect(r[0].item).toBe("knuckles interlock");
  });

  it("concatenates and de-dupes by item text (case-insensitive)", () => {
    const r = mergeAssemblyChecklist(
      [
        { item: "Outer dim is 50mm", visibility: "code" },
        { item: "Has 4 mounting holes", visibility: "visual" },
      ],
      [
        { item: "outer dim is 50mm", visibility: "both" },  // duplicate by text, top-level wins
        { item: "Knuckles interlock", visibility: "visual" },
      ],
    );
    expect(r).toHaveLength(3);
    expect(r.map(x => x.item)).toEqual([
      "Outer dim is 50mm",            // from top-level (kept)
      "Has 4 mounting holes",         // from top-level
      "Knuckles interlock",           // from assembly
    ]);
  });
});

describe("componentStoragePrefix", () => {
  it("builds the per-component storage prefix", () => {
    expect(componentStoragePrefix("cat-1", "ex-2", "body"))
      .toBe("workbench/cat-1/ex-2/components/body");
  });
});
