/**
 * The judge training export's label rules (issue #94): two sources, nothing
 * else; the evidence from whichever judge was right; agreed passes capped.
 */
import { describe, it, expect } from "vitest";
import type { ItemPair } from "../services/qualification-screen.service.js";
import {
  capAgreedPasses, cleanDetail, decisionKey, labelPairs, mergeLabels, type DecisionRecord, type LabelledItem,
} from "../services/training-export/judge-sft-labels.js";

const pair = (index: number, ref: boolean | null, cand: boolean | null, q = `q${index}`): ItemPair => ({
  exampleId: "ex", index, question: q,
  ref: { question: q, pass: ref, detail: `ref saw ${index}` },
  cand: { question: q, pass: cand, detail: `cand saw ${index}` },
});
const decision = (index: number, d: "R" | "C" | "N", q = `q${index}`): [string, DecisionRecord] =>
  [decisionKey("ex", index), { exampleId: "ex", itemIndex: index, question: q, decision: d }];

describe("labelPairs", () => {
  it("takes the verdict and evidence from the judge that was right", () => {
    const { items } = labelPairs([pair(0, false, true), pair(1, true, false)], new Map([decision(0, "R"), decision(1, "C")]), "s1");
    expect(items).toEqual([
      expect.objectContaining({ index: 0, pass: false, detail: "ref saw 0", source: "adjudicated", decision: "R" }),
      expect.objectContaining({ index: 1, pass: false, detail: "cand saw 1", source: "adjudicated", decision: "C" }),
    ]);
  });

  it("labels agreed items from the reference, and drops open disagreements, N and uncertain", () => {
    const pairs = [pair(0, true, true), pair(1, false, false), pair(2, true, false), pair(3, null, null), pair(4, true, false), pair(5, null, true)];
    const { items, drops } = labelPairs(pairs, new Map([decision(4, "N"), decision(5, "R")]), "s1");
    expect(items.map((i) => [i.index, i.pass, i.source])).toEqual([[0, true, "agreed"], [1, false, "agreed"]]);
    expect(items[0].detail).toBe("ref saw 0");
    expect(drops).toEqual({ open: 1, neither: 1, uncertain: 2, orphaned: 0 });
  });

  it("drops and counts an adjudication whose question no longer matches the item at its index", () => {
    const { items, drops } = labelPairs([pair(0, false, true, "is the lid present?")], new Map([decision(0, "R", "is the base flat?")]), "s1");
    expect(items).toEqual([]);
    expect(drops.orphaned).toBe(1);
  });

  it("strips the zoom merge's prefix from the evidence", () => {
    expect(cleanDetail({ pass: true, detail: "[2x zoom] top: four holes" })).toBe("top: four holes");
    expect(cleanDetail({ pass: true, detail: "  top: four holes " })).toBe("top: four holes");
  });
});

const item = (index: number, pass: boolean, source: LabelledItem["source"], exampleId = "ex", sittingId = "s1"): LabelledItem =>
  ({ exampleId, index, question: `q${index}`, pass, detail: "d", source, decision: source === "adjudicated" ? "R" : null, sittingId });

describe("capAgreedPasses", () => {
  it("keeps every fail and adjudicated item, and at most three agreed passes per fail", () => {
    const items = [item(0, false, "adjudicated"), item(1, true, "adjudicated"), item(2, false, "agreed"),
      ...Array.from({ length: 10 }, (_, i) => item(10 + i, true, "agreed"))];
    const { items: kept, cap } = capAgreedPasses(items, 3, (keys, n) => keys.slice(0, n));
    expect(cap).toEqual({ passesPerFail: 3, fails: 2, agreedPassesAvailable: 10, agreedPassesKept: 6 });
    expect(kept).toHaveLength(9);
    expect(kept.filter((i) => i.source === "agreed" && i.pass)).toHaveLength(6);
    expect(kept.some((i) => i.index === 0)).toBe(true);
    expect(kept.some((i) => i.index === 2)).toBe(true);
  });

  it("keeps all agreed passes when they are within the budget, without drawing", () => {
    let drawn = false;
    const { items: kept } = capAgreedPasses([item(0, false, "agreed"), item(1, true, "agreed")], 3, () => { drawn = true; return []; });
    expect(kept).toHaveLength(2);
    expect(drawn).toBe(false);
  });
});

describe("mergeLabels", () => {
  it("prefers an adjudicated label over an agreed one on the same item, and refuses two adjudications that disagree", () => {
    const merged = mergeLabels([item(0, true, "agreed", "ex", "s1"), item(0, false, "adjudicated", "ex", "s2")]);
    expect(merged).toEqual([expect.objectContaining({ pass: false, sittingId: "s2" })]);
    expect(() => mergeLabels([item(0, true, "adjudicated", "ex", "s1"), item(0, false, "adjudicated", "ex", "s2")])).toThrow(/Conflicting adjudications/);
  });
});

// #111: the rule's C is its own label source; a person's verdict outranks it; the rule never labels R.
import { labelPairs as labelWithAuto, mergeLabels as mergeWithAuto } from "../services/training-export/judge-sft-labels.js";
describe("auto-C labels", () => {
  it("labels an auto-triage C from the candidate's evidence as auto-C, and drops an auto R", () => {
    const pairs = [pair(0, false, true), pair(1, true, false)];
    const decisions = new Map<string, DecisionRecord>([
      [decisionKey("ex", 0), { itemIndex: 0, exampleId: "ex", question: "q0", decision: "C", source: "auto-triage" }],
      [decisionKey("ex", 1), { itemIndex: 1, exampleId: "ex", question: "q1", decision: "R", source: "auto-triage" }],
    ]);
    const { items, drops } = labelWithAuto(pairs, decisions, "s1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ index: 0, source: "auto-C", pass: true });
    expect(drops.open).toBe(1);
  });
  it("lets a person's verdict outrank the rule's on the same item", () => {
    const merged = mergeWithAuto([item(0, true, "auto-C", "ex", "s1"), item(0, false, "adjudicated", "ex", "s2")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "adjudicated", pass: false });
  });
});
