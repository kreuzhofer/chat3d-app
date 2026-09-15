/**
 * Enrichment's atoms contract (ADR 0002, issue #104): atoms in, bare strings
 * and bundled entries refused with a reason.
 */
import { describe, it, expect } from "vitest";
import { parseEnrichmentAtoms, judgeAskable } from "../services/spec-enrichment-atoms.js";

describe("parseEnrichmentAtoms", () => {
  it("accepts one requirement per entry with a visibility", () => {
    const r = parseEnrichmentAtoms([
      { text: "Exactly four standoffs inside the box", visibility: "visual" },
      { text: "Standoff offset from the corner is 5mm", visibility: "code" },
      { text: "Standoffs sit near the corners", visibility: "both" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.atoms.map((a) => a.visibility)).toEqual(["visual", "code", "both"]);
  });

  it("refuses bare strings instead of lifting them to both", () => {
    const r = parseEnrichmentAtoms(["Four standoffs", { text: "x", visibility: "code" }]);
    expect(r).toMatchObject({ ok: false, reason: "bare-string", offending: "Four standoffs" });
  });

  it("refuses an entry without a valid visibility", () => {
    expect(parseEnrichmentAtoms([{ text: "Four standoffs" }])).toMatchObject({ ok: false, reason: "missing-visibility" });
    expect(parseEnrichmentAtoms([{ text: "Four standoffs", visibility: "maybe" }])).toMatchObject({ ok: false, reason: "missing-visibility" });
  });

  it("refuses a judge-facing entry that bundles a measurement", () => {
    const r = parseEnrichmentAtoms([{ text: "Four standoffs 5mm from each corner", visibility: "visual" }]);
    expect(r).toMatchObject({ ok: false, reason: "bundled" });
    const both = parseEnrichmentAtoms([{ text: "Wall thickness of 2mm", visibility: "both" }]);
    expect(both).toMatchObject({ ok: false, reason: "bundled" });
  });

  it("lets a measurement through when it is routed to code", () => {
    const r = parseEnrichmentAtoms([{ text: "Wall thickness is 2mm", visibility: "code" }]);
    expect(r.ok).toBe(true);
  });

  it("refuses an empty list, a non-list and textless entries", () => {
    expect(parseEnrichmentAtoms([])).toMatchObject({ ok: false, reason: "empty" });
    expect(parseEnrichmentAtoms("four standoffs")).toMatchObject({ ok: false, reason: "not-an-array" });
    expect(parseEnrichmentAtoms([{ text: "   ", visibility: "visual" }])).toMatchObject({ ok: false, reason: "empty-text" });
  });

  it("counts only non-code atoms as judge-askable", () => {
    const atoms = [
      { text: "Open top", visibility: "visual" as const },
      { text: "Lid present", visibility: "both" as const },
      { text: "Height 30mm", visibility: "code" as const },
    ];
    expect(judgeAskable(atoms).map((a) => a.text)).toEqual(["Open top", "Lid present"]);
  });
});
