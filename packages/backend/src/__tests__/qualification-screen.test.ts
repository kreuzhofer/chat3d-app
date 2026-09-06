/**
 * The mechanical terms of the qualification bar (ADR 0004, issue #61).
 *
 * The screen reads stored experiment rows and prints every mechanical term
 * as PASS / FAIL: completeness at zero tolerance, stability at the
 * reference's own floor, throughput and raw agreement recorded. These tests
 * pin the arithmetic and the observables each count is read from, on
 * synthetic runs — no judge, no database.
 */
import { describe, it, expect } from "vitest";
import {
  agreement,
  completeness,
  identity,
  itemGate,
  itemState,
  pairItems,
  scoreAgreement,
  stability,
  throughput,
  STABILITY_FLOOR,
  type ScreenResultRow,
  type ScreenRun,
  type StoredChecklistItem,
} from "../services/qualification-screen.service.js";
import { disagreements, renderDisagreementDump } from "../services/qualification-screen-dump.js";

const P = (detail = "front view: seen"): StoredChecklistItem => ({ question: "q", pass: true, detail });
const F = (detail = "top view: not seen"): StoredChecklistItem => ({ question: "q", pass: false, detail });
const U = (detail = "unclear"): StoredChecklistItem => ({ question: "q", pass: null, detail });
const ZP = (): StoredChecklistItem => ({ question: "q", pass: true, detail: "[2x zoom] front view: seen up close" });
const UNREADABLE = (): StoredChecklistItem => ({ question: "q", pass: null, detail: "unclear", zoomFollowUp: "unreadable" });
const SKIPPED = (): StoredChecklistItem => ({ question: "q", pass: null, detail: "unclear", zoomFollowUp: "skipped" });

function row(exampleId: string, items: StoredChecklistItem[] | null, extra: Partial<ScreenResultRow> = {}): ScreenResultRow {
  return {
    exampleId, visualScore: 8, checklistResults: items, error: null, issues: [],
    instrumentId: "production@abc", thinkingEffort: "off", durationMs: 10_000, completionTokens: 400,
    ...extra,
  };
}

function run(runId: string, rows: ScreenResultRow[]): ScreenRun {
  return { runId, label: runId, rows };
}

describe("itemState", () => {
  it("reads pass, fail and uncertain from the stored boolean", () => {
    expect(itemState(P())).toBe("P");
    expect(itemState(F())).toBe("F");
    expect(itemState(U())).toBe("U");
    expect(itemState(undefined)).toBe("U");
  });

  it("treats a zoom-resolved item as uncertain again at the first-pass cut", () => {
    expect(itemState(ZP())).toBe("P");
    expect(itemState(ZP(), true)).toBe("U");
  });

  it("keeps an unreadable or skipped follow-up uncertain", () => {
    expect(itemState(UNREADABLE())).toBe("U");
    expect(itemState(SKIPPED())).toBe("U");
  });
});

describe("completeness", () => {
  const selected = ["e1", "e2", "e3", "e4", "e5", "e6", "e7"];
  const reference = run("ref", selected.map((id) => row(id, [P(), P(), P()])));

  it("passes a run that answered every example with a full checklist", () => {
    const c = completeness(run("c", selected.map((id) => row(id, [P(), F(), U()]))), selected, reference);
    expect(c.pass).toBe(true);
    expect(c.answered).toBe(7);
    expect(c.residualUncertain).toBe(7);
    expect(c.terms.every((t) => t.pass)).toBe(true);
  });

  it("reads each of the six zero-tolerance counts from its stored observable", () => {
    const rows = [
      // e1 unanswered: no row at all
      row("e2", null, { error: "boom" }),
      row("e3", null, { issues: ["Evaluation failed: provider down"] }),
      row("e4", null, { issues: ['Empty response from VLM: output budget of 4096 tokens exhausted before the answer (finish reason "length", 4000 reasoning chars)'] }),
      row("e5", []),
      row("e6", [P(), P()]),
      row("e7", [P(), UNREADABLE(), SKIPPED()]),
    ];
    const c = completeness(run("c", rows), selected, reference);
    expect(c.pass).toBe(false);
    expect(c.unanswered).toBe(1);
    expect(c.errors).toBe(2);
    expect(c.truncations).toBe(1);
    expect(c.missingChecklists).toBe(1);
    expect(c.itemCountMismatches).toBe(1);
    expect(c.unreadableFollowUps).toBe(1);
    expect(c.residualUncertain).toBe(2);
    expect(c.terms.map((t) => [t.name, t.pass])).toEqual([
      ["unanswered examples", false], ["errors", false], ["truncations", false],
      ["missing checklists", false], ["item-count mismatches", false], ["unreadable follow-ups", false],
    ]);
  });
});

