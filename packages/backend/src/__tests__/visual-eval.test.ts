/**
 * Tests for the visual evaluation response parser.
 *
 * Covers JSON parsing, code-fenced JSON, and markdown fallback extraction.
 */

import { describe, it, expect } from "vitest";
import { parseEvaluationResponse } from "../services/visual-eval.service.js";

// ── JSON responses ──────────────────────────────────────────────────────

describe("parseEvaluationResponse — JSON", () => {
  it("parses valid JSON with score, issues, suggestions", () => {
    const json = JSON.stringify({
      score: 8,
      issues: ["Head appears rounded instead of flat"],
      suggestions: ["Specify countersink angle"],
    });
    const result = parseEvaluationResponse(json);
    expect(result.score).toBe(8);
    expect(result.issues).toEqual(["Head appears rounded instead of flat"]);
    expect(result.suggestions).toEqual(["Specify countersink angle"]);
  });

  it("parses JSON wrapped in code fence", () => {
    const content = "```json\n" + JSON.stringify({
      score: 9,
      issues: [],
      suggestions: ["Add chamfer"],
    }) + "\n```";
    const result = parseEvaluationResponse(content);
    expect(result.score).toBe(9);
    expect(result.suggestions).toEqual(["Add chamfer"]);
  });

  it("clamps score to 1-10 range", () => {
    const result = parseEvaluationResponse(JSON.stringify({ score: 15, issues: [], suggestions: [] }));
    expect(result.score).toBe(10);
  });

  it("returns score 1 for empty content", () => {
    const result = parseEvaluationResponse("");
    expect(result.score).toBe(1);
  });
});

// ── Markdown fallback ───────────────────────────────────────────────────

describe("parseEvaluationResponse — markdown fallback", () => {
  it("extracts score from markdown text", () => {
    const content = `Score: 7

Issues:
- The head is too rounded
- Missing thread detail

Suggestions:
- Specify thread pitch`;
    const result = parseEvaluationResponse(content);
    expect(result.score).toBe(7);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toBe("The head is too rounded");
    expect(result.suggestions).toEqual(["Specify thread pitch"]);
  });

  it("handles markdown bold bullets without leaking into issues", () => {
    const content = `Score: 6

Issues:
- **Taper geometry**: visible taper ✓
- **Head height**: proportional ✓

Suggestions:
- Specify countersink angle

Checklist:
- **Head diameter ~12mm** — pass.
- **Countersunk profile** — head is rounded; fail.`;
    const result = parseEvaluationResponse(content);
    // Issues should only have the 2 items from the Issues section, not checklist items
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toBe("Taper geometry: visible taper ✓");
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toBe("Specify countersink angle");
  });

  it("stops issues section at checklist boundary", () => {
    const content = `Score: 5

Issues:
- Missing threads

Checklist:
- **Diameter** — correct; pass.
- **Height** — wrong; fail.`;
    const result = parseEvaluationResponse(content);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toBe("Missing threads");
  });

  it("stops suggestions at checklist boundary", () => {
    const content = `Score: 7

Suggestions:
- Add thread detail

Checklist:
- **Thread presence** — missing; fail.`;
    const result = parseEvaluationResponse(content);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toBe("Add thread detail");
  });

  it("handles the real-world garbled VLM response format", () => {
    // This is the actual format that caused the bug
    const content = `Score: 6

Issues:
- **Taper geometry**: The conical taper from ~12mm to ~6mm is visible. ✓
- **Head height**: Proportionally reasonable for ~4mm. ✓
- **Threads**: Clearly visible helical threads. ✓
- **convex/rounded** on top rather than **flat-topped countersunk**.

Suggestions:
- Is this really a flat head screw?

Checklist:
- **Head top diameter ~12mm** — The head appears wide enough; pass.
- **Taper to ~6mm at shank** — Visible taper; pass.
- **Countersunk flat-head profile** — Head is rounded/domed, not flat; fail.`;

    const result = parseEvaluationResponse(content);
    expect(result.score).toBe(6);
    // Issues should only contain the 4 items from the Issues section
    expect(result.issues).toHaveLength(4);
    expect(result.issues[3]).toContain("convex/rounded");
    // Suggestions should only contain 1 item, not checklist items
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toContain("flat head screw");
  });
});
