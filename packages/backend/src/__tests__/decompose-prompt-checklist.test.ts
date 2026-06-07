import { describe, expect, it } from "vitest";
import { parseDecompositionResponse, DECOMPOSE_CHECKLIST_ADDENDUM } from "../services/agent-multi-parser.js";

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

  it("parses assemblyVisibility through parseComponentChecklist", () => {
    const json = JSON.stringify({
      components: [
        {
          name: "body",
          description: "the box",
          componentChecklist: [
            { item: "Wall thickness 2mm", visibility: "code", assemblyVisibility: "occluded" },
            { item: "Port cutout visible", visibility: "visual", assemblyVisibility: "visible" },
          ],
        },
      ],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.components[0].componentChecklist?.[0].assemblyVisibility).toBe("occluded");
    expect(r.components[0].componentChecklist?.[1].assemblyVisibility).toBe("visible");
  });
});

describe("DECOMPOSE_CHECKLIST_ADDENDUM — Phase 1 occlusion guidance", () => {
  it("instructs the LLM to emit assemblyVisibility", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/assemblyVisibility/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/visible/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/occluded/);
  });

  it("provides example types of occluded features", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/hidden inside|covered by/i);
  });

  it("explains the dispatcher routing consequence", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/skip VLM verification|code-eval/);
  });

  it("uses required language: MUST and EVERY", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/\bMUST\b/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/\bEVERY\b/);
  });

  it("contains concrete occluded examples with both item and assemblyVisibility", () => {
    // Addendum must include at least one "occluded" example showing the JSON shape
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/"assemblyVisibility":\s*"occluded"/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/"assemblyVisibility":\s*"visible"/);
  });

  it("instructs to default to visible when unsure and never omit", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/don't know.*choose.*visible|choose.*visible.*don't know/i);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/NEVER omit/);
  });
});