describe("identity", () => {
  it("passes one instrument id and one thinking effort", () => {
    const i = identity(run("c", [row("e1", [P()]), row("e2", [P()])]));
    expect(i).toMatchObject({ instrumentIds: ["production@abc"], thinkingEfforts: ["off"], pass: true });
  });

  it("fails a run stamped under two ids", () => {
    const i = identity(run("c", [row("e1", [P()]), row("e2", [P()], { instrumentId: "production@def" })]));
    expect(i.instrumentIds).toEqual(["production@abc", "production@def"]);
    expect(i.pass).toBe(false);
  });
});

describe("pairItems and agreement", () => {
  const ref = run("ref", [row("e1", [P(), F(), U(), P()]), row("e2", [P(), P()]), row("e3", null, { error: "x" })]);
  const cand = run("c", [row("e1", [P(), P(), F(), ZP()]), row("e2", [F(), P(), P()]), row("e3", [P()])]);

  it("pairs by example and position, skipping failed rows and extra items", () => {
    const pairs = pairItems(cand, ref);
    expect(pairs.map((p) => `${p.exampleId}:${p.index}`)).toEqual(["e1:0", "e1:1", "e1:2", "e1:3", "e2:0", "e2:1"]);
  });

  it("counts identical items, hard flips and the one-directional rates", () => {
    const a = agreement(pairItems(cand, ref));
    expect(a.items).toBe(6);
    expect(a.identical).toBe(3);
    expect(a.hardFlips).toBe(2);
    expect(a.hardFlipRate).toBeCloseTo(2 / 6);
    expect(a.eitherUncertain).toBe(1);
    expect(a.matrix.P.F).toBe(1);
    expect(a.matrix.F.P).toBe(1);
    expect(a.matrix.U.F).toBe(1);
    expect(a.candPassOnRefFail).toBe(1);
    expect(a.candFailOnRefPass).toBe(1);
  });

  it("re-opens zoom-resolved items at the first-pass cut", () => {
    const a = agreement(pairItems(cand, ref), { firstPass: true });
    expect(a.identical).toBe(2);
    expect(a.eitherUncertain).toBe(2);
  });
});

describe("stability", () => {
  function armWith(flips: number, total: number): [ScreenRun, ScreenRun] {
    const a = Array.from({ length: total }, () => P());
    const b = Array.from({ length: total }, (_, i) => (i < flips ? F() : P()));
    return [run("a", [row("e1", a)]), run("b", [row("e1", b)])];
  }

  it("passes at the floor and fails one flip above it", () => {
    expect(STABILITY_FLOOR).toEqual({ maxHardFlipRate: 0.029, minIdenticalRate: 0.9 });
    const [a1, a2] = armWith(29, 1000);
    expect(stability(a1, a2).pass).toBe(true);
    const [b1, b2] = armWith(30, 1000);
    const s = stability(b1, b2);
    expect(s.pass).toBe(false);
    expect(s.terms.find((t) => t.name.startsWith("hard flips"))?.pass).toBe(false);
    expect(s.terms.find((t) => t.name.startsWith("identical"))?.pass).toBe(true);
  });

  it("reports the first-pass cut beside the gating all-items cut", () => {
    const s = stability(run("a", [row("e1", [ZP(), P()])]), run("b", [row("e1", [P(), P()])]));
    expect(s.allItems.identical).toBe(2);
    expect(s.firstPass.identical).toBe(1);
    expect(s.pass).toBe(true);
  });
});

