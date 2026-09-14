/**
 * The approval gate (ADR 0001, issue #88): items decide, the score is a
 * backstop, the version is stamped.
 */
import { describe, it, expect } from "vitest";
import { deriveVerdict, GATE_VERSION, MIN_GATE_ITEMS } from "../services/approval-gate.service.js";
import { shouldAutoApprove } from "../services/workbench-pipeline-helpers.service.js";

const pass = (n: number) => Array.from({ length: n }, () => ({ pass: true as boolean | null }));
const base = { renderSuccess: true, assertionsFailed: false, compositeScore: 8, threshold: 7.5 };

describe("deriveVerdict", () => {
  it("approves only when every item passes, the render succeeded and the backstop clears", () => {
    expect(deriveVerdict({ ...base, items: pass(3) })).toEqual({ status: "auto_approved", reason: "approved", gateVersion: GATE_VERSION, items: 3, passed: 3 });
  });

  it("one failing item is enough: no pass-rate, no relaxation for a high score", () => {
    const fourOfFive = [...pass(4), { pass: false }];
    expect(deriveVerdict({ ...base, items: fourOfFive }).status).toBe("pending");
    expect(deriveVerdict({ ...base, compositeScore: 10, items: fourOfFive })).toMatchObject({ status: "pending", reason: "item-failed", passed: 4 });
  });

  it("an item still uncertain after the follow-up fails", () => {
    expect(deriveVerdict({ ...base, items: [...pass(3), { pass: null }] })).toMatchObject({ status: "pending", reason: "item-failed" });
  });

  it("fewer than three items is not gate-eligible and stays pending, however good they look", () => {
    expect(MIN_GATE_ITEMS).toBe(3);
    expect(deriveVerdict({ ...base, compositeScore: 10, items: pass(2) })).toMatchObject({ status: "pending", reason: "not-gate-eligible", items: 2 });
    expect(deriveVerdict({ ...base, items: pass(1) }).reason).toBe("not-gate-eligible");
    expect(deriveVerdict({ ...base, items: [] }).reason).toBe("not-gate-eligible");
    expect(deriveVerdict({ ...base, items: null }).reason).toBe("not-gate-eligible");
  });

  it("a failed code assertion rejects, outside the item logic", () => {
    expect(deriveVerdict({ ...base, assertionsFailed: true, items: pass(5) })).toMatchObject({ status: "rejected", reason: "assertions-failed" });
  });

  it("a failed render is never gate-eligible", () => {
    expect(deriveVerdict({ ...base, renderSuccess: false, items: pass(5) })).toMatchObject({ status: "pending", reason: "not-rendered" });
  });

  it("keeps the composite as the backstop: all items passing below the threshold stays pending", () => {
    expect(deriveVerdict({ ...base, compositeScore: 7.4, items: pass(5) })).toMatchObject({ status: "pending", reason: "below-backstop" });
    expect(deriveVerdict({ ...base, compositeScore: null, items: pass(5) })).toMatchObject({ status: "pending", reason: "below-backstop" });
    expect(deriveVerdict({ ...base, compositeScore: 7.5, items: pass(5) }).status).toBe("auto_approved");
  });

  it("stamps the gate version on every verdict", () => {
    for (const items of [pass(3), pass(1), [...pass(2), { pass: false }]]) {
      expect(deriveVerdict({ ...base, items }).gateVersion).toBe(GATE_VERSION);
    }
  });
});

describe("shouldAutoApprove is the gate's boolean", () => {
  it("agrees with deriveVerdict on the item rule", () => {
    expect(shouldAutoApprove(9, 7.5, [...pass(3), { pass: false }], true)).toBe(false);
    expect(shouldAutoApprove(8, 7.5, pass(3), true)).toBe(true);
    expect(shouldAutoApprove(8, 7.5, pass(2), true)).toBe(false);
  });
});
