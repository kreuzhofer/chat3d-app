/**
 * The requirement-atoms contract (ADR 0002, issues #104 and #106): atoms in, bare strings
 * and bundled entries refused with a reason. Since #136 every atom carries a role and the
 * spec states the expected body count; a reply without them is refused the same way.
 */
import { describe, it, expect } from "vitest";
import {
  parseRequirementAtoms, parseExpectedBodyCount, judgeAskable,
  REQUIREMENT_ATOMS_RULES, EXPECTED_BODY_COUNT_RULE,
} from "../services/requirement-atoms.js";

/** A well-formed atom; the role is the #136 addition every parse test needs. */
const atom = (text: string, visibility: string, role = "feature") => ({ text, visibility, role });

describe("parseRequirementAtoms", () => {
  it("accepts one requirement per entry with a visibility", () => {
    const r = parseRequirementAtoms([
      atom("Exactly four standoffs inside the box", "visual", "structural"),
      atom("Standoff offset from the corner is 5mm", "code"),
      atom("Standoffs sit near the corners", "both"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.atoms.map((a) => a.visibility)).toEqual(["visual", "code", "both"]);
  });

  it("refuses bare strings instead of lifting them to both", () => {
    const r = parseRequirementAtoms(["Four standoffs", atom("x", "code")]);
    expect(r).toMatchObject({ ok: false, reason: "bare-string", offending: "Four standoffs" });
  });

  it("refuses an entry without a valid visibility", () => {
    expect(parseRequirementAtoms([{ text: "Four standoffs", role: "feature" }])).toMatchObject({ ok: false, reason: "missing-visibility" });
    expect(parseRequirementAtoms([atom("Four standoffs", "maybe")])).toMatchObject({ ok: false, reason: "missing-visibility" });
  });

  it("refuses a judge-facing entry that bundles a measurement", () => {
    const r = parseRequirementAtoms([atom("Four standoffs 5mm from each corner", "visual")]);
    expect(r).toMatchObject({ ok: false, reason: "bundled" });
    const both = parseRequirementAtoms([atom("Wall thickness of 2mm", "both")]);
    expect(both).toMatchObject({ ok: false, reason: "bundled" });
  });

  it("lets a measurement through when it is routed to code", () => {
    const r = parseRequirementAtoms([atom("Wall thickness is 2mm", "code")]);
    expect(r.ok).toBe(true);
  });

  it("refuses an empty list, a non-list and textless entries", () => {
    expect(parseRequirementAtoms([])).toMatchObject({ ok: false, reason: "empty" });
    expect(parseRequirementAtoms("four standoffs")).toMatchObject({ ok: false, reason: "not-an-array" });
    expect(parseRequirementAtoms([atom("   ", "visual")])).toMatchObject({ ok: false, reason: "empty-text" });
  });

  it("keeps each atom's role", () => {
    const r = parseRequirementAtoms([atom("The lid is a separate part", "visual", "structural"), atom("Four vent slots", "visual", "feature")]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.atoms.map((a) => a.role)).toEqual(["structural", "feature"]);
  });

  it("refuses an entry with a missing or invalid role instead of defaulting it", () => {
    expect(parseRequirementAtoms([{ text: "Open top", visibility: "visual" }])).toMatchObject({ ok: false, reason: "missing-role" });
    expect(parseRequirementAtoms([atom("Open top", "visual", "shape")])).toMatchObject({ ok: false, reason: "missing-role" });
    expect(parseRequirementAtoms([{ text: "Open top", visibility: "visual", role: null }])).toMatchObject({ ok: false, reason: "missing-role" });
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

describe("parseExpectedBodyCount", () => {
  it("accepts an integer of at least one", () => {
    expect(parseExpectedBodyCount(1)).toBe(1);
    expect(parseExpectedBodyCount(3)).toBe(3);
  });

  it("refuses a missing, zero, negative, fractional or non-numeric count", () => {
    for (const bad of [undefined, null, 0, -1, 1.5, "2", Number.NaN, Number.POSITIVE_INFINITY, [2]]) {
      expect(parseExpectedBodyCount(bad), String(bad)).toBeNull();
    }
  });
});

describe("the generator's rules", () => {
  it("teach the role list", () => {
    expect(REQUIREMENT_ATOMS_RULES).toMatch(/"role": "structural"/);
    expect(REQUIREMENT_ATOMS_RULES).toMatch(/"role": "feature"/);
    expect(REQUIREMENT_ATOMS_RULES).toMatch(/separat/i);
    expect(REQUIREMENT_ATOMS_RULES).toMatch(/connect/i);
    expect(REQUIREMENT_ATOMS_RULES).toMatch(/overall shape/i);
  });

  it("teach the expected-body-count rule: an integer, 1 when no separate parts are named", () => {
    expect(EXPECTED_BODY_COUNT_RULE).toMatch(/expectedBodyCount/);
    expect(EXPECTED_BODY_COUNT_RULE).toMatch(/\b1\b.*separate/i);
  });
});
