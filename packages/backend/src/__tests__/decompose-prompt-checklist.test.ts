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

describe("parseDecompositionResponse — assemblyChecklist (Phase 2)", () => {
  it("parses assemblyChecklist when present", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyChecklist: [
        { item: "Lid sits 0.5mm above body edge", visibility: "visual", assemblyVisibility: "visible" },
        { item: "PCB seats flush against standoffs", visibility: "both", assemblyVisibility: "occluded" },
      ],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toHaveLength(2);
    expect(r.assemblyChecklist?.[0].item).toBe("Lid sits 0.5mm above body edge");
    expect(r.assemblyChecklist?.[1].assemblyVisibility).toBe("occluded");
  });

  it("returns undefined assemblyChecklist when absent (backwards compat)", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toBeUndefined();
  });

  it("drops invalid assemblyChecklist instead of throwing", () => {
    const json = JSON.stringify({
      components: [{ name: "body", description: "x" }],
      assemblyChecklist: [{ item: "x", visibility: "smell" }],
      assemblyNotes: "n/a",
    });
    const r = parseDecompositionResponse(json);
    expect(r.assemblyChecklist).toBeUndefined();
  });
});

describe("DECOMPOSE_CHECKLIST_ADDENDUM — occlusion guidance", () => {
  it("instructs the LLM to emit assemblyVisibility", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/assemblyVisibility/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/visible/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/occluded/);
  });

  it("provides example types of occluded features", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/hidden inside|covered by/i);
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

describe("DECOMPOSE_CHECKLIST_ADDENDUM — Phase 2 wording", () => {
  it("instructs the LLM to put assembly-dependent items in assemblyChecklist", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/assemblyChecklist/);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/relationship BETWEEN components/i);
  });

  it("instructs that component items must be checkable in isolation", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/verifiable.*component.*alone|own geometry/i);
  });

  it("describes assemblyVisibility as telemetry, not routing", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/training-data labels|analytics|telemetry/i);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).not.toMatch(/code-only verification|skip VLM/i);
  });

  it("provides concrete GOOD and BAD examples", () => {
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/GOOD component items/i);
    expect(DECOMPOSE_CHECKLIST_ADDENDUM).toMatch(/BAD component items/i);
  });
});