describe("itemGate", () => {
  it("derives the verdict from all items passing on examples with at least three", () => {
    const ref = run("ref", [row("e1", [P(), P(), P()]), row("e2", [P(), P(), F()]), row("e3", [P(), P()]), row("e4", [P(), P(), P()])]);
    const cand = run("c", [row("e1", [P(), P(), P()]), row("e2", [P(), P(), P()]), row("e3", [F(), P()]), row("e4", [P(), F(), P()])]);
    const g = itemGate(cand, ref);
    expect(g).toMatchObject({ eligible: 3, agree: 1, falseAccepts: 1, falseRejects: 1, candApproves: 2, refApproves: 2 });
  });
});

describe("scoreAgreement", () => {
  it("compares first-pass scores and the 7.5 backstop", () => {
    const ref = run("ref", [row("e1", [P()], { visualScore: 8 }), row("e2", [P()], { visualScore: 7 }), row("e3", [P()], { visualScore: 6 })]);
    const cand = run("c", [row("e1", [P()], { visualScore: 8 }), row("e2", [P()], { visualScore: 8 }), row("e3", [P()], { visualScore: 5 })]);
    const s = scoreAgreement(cand, ref);
    expect(s.examples).toBe(3);
    expect(s.sameScore).toBe(1);
    expect(s.meanAbsDelta).toBeCloseTo(2 / 3);
    expect(s.candPassRefFail).toBe(1);
    expect(s.candFailRefPass).toBe(0);
  });
});

describe("throughput", () => {
  it("records seconds per example and hours per corpus pass, sequential and at the run's own rate", () => {
    const r = run("c", [row("e1", [P()], { durationMs: 10_000 }), row("e2", [P()], { durationMs: 20_000 })]);
    const t = throughput(r, 3600, 20_000);
    expect(t.secondsPerExample).toBe(15);
    expect(t.hoursPerCorpusSequential).toBe(15);
    expect(t.wallClockMinutes).toBeCloseTo(1 / 3);
    expect(t.hoursPerCorpusAtRunRate).toBeCloseTo(10);
  });
});

describe("disagreement dump", () => {
  const ref = run("ref", [row("e1", [P("front: a hole"), F("top: no boss")]), row("e2", [P()])]);
  const cand = run("c", [row("e1", [F("front: no hole"), F("top: none")]), row("e2", [P()])]);
  const arm2 = run("c2", [row("e1", [P("front: a hole after all"), F()]), row("e2", [P()])]);

  it("lists only the items where candidate and reference differ, with the second arm when it moved", () => {
    const rows = disagreements(cand, ref, arm2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exampleId: "e1", index: 0, ref: { state: "P" }, cand: { state: "F" }, arm2: { state: "P" } });
    expect(disagreements(cand, ref)[0].arm2).toBeNull();
  });

  it("renders every disagreement with both judges' evidence and a verdict column", () => {
    const md = renderDisagreementDump(disagreements(cand, ref, arm2), {
      candidateLabel: "qwen", referenceLabel: "sonnet", arm2Label: "qwen arm 2", instrumentId: "production@abc",
      prompts: new Map([["e1", { prompt: "A plate with one hole", category: "Plates" }]]),
    });
    expect(md).toContain("A plate with one hole");
    expect(md).toContain("front: a hole");
    expect(md).toContain("front: no hole");
    expect(md).toContain("front: a hole after all");
    expect(md).toContain("verdict");
  });
});
