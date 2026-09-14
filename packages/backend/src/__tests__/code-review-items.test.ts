/**
 * The code reviewer answers the code-routed items (ADR 0001, issue #105):
 * its answers are aligned to the criteria it was asked, a skipped item is
 * unanswered (never a guess), and the gate counts the answers beside the
 * visual judge's under a new version.
 */
import { describe, it, expect } from "vitest";
import { alignCodeItems } from "../services/code-eval.service.js";
import { deriveVerdict, gateItems, GATE_VERSION } from "../services/approval-gate.service.js";

const criteria = [{ text: "Wall thickness is 2mm" }, { text: "Hole diameter is 5mm" }, { text: "Fillet radius is 1mm on the base edges" }];

describe("alignCodeItems", () => {
  it("aligns by position when the questions match, keeping the reviewer's answer and evidence", () => {
    const out = alignCodeItems(criteria, [
      { question: "Wall thickness is 2mm", pass: true, detail: "wall = 2" },
      { question: "hole diameter is 5mm", pass: false, detail: "hole_d = 4" },
      { question: "Fillet radius is 1mm on the base edges", pass: true, detail: "fillet(1)" },
    ]);
    expect(out.map((o) => [o.pass, o.detail])).toEqual([[true, "wall = 2"], [false, "hole_d = 4"], [true, "fillet(1)"]]);
    expect(out.map((o) => o.question)).toEqual(criteria.map((c) => c.text));
  });

  it("finds an answer by its question when the order differs, and marks a skipped criterion unanswered", () => {
    const out = alignCodeItems(criteria, [
      { question: "Fillet radius is 1mm on the base edges", pass: true, detail: "fillet(1)" },
      { question: "Wall thickness is 2mm", pass: false, detail: "wall = 3" },
    ]);
    expect(out[0]).toEqual({ question: "Wall thickness is 2mm", pass: false, detail: "wall = 3" });
    expect(out[1]).toEqual({ question: "Hole diameter is 5mm", pass: null, detail: "not answered by the code reviewer" });
    expect(out[2].pass).toBe(true);
  });

  it("accepts an unlabelled answer by position and yields every criterion unanswered when the reviewer returned none", () => {
    expect(alignCodeItems(criteria, [{ question: "", pass: true, detail: "" }])[0].pass).toBe(true);
    const none = alignCodeItems(criteria, []);
    expect(none).toHaveLength(3);
    expect(none.every((o) => o.pass === null)).toBe(true);
  });
});

describe("the gate over both evaluators' items (v2)", () => {
  const base = { renderSuccess: true, assertionsFailed: false, compositeScore: 8, threshold: 7.5 };
  const p = { pass: true as boolean | null };

  it("is version two", () => {
    expect(GATE_VERSION).toBe("items-v2+backstop");
  });

  it("two visual items and one code item make the example gate-eligible", () => {
    expect(deriveVerdict({ ...base, items: gateItems([p, p], null) })).toMatchObject({ status: "pending", reason: "not-gate-eligible" });
    expect(deriveVerdict({ ...base, items: gateItems([p, p], [p]) })).toMatchObject({ status: "auto_approved", items: 3 });
  });

  it("a failed or unanswered code item fails the example", () => {
    expect(deriveVerdict({ ...base, items: gateItems([p, p], [{ pass: false }]) })).toMatchObject({ status: "pending", reason: "item-failed" });
    expect(deriveVerdict({ ...base, items: gateItems([p, p, p], [{ pass: null }]) })).toMatchObject({ status: "pending", reason: "item-failed" });
  });

  it("a row without code answers is judged on the visual items alone", () => {
    expect(gateItems([p, p, p], undefined)).toHaveLength(3);
    expect(deriveVerdict({ ...base, items: gateItems([p, p, p], undefined) }).status).toBe("auto_approved");
  });
});
