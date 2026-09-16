/**
 * The approval gate's inputs (issue #44).
 *
 * `shouldAutoApprove` used to read an absent or empty checklist as "no gate"
 * and approve on score alone — the same `return true` for a prompt with no
 * questions, a judge that failed to answer them, and answers lost before
 * they were stored. A gate that cannot be performed is not a gate that
 * passed: with no items there is no verdict to derive, and the row stays
 * pending (the zero-item case of ADR 0001's "fewer than three items").
 * The render guard likewise takes a required boolean, because a guard on an
 * optional field the caller may omit is not a guard.
 */
import { describe, it, expect } from "vitest";
import { shouldAutoApprove } from "../services/workbench-pipeline-helpers.service.js";
import { parseChecklistResults } from "../services/visual-eval-parser.service.js";

const pass = (n: number) => Array.from({ length: n }, (_, i) => ({ pass: true as boolean | null, question: `q${i}` }));
const THRESHOLD = 7.5;

describe("shouldAutoApprove — the gate needs its inputs", () => {
  it("does not approve on score alone when no items were stored", () => {
    expect(shouldAutoApprove(10, THRESHOLD, [], true)).toBe(false);
    expect(shouldAutoApprove(10, THRESHOLD, null, true)).toBe(false);
    expect(shouldAutoApprove(10, THRESHOLD, undefined, true)).toBe(false);
  });

  it("does not approve a failed render whatever the score and items say", () => {
    expect(shouldAutoApprove(10, THRESHOLD, pass(5), false)).toBe(false);
  });

  it("does not approve below the threshold or without a score", () => {
    expect(shouldAutoApprove(7.4, THRESHOLD, pass(5), true)).toBe(false);
    expect(shouldAutoApprove(null, THRESHOLD, pass(5), true)).toBe(false);
  });

  it("approves when the render succeeded, the score clears and the items pass", () => {
    expect(shouldAutoApprove(8, THRESHOLD, pass(5), true)).toBe(true);
  });

  it("every item must pass (ADR 0001, #88): no pass-rate, no relaxation for a high composite", () => {
    const fourOfFive = [...pass(4), { pass: false, question: "q4" }];
    expect(shouldAutoApprove(8, THRESHOLD, fourOfFive, true)).toBe(false);
    expect(shouldAutoApprove(10, THRESHOLD, fourOfFive, true)).toBe(false);
    expect(shouldAutoApprove(8, THRESHOLD, pass(5), true)).toBe(true);
  });

  it("fewer than three items is not gate-eligible (ADR 0001, #88)", () => {
    expect(shouldAutoApprove(10, THRESHOLD, pass(2), true)).toBe(false);
    expect(shouldAutoApprove(10, THRESHOLD, pass(1), true)).toBe(false);
    expect(shouldAutoApprove(8, THRESHOLD, pass(3), true)).toBe(true);
  });

  it("counts an uncertain item as not passing", () => {
    const uncertain = [...pass(3), { pass: null, question: "q3" }, { pass: null, question: "q4" }];
    expect(shouldAutoApprove(8, THRESHOLD, uncertain, true)).toBe(false);
  });
});

describe("a judge that returns a score and omits the checklist", () => {
  // glm-5.3-flash did this on 18 of 125 evaluations in experiment 7337a398;
  // the bypass approved on the score alone whenever it cleared the threshold.
  const reply = JSON.stringify({ score: 9, issues: [], suggestions: [] });

  it("yields no items from the parser", () => {
    expect(parseChecklistResults(reply)).toEqual([]);
  });

  it("and therefore no approval, however high the score", () => {
    expect(shouldAutoApprove(9, THRESHOLD, parseChecklistResults(reply), true)).toBe(false);
  });
});

// The gate counts the code reviewer's items beside the judge's (ADR 0001, #105;
// the live paths passed the visual list alone until #109).
import { shouldAutoApprove as gateWithCodeItems } from "../services/workbench-pipeline-helpers.service.js";
describe("shouldAutoApprove counts code items", () => {
  const pass = { pass: true }; const fail = { pass: false };
  it("reaches eligibility with two visual items and one code item", () => {
    expect(gateWithCodeItems(9, 7.5, [pass, pass], true)).toBe(false);
    expect(gateWithCodeItems(9, 7.5, [pass, pass], true, [pass])).toBe(true);
  });
  it("a failed code item pends the row even when every visual item passes", () => {
    expect(gateWithCodeItems(9, 7.5, [pass, pass, pass], true, [fail])).toBe(false);
  });
});
