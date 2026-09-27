/**
 * The queue order of a sitting (#120): rc0's candidate false passes — the
 * candidate passed, the reference failed — come first, so the items the next
 * release must fix are decided first; the careful-look rank breaks ties.
 */
import { describe, it, expect } from "vitest";
import { falsePassFirstRank } from "../../api/adjudication.api";

type Ranked = Parameters<typeof falsePassFirstRank>[0];
const item = (candState: string, refState: string, confidence: string | null = "high"): Ranked => ({
  candState, refState, triage: confidence === null ? null : { verdict: "R", confidence, what: null, view: null, resolvedBy: null, model: null, at: null },
}) as unknown as Ranked;

describe("falsePassFirstRank", () => {
  it("puts candidate-pass / reference-fail items before every other direction", () => {
    expect(falsePassFirstRank(item("pass", "fail", "high"))).toBeLessThan(falsePassFirstRank(item("fail", "pass", null)));
    expect(falsePassFirstRank(item("pass", "fail", "high"))).toBeLessThan(falsePassFirstRank(item("pass", "uncertain", null)));
  });
  it("orders within a direction by the careful-look rank", () => {
    expect(falsePassFirstRank(item("pass", "fail", null))).toBeLessThan(falsePassFirstRank(item("pass", "fail", "low")));
    expect(falsePassFirstRank(item("fail", "pass", "low"))).toBeLessThan(falsePassFirstRank(item("fail", "pass", "high")));
  });
});
