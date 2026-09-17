/**
 * The adjudicated terms of the bar, tallied from a sitting's rows (ADR 0004).
 *
 * The golden is #85's sheet as Daniel adjudicated it on 2026-09-09: 70 hard
 * flips, candidate false passes 6 vs the reference's 18, candidate false
 * fails 17 vs 20 against an allowance of 40, 9 N — the numbers the grant in
 * visual-eval-qualified-judges.ts cites.
 */
import { describe, it, expect } from "vitest";
import { isHardFlip, tallyAdjudications } from "../services/adjudication-tally.js";

/** [reference, candidate, decision] per item, in sheet order. */
const SHEET_85: Array<[string, string, string]> = [
  ["fail", "pass", "R"],
  ["pass", "fail", "R"],
  ["pass", "fail", "C"],
  ["fail", "pass", "C"],
  ["fail", "pass", "R"],
  ["pass", "fail", "N"],
  ["pass", "fail", "R"],
  ["pass", "fail", "C"],
  ["fail", "pass", "N"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "R"],
  ["pass", "fail", "C"],
  ["pass", "fail", "C"],
  ["fail", "pass", "R"],
  ["pass", "fail", "C"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "R"],
  ["pass", "fail", "R"],
  ["pass", "fail", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "C"],
  ["fail", "pass", "R"],
  ["pass", "fail", "R"],
  ["pass", "fail", "N"],
  ["fail", "pass", "C"],
  ["fail", "pass", "N"],
  ["pass", "fail", "N"],
  ["pass", "fail", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["pass", "fail", "N"],
  ["pass", "fail", "N"],
  ["pass", "fail", "R"],
  ["pass", "fail", "C"],
  ["fail", "pass", "R"],
  ["fail", "pass", "R"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "N"],
  ["pass", "fail", "N"],
  ["pass", "fail", "R"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "R"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "R"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
  ["pass", "fail", "C"],
  ["pass", "fail", "R"],
  ["pass", "fail", "R"],
  ["fail", "pass", "C"],
  ["fail", "pass", "C"],
];

describe("tallyAdjudications", () => {
  it("reproduces #85's adjudicated terms from its 70 verdicts", () => {
    const t = tallyAdjudications(SHEET_85.map(([refState, candState, decision]) => ({ refState, candState, decision })));
    expect(t).toMatchObject({
      items: 70, hard: 70, decided: 70, open: 0, n: 9,
      candFalsePass: 6, refFalsePass: 18, candFalseFail: 17, refFalseFail: 20,
      falseFailAllowance: 40, falsePassHolds: true, falseFailHolds: true, complete: true,
    });
  });

  it("counts an R on a candidate fail as the candidate's false fail and a C there as the reference's false pass", () => {
    const t = tallyAdjudications([
      { refState: "pass", candState: "fail", decision: "R" },
      { refState: "pass", candState: "fail", decision: "C" },
      { refState: "fail", candState: "pass", decision: "R" },
      { refState: "fail", candState: "pass", decision: "C" },
    ]);
    expect(t).toMatchObject({ candFalseFail: 1, refFalsePass: 1, candFalsePass: 1, refFalseFail: 1, n: 0 });
  });

  it("leaves one-side-uncertain items and open items outside the terms", () => {
    const t = tallyAdjudications([
      { refState: "uncertain", candState: "fail", decision: "R" },
      { refState: "pass", candState: "fail", decision: null },
      { refState: "pass", candState: "fail", decision: "N" },
    ]);
    expect(t).toMatchObject({ items: 3, hard: 2, decided: 1, open: 1, n: 1, complete: false });
    expect(isHardFlip({ refState: "uncertain", candState: "fail" })).toBe(false);
    expect(isHardFlip({ refState: "pass", candState: "pass" })).toBe(false);
  });

  it("fails the false-pass term the moment the candidate's confirmed false passes exceed the reference's", () => {
    const t = tallyAdjudications([
      { refState: "fail", candState: "pass", decision: "R" },
      { refState: "pass", candState: "fail", decision: "R" },
      { refState: "pass", candState: "fail", decision: "R" },
    ]);
    expect(t.falsePassHolds).toBe(false);
    // two candidate false fails against a reference with none: allowance 0
    expect(t.falseFailHolds).toBe(false);
    expect(t.falseFailAllowance).toBe(0);
  });
});

// #111: the rule's decisions are outside the terms, not open.
import { tallyAdjudications as tallyWithAuto } from "../services/adjudication-tally.js";
describe("tally with auto-decided items", () => {
  it("counts auto decisions apart, excludes them from the terms, and lets the sitting complete", () => {
    const t = tallyWithAuto([
      { refState: "pass", candState: "fail", decision: "R", decisionSource: "human" },
      { refState: "pass", candState: "fail", decision: "C", decisionSource: "auto-triage" },
      { refState: "fail", candState: "pass", decision: "C", decisionSource: "auto-triage" },
    ]);
    expect(t).toMatchObject({ hard: 3, decided: 1, autoDecided: 2, open: 0, complete: true, candFalseFail: 1, refFalsePass: 0, refFalseFail: 0 });
  });
});
