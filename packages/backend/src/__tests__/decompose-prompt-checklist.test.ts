import { describe, expect, it } from "vitest";
import { parseDecompositionResponse } from "../services/agent-multi-parser.js";

describe("decomposePrompt response parsing with componentChecklist", () => {
  it("parses componentChecklist when present", () => {
    const json = JSON.stringify({
      components: [
        {
          name: "body",
          description: "the hollow box",
          componentChecklist: [
            { item: "Body is hollow", visibility: "visual" },
            { item: "Wall thickness is 2mm", visibility: "code" },
          ],
        },
      ],
      assemblyNotes: "Place lid on top.",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toHaveLength(2);
    expect(r.components[0].componentChecklist?.[0].visibility).toBe("visual");
  });

  it("returns undefined componentChecklist when LLM omits it", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "box" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toBeUndefined();
  });

  it("drops invalid componentChecklist (bad visibility) instead of throwing", () => {
    const json = JSON.stringify({
      components: [
        {
          name: "body",
          description: "box",
          componentChecklist: [{ item: "x", visibility: "smell" }],
        },
      ],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist).toBeUndefined();
  });
});
